import { getRpcUrl } from '@jejunetwork/config'
import { type ChatMessage, expectValid } from '@jejunetwork/types'
import type { Address } from 'viem'
import { z } from 'zod'
import {
  ChatCompletionResponseSchema,
  ModelsListResponseSchema,
} from './api-responses'
import { API_URLS, fetchApi } from './eden'
import { expectJson } from './validation'

function generateUUID(): string {
  return crypto.randomUUID()
}

export interface ChatRequest {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  requireTEE?: boolean
}

export interface ChatResponse {
  id: string
  model: string
  content: string
  tokensUsed: {
    input: number
    output: number
    total: number
  }
  cost?: {
    amount: string
    currency: string
    txHash?: string
  }
  provider: string
  latencyMs: number
  teeAttestation?: string
}

export interface StreamChunk {
  id: string
  content: string
  done: boolean
}

export interface InferenceConfig {
  gatewayUrl: string
  rpcUrl?: string
  walletAddress?: Address
  preferredModel?: string
  requireTEE?: boolean
  maxRetries?: number
  timeoutMs?: number
  retryDelayMs?: number
}

/** Internal resolved config with defaults applied - walletAddress remains optional */
interface ResolvedInferenceConfig {
  gatewayUrl: string
  rpcUrl: string
  walletAddress: Address | undefined
  preferredModel: string
  requireTEE: boolean
  maxRetries: number
  timeoutMs: number
  retryDelayMs: number
}

export interface AvailableModel {
  id: string
  name: string
  description: string
  contextWindow: number
  pricePerInputToken: string
  pricePerOutputToken: string
  provider: string
  teeType: 'none' | 'sgx' | 'tdx' | 'sev' | 'nitro' | 'simulated'
  active: boolean
}

const SYSTEM_PROMPT = `You are Network Wallet, an advanced AI assistant for decentralized finance.

Your core mission is to help users manage their crypto assets seamlessly across multiple chains.

Key Capabilities:
- Portfolio management across EVM chains
- Token swaps with best-route finding
- Transfers to any address or .jeju name
- Liquidity pool management (add/remove)
- Perpetual trading (long/short positions)
- Token launches via bonding curves
- JNS name registration (.jeju domains)
- Security analysis and approval management

For any action involving money:
1. Clearly explain what will happen
2. Show estimated costs and fees
3. Identify any risks
4. Always require explicit confirmation

Be helpful, clear, and security-conscious. Never execute transactions without user confirmation.`

class InferenceClient {
  private config: ResolvedInferenceConfig
  private conversationHistory: ChatMessage[] = []
  private availableModels: AvailableModel[] = []
  private lastModelFetch = 0
  private modelCacheTTL = 5 * 60 * 1000 // 5 minutes

  constructor(config: InferenceConfig) {
    if (!config.gatewayUrl)
      throw new Error('gatewayUrl is required in InferenceConfig')
    if (!config.preferredModel)
      throw new Error('preferredModel is required in InferenceConfig')

    this.config = {
      gatewayUrl: config.gatewayUrl,
      rpcUrl: config.rpcUrl ?? getRpcUrl(),
      walletAddress: config.walletAddress,
      preferredModel: config.preferredModel,
      requireTEE: config.requireTEE ?? false,
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 30000,
      retryDelayMs: config.retryDelayMs ?? 1000,
    }

    // Initialize with system prompt
    this.conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }]
  }

  /**
   * Update configuration
   */
  configure(config: Partial<InferenceConfig>): void {
    Object.assign(this.config, config)
  }

  /**
   * Set the wallet address for payment context
   */
  setWalletAddress(address: Address): void {
    this.config.walletAddress = address
  }

  /**
   * Fetch available models from the compute network
   */
  async getModels(forceRefresh = false): Promise<AvailableModel[]> {
    const now = Date.now()
    if (
      !forceRefresh &&
      this.availableModels.length > 0 &&
      now - this.lastModelFetch < this.modelCacheTTL
    ) {
      return this.availableModels
    }

    const data = await fetchApi<{
      models?: AvailableModel[]
      data?: AvailableModel[]
    }>(this.config.gatewayUrl, '/v1/models', { headers: this.getHeaders() })
    const validated = expectValid(
      ModelsListResponseSchema,
      data,
      'models list response',
    )
    const models = validated.models ?? validated.data ?? []
    this.availableModels = models
    this.lastModelFetch = now
    return this.availableModels
  }

  /**
   * Send a chat message and get a response
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now()
    const model = request.model || this.config.preferredModel

    // Add user message to history
    const userMessage: ChatMessage = {
      role: 'user',
      content: request.messages[request.messages.length - 1].content,
    }
    this.conversationHistory.push(userMessage)

    // Build full message list with history
    const messages = [...this.conversationHistory]

    // Add wallet context if available
    if (this.config.walletAddress) {
      const contextMessage: ChatMessage = {
        role: 'system',
        content: `Current user wallet address: ${this.config.walletAddress}`,
      }
      messages.splice(1, 0, contextMessage) // Insert after system prompt
    }

    const requestBody = {
      model,
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
      stream: false,
    }

    let lastError: Error | undefined

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs,
      )

      try {
        const response = await fetch(
          `${this.config.gatewayUrl}/v1/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...this.getHeaders(),
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          },
        )

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Inference failed: ${response.status} ${errorText}`)
        }

        const data = expectValid(
          ChatCompletionResponseSchema,
          await response.json(),
          'chat completion response',
        )
        const latencyMs = Date.now() - startTime

        // Extract response content
        const choice = data.choices[0]
        const assistantContent = choice.message.content ?? ''

        // Add assistant response to history
        this.conversationHistory.push({
          role: 'assistant',
          content: assistantContent,
        })

        // Keep history reasonable (last 20 exchanges)
        if (this.conversationHistory.length > 41) {
          // system + 20 pairs
          this.conversationHistory = [
            this.conversationHistory[0], // Keep system prompt
            ...this.conversationHistory.slice(-40),
          ]
        }

        return {
          id: data.id ?? generateUUID(),
          model: data.model ?? model,
          content: assistantContent,
          tokensUsed: {
            input: data.usage.prompt_tokens ?? 0,
            output: data.usage.completion_tokens ?? 0,
            total: data.usage.total_tokens ?? 0,
          },
          cost: data.cost
            ? {
                amount: data.cost.amount,
                currency: data.cost.currency ?? 'JEJU',
                txHash: data.cost.txHash,
              }
            : undefined,
          provider: data.provider ?? 'jeju-network',
          latencyMs,
          teeAttestation: data.tee_attestation,
        }
      } catch (error) {
        clearTimeout(timeoutId)
        lastError = error instanceof Error ? error : new Error(String(error))
        console.warn(`[Inference] Attempt ${attempt + 1} failed:`, error)

        if (attempt < this.config.maxRetries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryDelayMs * (attempt + 1)),
          )
        }
      }
    }

    throw lastError ?? new Error('Inference service unavailable')
  }

  /**
   * Stream a chat response (for real-time display)
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const model = request.model || this.config.preferredModel

    const userMessage: ChatMessage = {
      role: 'user',
      content: request.messages[request.messages.length - 1].content,
    }
    this.conversationHistory.push(userMessage)

    const messages = [...this.conversationHistory]

    if (this.config.walletAddress) {
      messages.splice(1, 0, {
        role: 'system',
        content: `Current user wallet address: ${this.config.walletAddress}`,
      })
    }

    try {
      const response = await fetch(
        `${this.config.gatewayUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.getHeaders(),
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens ?? 2048,
            stream: true,
          }),
        },
      )

      if (!response.ok || !response.body) {
        throw new Error(`Stream request failed: ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              this.conversationHistory.push({
                role: 'assistant',
                content: fullContent,
              })
              yield { id: generateUUID(), content: '', done: true }
              return
            }

            try {
              const ChunkSchema = z.object({
                id: z.string().default(''),
                choices: z
                  .array(
                    z.object({
                      delta: z
                        .object({
                          content: z.string().default(''),
                        })
                        .default({ content: '' }),
                    }),
                  )
                  .default([]),
              })

              const parsed = expectJson(data, ChunkSchema, 'stream chunk')
              const deltaChoice = parsed.choices[0]
              const content = deltaChoice.delta.content ?? ''
              if (content) {
                fullContent += content
                yield {
                  id: parsed.id ?? generateUUID(),
                  content,
                  done: false,
                }
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      this.conversationHistory.push({ role: 'assistant', content: fullContent })
      yield { id: generateUUID(), content: '', done: true }
    } catch (error) {
      yield {
        id: generateUUID(),
        content: error instanceof Error ? error.message : 'Stream failed',
        done: true,
      }
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }]
  }

  /**
   * Get current conversation history
   */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory]
  }

  /**
   * Get request headers with optional auth
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }

    if (this.config.walletAddress) {
      headers['X-Network-Address'] = this.config.walletAddress
    }

    return headers
  }
}

export function createInferenceClient(
  config: InferenceConfig,
): InferenceClient {
  return new InferenceClient(config)
}

// Lazy-initialized singleton using API_URLS
let _inferenceClient: InferenceClient | undefined

export function getInferenceClient(): InferenceClient {
  if (!_inferenceClient) {
    _inferenceClient = new InferenceClient({
      gatewayUrl: API_URLS.compute,
      preferredModel: 'jeju/llama-3.1-70b',
    })
  }
  return _inferenceClient
}

// Legacy export for backwards compatibility - uses lazy singleton
export const inferenceClient = {
  setWalletAddress: (address: Address) =>
    getInferenceClient().setWalletAddress(address),
  getModels: (forceRefresh?: boolean) =>
    getInferenceClient().getModels(forceRefresh),
  chat: (request: ChatRequest) => getInferenceClient().chat(request),
  chatStream: (request: ChatRequest) =>
    getInferenceClient().chatStream(request),
  clearHistory: () => getInferenceClient().clearHistory(),
  getHistory: () => getInferenceClient().getHistory(),
  configure: (config: Partial<InferenceConfig>) =>
    getInferenceClient().configure(config),
}

export { InferenceClient }
