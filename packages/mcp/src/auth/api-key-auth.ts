/**
 * API key authentication for MCP requests.
 *
 * Provides typed integration with @jejunetwork/api auth system.
 */

import type { JsonValue } from '../types/mcp'

/**
 * Result of API key validation
 */
export interface ApiKeyValidationResult {
  userId: string
  agentId: string
  metadata?: Record<string, JsonValue>
}

/**
 * API Key validator function type
 * Must be implemented by consumers - no default stub
 */
export type ApiKeyValidator = (
  apiKey: string,
) => Promise<ApiKeyValidationResult | null>

/**
 * Configuration for creating an API key validator
 */
export interface ApiKeyValidatorConfig {
  /** Map of API keys to validation results */
  keys: Map<string, ApiKeyValidationResult>
}

/**
 * Create an API key validator from a static key map
 *
 * @param config - Validator configuration with key map
 * @returns API key validator function
 */
export function createApiKeyValidator(
  config: ApiKeyValidatorConfig,
): ApiKeyValidator {
  return async (apiKey: string): Promise<ApiKeyValidationResult | null> => {
    const result = config.keys.get(apiKey)
    if (!result) return null
    return result
  }
}

/**
 * Create a hash-based API key validator for secure key storage
 *
 * @param hashFn - Function to hash API keys (e.g., SHA-256)
 * @param lookupFn - Function to lookup user by key hash from database
 * @returns API key validator function
 */
export function createHashBasedApiKeyValidator(
  hashFn: (apiKey: string) => string,
  lookupFn: (keyHash: string) => Promise<ApiKeyValidationResult | null>,
): ApiKeyValidator {
  return async (apiKey: string): Promise<ApiKeyValidationResult | null> => {
    const keyHash = hashFn(apiKey)
    return lookupFn(keyHash)
  }
}

