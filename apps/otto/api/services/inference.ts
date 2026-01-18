/**
 * Otto Inference Service
 *
 * Integrates with Jeju inference service for AI-powered trading assistance.
 * Uses the local inference proxy (port 4100) which routes to DWS or cloud providers.
 */

import {
  getCoreAppUrl,
  getLocalhostHost,
  isDevelopmentEnv,
} from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { z } from 'zod'

const InferenceResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  model: z.string(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.enum(['assistant', 'user', 'system']),
        content: z.string(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
})

type InferenceResponse = z.infer<typeof InferenceResponseSchema>

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface InferenceConfig {
  model?: string
  temperature?: number
  maxTokens?: number
}

const DEFAULT_MODEL = 'groq/llama-3.3-70b-versatile'
const FALLBACK_MODELS = [
  'groq/llama-3.3-70b-versatile',
  'anthropic/claude-sonnet-4-20250514',
  'openai/gpt-4o',
]

function getInferenceUrl(): string {
  // In development, use local inference proxy
  if (isDevelopmentEnv()) {
    return `http://${getLocalhostHost()}:4100`
  }
  // In production, use DWS compute endpoint
  return `${getCoreAppUrl('COMPUTE')}/v1`
}

const OTTO_SYSTEM_PROMPT = `You are Otto, an AI-powered trading assistant for the Jeju Network. You help users:
- Swap tokens across chains
- Bridge assets between networks
- Launch new tokens with bonding curves
- Track portfolios and balances
- Set limit orders

When a user wants to trade, extract the following information:
- Action type: swap, bridge, launch, balance, price, portfolio, limit, send
- Token symbols (e.g., ETH, USDC, JEJU)
- Amounts
- Chain names (e.g., base, optimism, arbitrum, ethereum, jeju)
- Target prices (for limit orders)

Respond concisely with the action you'll take. If you need clarification, ask a specific question.

Supported chains: Jeju (default), Ethereum, Base, Optimism, Arbitrum, Solana
Default chain: Jeju Network (chain ID 420691)

For confirmations, users can say "confirm", "yes", "do it" or "cancel", "no".`

export interface ParsedIntent {
  action:
    | 'swap'
    | 'bridge'
    | 'balance'
    | 'price'
    | 'portfolio'
    | 'limit'
    | 'send'
    | 'launch'
    | 'connect'
    | 'help'
    | 'confirm'
    | 'cancel'
    | 'unknown'
  params: {
    amount?: string
    fromToken?: string
    toToken?: string
    token?: string
    fromChain?: string
    toChain?: string
    chain?: string
    targetPrice?: string
    recipient?: string
    tokenName?: string
    tokenSymbol?: string
  }
  confidence: number
  rawResponse: string
}

const IntentResponseSchema = z.object({
  action: z.enum([
    'swap',
    'bridge',
    'balance',
    'price',
    'portfolio',
    'limit',
    'send',
    'launch',
    'connect',
    'help',
    'confirm',
    'cancel',
    'unknown',
  ]),
  params: z.object({
    amount: z.string().optional(),
    fromToken: z.string().optional(),
    toToken: z.string().optional(),
    token: z.string().optional(),
    fromChain: z.string().optional(),
    toChain: z.string().optional(),
    chain: z.string().optional(),
    targetPrice: z.string().optional(),
    recipient: z.string().optional(),
    tokenName: z.string().optional(),
    tokenSymbol: z.string().optional(),
  }),
  confidence: z.number().min(0).max(1),
})

class InferenceService {
  private inferenceUrl: string

  constructor() {
    this.inferenceUrl = getInferenceUrl()
  }

  /**
   * Send a chat completion request to the inference service
   */
  async chat(
    messages: ChatMessage[],
    config: InferenceConfig = {},
  ): Promise<string> {
    const model = config.model ?? DEFAULT_MODEL

    const response = await this.callInference(model, messages, config)
    return response.choices[0]?.message?.content ?? ''
  }

  /**
   * Parse user intent using AI
   */
  async parseIntent(
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
  ): Promise<ParsedIntent> {
    const parsePrompt = `Analyze this user message and extract the trading intent.

User message: "${userMessage}"

Respond with a JSON object containing:
{
  "action": "swap" | "bridge" | "balance" | "price" | "portfolio" | "limit" | "send" | "launch" | "connect" | "help" | "confirm" | "cancel" | "unknown",
  "params": {
    "amount": "extracted amount or null",
    "fromToken": "source token symbol or null",
    "toToken": "destination token symbol or null",
    "token": "single token for balance/price queries or null",
    "fromChain": "source chain name or null",
    "toChain": "destination chain name or null",
    "chain": "single chain for operations or null",
    "targetPrice": "target price for limit orders or null",
    "recipient": "recipient address or ENS/JNS name or null",
    "tokenName": "name for token launch or null",
    "tokenSymbol": "symbol for token launch or null"
  },
  "confidence": 0.0-1.0
}

Only respond with the JSON object, no other text.`

    const messages: ChatMessage[] = [
      { role: 'system', content: OTTO_SYSTEM_PROMPT },
      ...conversationHistory.slice(-5), // Last 5 messages for context
      { role: 'user', content: parsePrompt },
    ]

    const response = await this.chat(messages, { temperature: 0.1 })

    // Parse the JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        action: 'unknown',
        params: {},
        confidence: 0,
        rawResponse: response,
      }
    }

    const parsed: unknown = JSON.parse(jsonMatch[0])
    const validated = IntentResponseSchema.safeParse(parsed)

    if (!validated.success) {
      return {
        action: 'unknown',
        params: {},
        confidence: 0,
        rawResponse: response,
      }
    }

    return {
      ...validated.data,
      rawResponse: response,
    }
  }

  /**
   * Generate a conversational response
   */
  async generateResponse(
    intent: ParsedIntent,
    conversationHistory: ChatMessage[] = [],
    additionalContext?: string,
  ): Promise<string> {
    const contextMessage = additionalContext
      ? `\n\nAdditional context: ${additionalContext}`
      : ''

    const responsePrompt = `Based on the parsed intent, generate a helpful response for the user.

Parsed intent: ${JSON.stringify(intent)}${contextMessage}

Be concise and helpful. If asking for confirmation, clearly state what will happen.`

    const messages: ChatMessage[] = [
      { role: 'system', content: OTTO_SYSTEM_PROMPT },
      ...conversationHistory.slice(-5),
      { role: 'user', content: responsePrompt },
    ]

    return this.chat(messages, { temperature: 0.7 })
  }

  /**
   * Generate a trading confirmation message
   */
  async generateConfirmationPrompt(
    action: string,
    details: Record<string, string | number>,
  ): Promise<string> {
    const detailsStr = Object.entries(details)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')

    const prompt = `Generate a clear, concise confirmation prompt for this trading action:

Action: ${action}
Details:
${detailsStr}

Ask the user to confirm or cancel. Be brief but include all important details like amounts, tokens, and fees.`

    return this.chat(
      [
        { role: 'system', content: OTTO_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3 },
    )
  }

  /**
   * Check if inference service is available
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.inferenceUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Get available models
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.inferenceUrl}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) return FALLBACK_MODELS

      const data = (await response.json()) as { data?: Array<{ id: string }> }
      return data.data?.map((m) => m.id) ?? FALLBACK_MODELS
    } catch {
      return FALLBACK_MODELS
    }
  }

  private async callInference(
    model: string,
    messages: ChatMessage[],
    config: InferenceConfig,
  ): Promise<InferenceResponse> {
    // Try primary model first, then fallbacks
    const modelsToTry = [model, ...FALLBACK_MODELS.filter((m) => m !== model)]

    let lastError: Error | null = null

    for (const modelToTry of modelsToTry) {
      try {
        const response = await fetch(
          `${this.inferenceUrl}/v1/chat/completions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelToTry,
              messages,
              temperature: config.temperature ?? 0.7,
              max_tokens: config.maxTokens ?? 1024,
            }),
            signal: AbortSignal.timeout(30000),
          },
        )

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Inference failed: ${response.status} - ${errorText}`)
        }

        const data: unknown = await response.json()

        // Check for error response
        if (
          data &&
          typeof data === 'object' &&
          'error' in data &&
          data.error !== null
        ) {
          const errorData = data as { error: { message?: string } }
          throw new Error(errorData.error.message ?? 'Inference request failed')
        }

        return expectValid(InferenceResponseSchema, data, 'inference response')
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        console.warn(
          `[Inference] Model ${modelToTry} failed:`,
          lastError.message,
        )
      }
    }

    throw lastError ?? new Error('All inference models failed')
  }
}

// Singleton instance
let inferenceService: InferenceService | null = null

export function getInferenceService(): InferenceService {
  if (!inferenceService) {
    inferenceService = new InferenceService()
  }
  return inferenceService
}

export { InferenceService }
