/**
 * Model Registry
 *
 * Centralized configuration for all models available for benchmarking.
 * Add new models here to make them available for comparison.
 *
 * @packageDocumentation
 */

import type { ModelConfig, ModelProvider, ModelTier } from './types'

/**
 * Registry of all available models for benchmarking
 */
export const MODEL_REGISTRY: ModelConfig[] = [
  {
    id: 'llama-8b',
    displayName: 'LLaMA 3.1 8B',
    provider: 'groq',
    modelId: 'llama-3.1-8b-instant',
    tier: 'lite',
    parametersBillions: 8,
    isBaseline: true,
  },
  {
    id: 'llama-70b',
    displayName: 'LLaMA 3.1 70B',
    provider: 'groq',
    modelId: 'llama-3.1-70b-versatile',
    tier: 'standard',
    parametersBillions: 70,
    isBaseline: false,
  },
  {
    id: 'qwen-32b',
    displayName: 'Qwen 3 32B',
    provider: 'groq',
    modelId: 'qwen/qwen3-32b',
    tier: 'standard',
    parametersBillions: 32,
    isBaseline: true,
  },
  {
    id: 'mixtral-8x7b',
    displayName: 'Mixtral 8x7B',
    provider: 'groq',
    modelId: 'mixtral-8x7b-32768',
    tier: 'standard',
    parametersBillions: 46,
    isBaseline: false,
  },
  {
    id: 'gpt-5.2',
    displayName: 'GPT-5.2',
    provider: 'openai',
    modelId: 'gpt-5.2',
    tier: 'pro',
    isBaseline: false,
  },
  {
    id: 'claude-opus',
    displayName: 'Claude Opus 4.5',
    provider: 'anthropic',
    modelId: 'claude-opus-4-5',
    tier: 'pro',
    isBaseline: false,
  },
  {
    id: 'claude-sonnet',
    displayName: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    tier: 'pro',
    isBaseline: false,
  },
]

/**
 * Get a model config by ID
 */
export function getModelById(id: string): ModelConfig | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id)
}

/**
 * Get a model config by model ID (API identifier)
 */
export function getModelByModelId(modelId: string): ModelConfig | undefined {
  return MODEL_REGISTRY.find((m) => m.modelId === modelId)
}

/**
 * Get all baseline models
 */
export function getBaselineModels(): ModelConfig[] {
  return MODEL_REGISTRY.filter((m) => m.isBaseline)
}

/**
 * Get models by provider
 */
export function getModelsByProvider(provider: ModelProvider): ModelConfig[] {
  return MODEL_REGISTRY.filter((m) => m.provider === provider)
}

/**
 * Get models by tier
 */
export function getModelsByTier(tier: ModelTier): ModelConfig[] {
  return MODEL_REGISTRY.filter((m) => m.tier === tier)
}

/**
 * Validate that a model ID exists
 */
export function validateModelId(id: string): boolean {
  return MODEL_REGISTRY.some((m) => m.id === id || m.modelId === id)
}

/**
 * Get model display name (supports both id and modelId)
 */
export function getModelDisplayName(idOrModelId: string): string {
  const model = getModelById(idOrModelId) ?? getModelByModelId(idOrModelId)
  return model?.displayName ?? idOrModelId
}

/**
 * Add a custom model to the registry
 */
export function registerModel(config: ModelConfig): void {
  const existing = MODEL_REGISTRY.findIndex((m) => m.id === config.id)
  if (existing >= 0) {
    MODEL_REGISTRY[existing] = config
  } else {
    MODEL_REGISTRY.push(config)
  }
}

/**
 * Get all models in the registry
 */
export function getAllModels(): ModelConfig[] {
  return [...MODEL_REGISTRY]
}
