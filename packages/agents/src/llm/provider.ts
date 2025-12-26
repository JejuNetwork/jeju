/**
 * LLM Provider for ElizaOS
 *
 * Provides Jeju Compute as an LLM provider for ElizaOS agents.
 * Routes all inference through the decentralized compute marketplace.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'
import type { z } from 'zod'
import { llmInferenceService } from './inference'

/**
 * Provider config
 */
export interface JejuProviderConfig {
  defaultModel?: string
  maxTokens?: number
  temperature?: number
}

/**
 * Options for generateText
 */
interface GenerateTextOptions {
  model?: string
  maxTokens?: number
  temperature?: number
}

/**
 * Jeju Provider interface for ElizaOS
 */
export interface JejuProvider {
  name: string
  generateText(
    runtime: IAgentRuntime,
    prompt: string,
    options?: GenerateTextOptions,
  ): Promise<string>
  generateObject<T extends Record<string, unknown>>(
    runtime: IAgentRuntime,
    prompt: string,
    schema: z.ZodType<T>,
    options?: GenerateTextOptions,
  ): Promise<T>
  getConfig(): JejuProviderConfig
}

/**
 * Create a Jeju LLM provider for ElizaOS
 *
 * Uses the decentralized Jeju Compute marketplace for inference.
 */
export function createJejuProvider(
  config: JejuProviderConfig = {},
): JejuProvider {
  const defaultModel = config.defaultModel ?? 'Qwen/Qwen2.5-3B-Instruct'
  const maxTokens = config.maxTokens ?? 2048
  const temperature = config.temperature ?? 0.7

  return {
    name: 'jeju-compute',

    async generateText(
      runtime: IAgentRuntime,
      prompt: string,
      options: GenerateTextOptions = {},
    ): Promise<string> {
      const model = options.model ?? defaultModel

      logger.debug(`Generating text via Jeju Compute`, {
        model,
        promptLength: prompt.length,
        agentId: runtime.agentId,
      })

      // Build messages from prompt
      const messages = [
        {
          role: 'system' as const,
          content:
            runtime.character?.system ?? 'You are a helpful AI assistant.',
        },
        {
          role: 'user' as const,
          content: prompt,
        },
      ]

      // Run inference through Jeju Compute
      const response = await llmInferenceService.inference({
        model,
        messages,
        temperature: options.temperature ?? temperature,
        maxTokens: options.maxTokens ?? maxTokens,
      })

      logger.debug(`Generated text`, {
        model: response.model,
        tokens: response.usage.totalTokens,
        cost: response.cost,
      })

      return response.content
    },

    async generateObject<T extends Record<string, unknown>>(
      runtime: IAgentRuntime,
      prompt: string,
      schema: z.ZodType<T>,
      options: GenerateTextOptions = {},
    ): Promise<T> {
      const model = options.model ?? defaultModel

      logger.debug(`Generating structured object via Jeju Compute`, {
        model,
        promptLength: prompt.length,
        agentId: runtime.agentId,
      })

      // Build system prompt that enforces JSON output
      const schemaDescription = JSON.stringify(
        schema._def,
        (key, value) => {
          if (key === '_def') return undefined
          return value
        },
        2,
      )

      const systemPrompt = `${runtime.character?.system ?? 'You are a helpful AI assistant.'}

You must respond with valid JSON that matches this schema:
${schemaDescription}

Only respond with the JSON object, no additional text or markdown.`

      const messages = [
        {
          role: 'system' as const,
          content: systemPrompt,
        },
        {
          role: 'user' as const,
          content: prompt,
        },
      ]

      // Run inference
      const response = await llmInferenceService.inference({
        model,
        messages,
        temperature: options.temperature ?? temperature,
        maxTokens: options.maxTokens ?? maxTokens,
      })

      // Parse and validate JSON response
      let parsed: unknown
      try {
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = response.content.trim()
        if (jsonStr.startsWith('```json')) {
          jsonStr = jsonStr.slice(7)
        }
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.slice(3)
        }
        if (jsonStr.endsWith('```')) {
          jsonStr = jsonStr.slice(0, -3)
        }
        jsonStr = jsonStr.trim()

        parsed = JSON.parse(jsonStr)
      } catch (error) {
        logger.error(`Failed to parse JSON response`, {
          content: response.content.slice(0, 200),
          error: error instanceof Error ? error.message : String(error),
        })
        throw new Error(
          `Failed to parse LLM response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }

      // Validate against schema
      const result = schema.safeParse(parsed)
      if (!result.success) {
        logger.error(`Response does not match schema`, {
          errors: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
          content: response.content.slice(0, 200),
        })
        throw new Error(
          `LLM response does not match expected schema: ${result.error.message}`,
        )
      }

      logger.debug(`Generated structured object`, {
        model: response.model,
        tokens: response.usage.totalTokens,
        cost: response.cost,
      })

      return result.data
    },

    getConfig() {
      return {
        defaultModel,
        maxTokens,
        temperature,
      }
    },
  }
}

/**
 * Default Jeju provider instance
 */
let defaultProvider: JejuProvider | null = null

/**
 * Get the default Jeju provider
 */
export function getJejuProvider(): JejuProvider {
  if (!defaultProvider) {
    defaultProvider = createJejuProvider()
  }
  return defaultProvider
}

/**
 * Reset the default provider (for testing)
 */
export function resetJejuProvider(): void {
  defaultProvider = null
}
