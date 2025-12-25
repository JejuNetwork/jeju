/**
 * Otto Validation Utilities
 */

/**
 * Get a required environment variable, with optional default for development
 */
export function getRequiredEnv(name: string, defaultValue?: string): string {
  const value = process.env[name]
  if (value) return value
  if (defaultValue !== undefined) return defaultValue
  throw new Error(`Missing required environment variable: ${name}`)
}

/**
 * Validate a session ID format and return it if valid, otherwise throw
 */
export function validateSessionId(sessionId: string): string {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid session ID: must be a non-empty string')
  }
  const trimmed = sessionId.trim()
  if (trimmed.length === 0) {
    throw new Error('Invalid session ID: cannot be empty')
  }
  return trimmed
}

/**
 * Validate a nonce value
 */
export function validateNonce(nonce: string): boolean {
  if (!nonce || typeof nonce !== 'string') {
    return false
  }
  // Nonces should be non-empty strings with sufficient length for security
  return nonce.trim().length >= 8
}

/**
 * Validate platform identifier
 */
export function validatePlatform(platform: string): boolean {
  const validPlatforms = ['telegram', 'farcaster', 'web', 'api', 'miniapp']
  return validPlatforms.includes(platform.toLowerCase())
}
