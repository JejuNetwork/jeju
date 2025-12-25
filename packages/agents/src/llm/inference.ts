/**
 * LLM Inference Service
 *
 * Routes inference requests through Jeju Compute marketplace.
 *
 * @packageDocumentation
 */

import { getCurrentNetwork, getServiceUrl } from '@jejunetwork/config'
import { logger } from '@jejunetwork/shared'
import { isValidAddress, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'

/**
 * Chat message for inference
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Inference request
 */
export interface InferenceRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
}

/**
 * Inference response
 */
export interface InferenceResponse {
  id: string
  content: string
  model: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  cost: number
  provider?: Address
  settlement?: {
    requestHash: Hex
    signature: Hex
  }
}

/**
 * Inference provider info
 */
export interface InferenceProvider {
  address: Address
  endpoint: string
  models: string[]
  pricePerInputToken: bigint
  pricePerOutputToken: bigint
  latency: number
  active: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// API Response Schemas
// ─────────────────────────────────────────────────────────────────────────────

const ProvidersResponseSchema = z.object({
  providers: z.array(
    z.object({
      address: z.string(),
      endpoint: z.string(),
      models: z.array(z.string()),
      pricePerInputToken: z
        .union([z.number(), z.string()])
        .transform((v) => BigInt(v)),
      pricePerOutputToken: z
        .union([z.number(), z.string()])
        .transform((v) => BigInt(v)),
      latency: z.number(),
      active: z.boolean(),
    }),
  ),
})

const ModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
})

const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
  settlement: z
    .object({
      provider: z.string(),
      requestHash: z.string(),
      signature: z.string(),
    })
    .optional(),
})

/**
 * Model aliases to actual model names
 */
const MODEL_ALIASES: Record<string, string[]> = {
  'llama-70b': ['llama-3.1-70b-versatile', 'llama-3.1-70b-instant'],
  'llama-8b': ['llama-3.1-8b-instant', 'llama-3.2-8b-instant'],
  mixtral: ['mixtral-8x7b-32768'],
  qwen: ['Qwen/Qwen2.5-14B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'],
  small: ['llama-3.1-8b-instant', 'Qwen/Qwen2.5-3B-Instruct'],
  medium: ['llama-3.1-70b-versatile', 'Qwen/Qwen2.5-7B-Instruct'],
  large: ['llama-3.1-70b-versatile', 'Qwen/Qwen2.5-14B-Instruct'],
}

/**
 * Get gateway URL from config
 */
function getGatewayUrl(): string {
  // Check for custom URL override first
  const customUrl = process.env.JEJU_COMPUTE_API_URL
  if (customUrl) return customUrl

  // Use config service URL
  return getServiceUrl('compute')
}

/**
 * Check if Jeju Compute is configured
 */
function isJejuComputeAvailable(): boolean {
  return !!(process.env.JEJU_NETWORK ?? process.env.JEJU_COMPUTE_API_URL)
}

/**
 * Resolve model alias to actual model name
 */
function resolveModel(model: string): string {
  const aliases = MODEL_ALIASES[model.toLowerCase()]
  if (aliases?.[0]) {
    return aliases[0]
  }
  return model
}

/**
 * LLM Inference Service
 *
 * Routes all inference through Jeju Compute marketplace.
 */
export class LLMInferenceService {
  private providerCache: Map<string, InferenceProvider[]> = new Map()
  private cacheExpiry = 0

  /**
   * Get user address for billing
   */
  private getUserAddress(): Address {
    const address =
      process.env.JEJU_USER_ADDRESS ?? process.env.AGENT_WALLET_ADDRESS
    if (address && isValidAddress(address)) {
      return address
    }
    return ZERO_ADDRESS
  }

  /**
   * List available providers
   */
  async listProviders(model?: string): Promise<InferenceProvider[]> {
    if (!isJejuComputeAvailable()) {
      throw new Error('Jeju Compute not configured')
    }

    // Check cache
    const now = Date.now()
    const cacheKey = model ?? 'all'
    if (now < this.cacheExpiry && this.providerCache.has(cacheKey)) {
      return this.providerCache.get(cacheKey) ?? []
    }

    const gatewayUrl = getGatewayUrl()
    const url = new URL('/v1/providers', gatewayUrl)
    if (model) url.searchParams.set('model', resolveModel(model))

    const response = await fetch(url.toString(), {
      headers: { 'x-jeju-address': this.getUserAddress() },
    })

    if (!response.ok) {
      throw new Error(`Gateway error: ${response.status}`)
    }

    const json: unknown = await response.json()
    const parsed = ProvidersResponseSchema.parse(json)
    const providers = parsed.providers as InferenceProvider[]
    this.providerCache.set(cacheKey, providers)
    this.cacheExpiry = now + 60_000

    return providers
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<string[]> {
    if (!isJejuComputeAvailable()) {
      // Return default models when Jeju Compute not configured
      return [
        'Qwen/Qwen2.5-3B-Instruct',
        'Qwen/Qwen2.5-7B-Instruct',
        'Qwen/Qwen2.5-14B-Instruct',
        'meta-llama/Llama-3.1-8B-Instruct',
        'meta-llama/Llama-3.1-70B-Instruct',
      ]
    }

    const gatewayUrl = getGatewayUrl()
    const response = await fetch(`${gatewayUrl}/v1/models`, {
      headers: { 'x-jeju-address': this.getUserAddress() },
    })

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`)
    }

    const json: unknown = await response.json()
    const parsed = ModelsResponseSchema.parse(json)
    return parsed.data.map((m) => m.id)
  }

  /**
   * Run inference through Jeju Compute
   */
  async inference(request: InferenceRequest): Promise<InferenceResponse> {
    logger.debug(`Running inference with model ${request.model}`)

    if (!isJejuComputeAvailable()) {
      throw new Error(
        'Jeju Compute not configured. ' +
          'Set JEJU_NETWORK (mainnet/testnet/localnet) or JEJU_COMPUTE_API_URL.',
      )
    }

    const gatewayUrl = getGatewayUrl()
    const resolvedModel = resolveModel(request.model)

    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.getUserAddress(),
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 2048,
        stream: request.stream ?? false,
      }),
    })

    if (!response.ok) {
      throw new Error(`Inference failed: ${response.status}`)
    }

    const json: unknown = await response.json()
    const data = ChatCompletionResponseSchema.parse(json)

    const firstChoice = data.choices[0]
    if (!firstChoice) {
      throw new Error('No completion choices returned')
    }

    const usage = {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    }

    const cost = await this.estimateCost(
      resolvedModel,
      usage.promptTokens,
      usage.completionTokens,
    )

    return {
      id: data.id,
      content: firstChoice.message.content,
      model: data.model,
      usage,
      cost,
      provider: data.settlement?.provider as Address | undefined,
      settlement: data.settlement
        ? {
            requestHash: data.settlement.requestHash as Hex,
            signature: data.settlement.signature as Hex,
          }
        : undefined,
    }
  }

  /**
   * Estimate cost for inference
   */
  async estimateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<number> {
    // Base pricing per 1k tokens (in USD cents)
    const pricing: Record<string, { input: number; output: number }> = {
      'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
      'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
      'Qwen/Qwen2.5-3B-Instruct': { input: 0.03, output: 0.05 },
      'Qwen/Qwen2.5-7B-Instruct': { input: 0.07, output: 0.1 },
      'Qwen/Qwen2.5-14B-Instruct': { input: 0.15, output: 0.2 },
    }

    const modelPricing = pricing[model] ?? pricing['llama-3.1-8b-instant']

    const inputCost = (promptTokens / 1000) * (modelPricing?.input ?? 0.05)
    const outputCost =
      (completionTokens / 1000) * (modelPricing?.output ?? 0.08)

    return (inputCost + outputCost) / 100 // Convert cents to dollars
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return isJejuComputeAvailable()
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<{
    available: boolean
    network: string
    gatewayUrl: string
    modelsAvailable: number
    error?: string
  }> {
    const network = getCurrentNetwork()
    const gatewayUrl = getGatewayUrl()

    if (!isJejuComputeAvailable()) {
      return {
        available: false,
        network: 'not configured',
        gatewayUrl: '',
        modelsAvailable: 0,
        error: 'Jeju Compute not configured',
      }
    }

    try {
      const models = await this.getAvailableModels()
      return {
        available: true,
        network,
        gatewayUrl,
        modelsAvailable: models.length,
      }
    } catch (error) {
      return {
        available: false,
        network,
        gatewayUrl,
        modelsAvailable: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

/** Singleton instance */
export const llmInferenceService = new LLMInferenceService()

/**
 * Run inference (convenience function)
 */
export async function runInference(
  request: InferenceRequest,
): Promise<InferenceResponse> {
  return llmInferenceService.inference(request)
}
