/**
 * MCP API Key Authentication
 *
 * Provides interfaces and utilities for API key based authentication.
 * Implementations should provide their own validation logic.
 */

/**
 * Result of API key validation
 */
export interface ApiKeyValidationResult {
  userId: string
  agentId?: string
  metadata?: Record<string, unknown>
}

/**
 * API Key validator function type
 */
export type ApiKeyValidator = (
  apiKey: string,
) => Promise<ApiKeyValidationResult | null>

/**
 * Default validator that always returns null (no authentication)
 * Override this in your implementation
 */
export const defaultApiKeyValidator: ApiKeyValidator = async () => null

/**
 * Create a simple in-memory API key validator for testing
 *
 * @param keys - Map of API keys to user IDs
 * @returns API key validator function
 */
export function createInMemoryApiKeyValidator(
  keys: Map<string, string>,
): ApiKeyValidator {
  return async (apiKey: string): Promise<ApiKeyValidationResult | null> => {
    const userId = keys.get(apiKey)
    if (!userId) {
      return null
    }
    return { userId, agentId: userId }
  }
}

/**
 * Create a hash-based API key validator
 *
 * @param hashFn - Function to hash API keys
 * @param lookupFn - Function to lookup user by key hash
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
