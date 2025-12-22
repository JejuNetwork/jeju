/**
 * Decentralized Inference Client
 *
 * Connects to the network compute network for AI inference.
 * - Discovers models from on-chain registry
 * - Routes requests to decentralized providers
 * - Pays via X402 or multi-token paymaster
 * - Supports TEE for private inference
 */

import { expectValid } from '@jejunetwork/types'
import type { Address } from 'viem'
import { z } from 'zod'
import {
  ChatCompletionResponseSchema,
  ModelsListResponseSchema,
} from '../schemas/api-responses'
import { expectJson } from './validation'

// ============================================================================
// Types
// ============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: Message[]
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

// ============================================================================
// Default Configuration
// ============================================================================

// Auto-detect local gateway for development
const isLocalDev =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
const DEFAULT_GATEWAY =
  import.meta.env.VITE_JEJU_GATEWAY_URL ||
  (isLocalDev ? 'http://localhost:4100' : 'https://compute.jejunetwork.org')
const DEFAULT_MODEL = 'jeju/llama-3.1-70b'

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

// ============================================================================
// Inference Client
// ============================================================================

class InferenceClient {
  private config: ResolvedInferenceConfig
  private conversationHistory: Message[] = []
  private availableModels: AvailableModel[] = []
  private lastModelFetch = 0
  private modelCacheTTL = 5 * 60 * 1000 // 5 minutes

  constructor(config?: Partial<InferenceConfig>) {
    this.config = {
      gatewayUrl: config?.gatewayUrl || DEFAULT_GATEWAY,
      rpcUrl: config?.rpcUrl || 'https://rpc.jejunetwork.org',
      walletAddress: config?.walletAddress,
      preferredModel: config?.preferredModel || DEFAULT_MODEL,
      requireTEE: config?.requireTEE ?? false,
      maxRetries: config?.maxRetries ?? 3,
      timeoutMs: config?.timeoutMs ?? 30000,
      retryDelayMs: config?.retryDelayMs ?? 1000,
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
   * Default models for fallback when gateway is unavailable
   */
  private static readonly DEFAULT_MODELS: AvailableModel[] = [
    {
      id: 'jeju/llama-3.1-70b',
      name: 'Llama 3.1 70B',
      description: 'High-quality open-source LLM',
      contextWindow: 128000,
      pricePerInputToken: '0.0001',
      pricePerOutputToken: '0.0003',
      provider: 'jeju-network',
      teeType: 'none',
      active: true,
    },
    {
      id: 'jeju/llama-3.1-8b',
      name: 'Llama 3.1 8B',
      description: 'Fast and efficient open-source LLM',
      contextWindow: 128000,
      pricePerInputToken: '0.00005',
      pricePerOutputToken: '0.0001',
      provider: 'jeju-network',
      teeType: 'none',
      active: true,
    },
    {
      id: 'jeju/llama-3.1-70b-tee',
      name: 'Llama 3.1 70B (TEE)',
      description: 'Private inference with TEE attestation',
      contextWindow: 128000,
      pricePerInputToken: '0.0002',
      pricePerOutputToken: '0.0006',
      provider: 'jeju-network',
      teeType: 'sgx',
      active: true,
    },
  ]

  /**
   * Fetch available models from the compute network
   * Falls back to default models if gateway is unavailable (non-critical UI feature)
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

    try {
      const response = await fetch(`${this.config.gatewayUrl}/v1/models`, {
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`)
      }

      const data = expectValid(
        ModelsListResponseSchema,
        await response.json(),
        'models list response',
      )
      const models = data.models ?? data.data ?? []
      this.availableModels = models
      this.lastModelFetch = now
      return this.availableModels
    } catch (fetchError) {
      // Log error and return defaults - model listing is non-critical UI feature
      console.warn(
        'Failed to fetch models from gateway, using defaults:',
        fetchError,
      )
      return InferenceClient.DEFAULT_MODELS
    }
  }

  /**
   * Send a chat message and get a response
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now()
    const model = request.model || this.config.preferredModel

    // Add user message to history
    const userMessage: Message = {
      role: 'user',
      content: request.messages[request.messages.length - 1].content,
    }
    this.conversationHistory.push(userMessage)

    // Build full message list with history
    const messages = [...this.conversationHistory]

    // Add wallet context if available
    if (this.config.walletAddress) {
      const contextMessage: Message = {
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

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs,
        )

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
        const assistantContent = data.choices?.[0]?.message?.content ?? ''

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
          id: data.id || crypto.randomUUID(),
          model: data.model || model,
          content: assistantContent,
          tokensUsed: {
            input: data.usage?.prompt_tokens || 0,
            output: data.usage?.completion_tokens || 0,
            total: data.usage?.total_tokens || 0,
          },
          cost: data.cost
            ? {
                amount: data.cost.amount,
                currency: data.cost.currency || 'JEJU',
                txHash: data.cost.txHash,
              }
            : undefined,
          provider: data.provider || 'jeju-network',
          latencyMs,
          teeAttestation: data.tee_attestation,
        }
      } catch (error) {
        console.warn(`[Inference] Attempt ${attempt + 1} failed:`, error)

        if (attempt < this.config.maxRetries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryDelayMs * (attempt + 1)),
          )
        }
      }
    }

    // If all retries fail, use local fallback
    return this.localFallback(userMessage.content, Date.now() - startTime)
  }

  /**
   * Stream a chat response (for real-time display)
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const model = request.model || this.config.preferredModel

    const userMessage: Message = {
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
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              this.conversationHistory.push({
                role: 'assistant',
                content: fullContent,
              })
              yield { id: crypto.randomUUID(), content: '', done: true }
              return
            }

            try {
              const ChunkSchema = z.object({
                id: z.string().optional(),
                choices: z
                  .array(
                    z.object({
                      delta: z
                        .object({
                          content: z.string().optional(),
                        })
                        .optional(),
                    }),
                  )
                  .optional(),
              })

              const parsed = expectJson(data, ChunkSchema, 'stream chunk')
              const content = parsed.choices?.[0]?.delta?.content || ''
              if (content) {
                fullContent += content
                yield {
                  id: parsed.id || crypto.randomUUID(),
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
      yield { id: crypto.randomUUID(), content: '', done: true }
    } catch (error) {
      console.error('[Inference] Stream error:', error)
      const fallback = await this.localFallback(userMessage.content, 0)
      yield { id: fallback.id, content: fallback.content, done: true }
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
  getHistory(): Message[] {
    return [...this.conversationHistory]
  }

  /**
   * Local fallback when inference network unavailable
   * No fake AI responses - be honest about the limitation
   */
  private async localFallback(
    _input: string,
    latencyMs: number,
  ): Promise<ChatResponse> {
    const content = `**AI Service Unavailable**

The inference service is not responding. This could mean:
- The local inference server isn't running
- No API key is configured (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY)
- Network connectivity issues

**You can still use the wallet:**
Use the sidebar to access all features directly - Portfolio, Pools, Perps, Launchpad, Names, and Security.

**To enable AI chat:**
1. Get an API key from OpenAI, Anthropic, or Groq
2. Set the environment variable
3. Restart the inference server

Groq offers a free tier and is the fastest option.`

    this.conversationHistory.push({ role: 'assistant', content })

    return {
      id: `local-${Date.now()}`,
      model: 'offline',
      content,
      tokensUsed: { input: 0, output: 0, total: 0 },
      provider: 'offline',
      latencyMs,
    }
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

// ============================================================================
// Singleton Export
// ============================================================================

export const inferenceClient = new InferenceClient()

export { InferenceClient }
