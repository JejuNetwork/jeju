/**
 * Compute SDK - Handles inference through DWS (Decentralized Workstation Service)
 *
 * Uses the same DWS infrastructure as Autocrat and Otto for unified AI inference.
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import { createDWSClient, type DWSClient, getDWSEndpoint } from '../client/dws'
import { AgentCharacterSchema, expect } from '../schemas'
import type { AgentCharacter, ExecutionOptions } from '../types'
import { createLogger, type Logger } from './logger'

export interface ComputeConfig {
  marketplaceUrl?: string // Optional - falls back to DWS
  rpcUrl: string
  defaultModel?: string
  logger?: Logger
  dwsClient?: DWSClient // Optional - will create one if not provided
}

export interface InferenceRequest {
  messages: Array<{ role: string; content: string }>
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface InferenceResponse {
  content: string
  model: string
  tokensUsed: { input: number; output: number }
  cost: bigint
  latencyMs: number
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  pricePerInputToken: bigint
  pricePerOutputToken: bigint
  maxContextLength: number
  capabilities: string[]
}

export class CrucibleCompute {
  private config: ComputeConfig
  private log: Logger
  private client: DWSClient

  constructor(config: ComputeConfig) {
    this.config = config
    this.log = config.logger ?? createLogger('Compute')

    // Use provided client or create one
    if (config.dwsClient) {
      this.client = config.dwsClient
    } else {
      const baseUrl = config.marketplaceUrl ?? getDWSEndpoint()
      this.client = createDWSClient({ baseUrl })
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    this.log.debug('Fetching available models')
    const models = await this.client.getModels()
    const result: ModelInfo[] = models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      pricePerInputToken: BigInt(m.pricePerInputToken),
      pricePerOutputToken: BigInt(m.pricePerOutputToken),
      maxContextLength: m.maxContextLength,
      capabilities: [], // Models endpoint may not return capabilities
    }))
    this.log.debug('Models fetched', { count: result.length })
    return result
  }

  async getBestModel(requirements: {
    maxCost?: bigint
    minContextLength?: number
    capabilities?: string[]
  }): Promise<ModelInfo | null> {
    const models = await this.getAvailableModels()
    const filtered = models.filter((m) => {
      if (
        requirements.minContextLength &&
        m.maxContextLength < requirements.minContextLength
      )
        return false
      if (
        requirements.capabilities &&
        !requirements.capabilities.every((c) => m.capabilities.includes(c))
      )
        return false
      return true
    })
    if (filtered.length === 0) return null
    filtered.sort((a, b) =>
      Number(
        a.pricePerInputToken +
          a.pricePerOutputToken -
          (b.pricePerInputToken + b.pricePerOutputToken),
      ),
    )
    return filtered[0] ?? null
  }

  async runInference(
    character: AgentCharacter,
    userMessage: string,
    context: {
      recentMessages?: Array<{ role: string; content: string }>
      memories?: string[]
      roomContext?: string
    },
    options?: ExecutionOptions,
  ): Promise<InferenceResponse> {
    expect(character, 'Character is required')
    AgentCharacterSchema.parse(character)
    expect(userMessage, 'User message is required')
    expect(userMessage.length > 0, 'User message cannot be empty')
    expect(context, 'Context is required')
    if (options?.maxTokens != null) {
      expect(
        options.maxTokens > 0 && options.maxTokens <= 100000,
        'Max tokens must be between 1 and 100000',
      )
    }
    if (options?.temperature != null) {
      expect(
        options.temperature >= 0 && options.temperature <= 2,
        'Temperature must be between 0 and 2',
      )
    }

    const model = character.modelPreferences?.large ?? this.config.defaultModel
    if (!model) {
      throw new Error(
        'Model is required: either character.modelPreferences.large or defaultModel in ComputeConfig must be set',
      )
    }
    this.log.info('Running inference', {
      model,
      messageLength: userMessage.length,
    })

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: this.buildSystemPrompt(character, context) },
    ]
    if (context.recentMessages) messages.push(...context.recentMessages)
    messages.push({ role: 'user', content: userMessage })

    const result = await this.inference({
      messages,
      model,
      maxTokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.7,
    })

    this.log.info('Inference complete', {
      model: result.model,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
    })
    return result
  }

  async inference(request: InferenceRequest): Promise<InferenceResponse> {
    expect(request, 'Inference request is required')
    expect(request.messages, 'Messages are required')
    expect(request.messages.length > 0, 'At least one message is required')
    const model = request.model ?? this.config.defaultModel
    if (!model) {
      throw new Error(
        'Model is required: either specify model in request or set defaultModel in ComputeConfig',
      )
    }
    if (request.maxTokens !== undefined) {
      expect(
        request.maxTokens > 0 && request.maxTokens <= 100000,
        'Max tokens must be between 1 and 100000',
      )
    }
    if (request.temperature !== undefined) {
      expect(
        request.temperature >= 0 && request.temperature <= 2,
        'Temperature must be between 0 and 2',
      )
    }

    const start = Date.now()
    this.log.debug('Inference request', {
      model,
      messageCount: request.messages.length,
    })

    const messages = request.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }))

    const result = await this.client
      .chatCompletion(messages, {
        model,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      })
      .catch((err: Error) => {
        const network = getCurrentNetwork()
        this.log.error('Inference failed', { error: err.message, network })
        throw new Error(
          `DWS inference failed (network: ${network}): ${err.message}`,
        )
      })

    const content = result.choices[0]?.message?.content ?? ''
    const promptTokens = result.usage?.prompt_tokens ?? 0
    const completionTokens = result.usage?.completion_tokens ?? 0

    return {
      content,
      model,
      tokensUsed: { input: promptTokens, output: completionTokens },
      cost: 0n,
      latencyMs: Date.now() - start,
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    expect(text, 'Text is required')
    expect(text.length > 0, 'Text cannot be empty')
    this.log.debug('Generating embedding', { textLength: text.length })
    return this.client.generateEmbedding(text)
  }

  async estimateCost(
    messages: Array<{ role: string; content: string }>,
    model: string,
    maxOutputTokens: number,
  ): Promise<bigint> {
    expect(messages, 'Messages are required')
    expect(messages.length > 0, 'At least one message is required')
    expect(model, 'Model is required')
    expect(model.length > 0, 'Model cannot be empty')
    expect(maxOutputTokens > 0, 'Max output tokens must be greater than 0')
    expect(
      maxOutputTokens <= 100000,
      'Max output tokens must be less than or equal to 100000',
    )

    const models = await this.getAvailableModels()
    const m = expect(
      models.find((x) => x.id === model),
      `Model not found: ${model}`,
    )

    const inputTokens = Math.ceil(
      messages.reduce((sum, x) => sum + x.content.length, 0) / 4,
    )
    return (
      BigInt(inputTokens) * BigInt(m.pricePerInputToken) +
      BigInt(maxOutputTokens) * BigInt(m.pricePerOutputToken)
    )
  }

  private buildSystemPrompt(
    character: AgentCharacter,
    context: { memories?: string[]; roomContext?: string },
  ): string {
    const parts = [character.system]
    if (character.bio.length)
      parts.push('\n\nBackground:', character.bio.join('\n'))
    if (character.style.all.length)
      parts.push('\n\nStyle:', character.style.all.join('\n'))
    if (context.memories?.length)
      parts.push('\n\nMemories:', context.memories.join('\n'))
    if (context.roomContext) parts.push('\n\nContext:', context.roomContext)
    return parts.join('\n')
  }
}

export function createCompute(config: ComputeConfig): CrucibleCompute {
  return new CrucibleCompute(config)
}
