/**
 * LLM Provider for ElizaOS
 *
 * Provides Jeju Compute as an LLM provider for ElizaOS agents.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import type { IAgentRuntime } from '@elizaos/core'

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
}

/**
 * Create a Jeju LLM provider for ElizaOS
 */
export function createJejuProvider(config: JejuProviderConfig = {}) {
  const defaultModel = config.defaultModel ?? 'Qwen/Qwen2.5-3B-Instruct'
  const maxTokens = config.maxTokens ?? 2048
  const temperature = config.temperature ?? 0.7

  return {
    name: 'jeju-compute',
    
    async generateText(
      _runtime: IAgentRuntime,
      prompt: string,
      options: GenerateTextOptions = {},
    ): Promise<string> {
      logger.debug(`Generating text via Jeju Compute: model=${options.model ?? defaultModel}, promptLength=${prompt.length}`)

      // TODO: Integrate with Jeju Compute SDK
      throw new Error('Not implemented - requires Jeju Compute integration')
    },

    async generateObject<T extends Record<string, unknown>>(
      _runtime: IAgentRuntime,
      _prompt: string,
      _schema: Record<string, unknown>,
      _options: GenerateTextOptions = {},
    ): Promise<T> {
      throw new Error('Not implemented')
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
    schema: Record<string, unknown>,
    options?: GenerateTextOptions,
  ): Promise<T>
  getConfig(): JejuProviderConfig
}
