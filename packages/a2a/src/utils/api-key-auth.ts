/**
 * A2A API Key Authentication Utilities
 *
 * Generic utilities for API key validation (framework-agnostic)
 */

import { logger } from './logger'

export const A2A_API_KEY_HEADER = 'x-a2a-api-key'

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true if strings are equal, false otherwise.
 * Takes the same amount of time regardless of where strings differ.
 */
function constantTimeEqual(a: string, b: string): boolean {
  // Always compare same length to prevent timing leak
  const maxLen = Math.max(a.length, b.length)
  let result = a.length ^ b.length // Non-zero if lengths differ

  for (let i = 0; i < maxLen; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0
    const charB = i < b.length ? b.charCodeAt(i) : 0
    result |= charA ^ charB
  }

  return result === 0
}

/**
 * Configuration for API key authentication
 */
export interface ApiKeyAuthConfig {
  requiredApiKey?: string
  allowLocalhost?: boolean
  headerName?: string
}

/**
 * Request-like interface for generic handling
 */
export interface AuthRequest {
  headers: {
    get(name: string): string | null
  }
  host?: string
}

/**
 * Authentication result
 */
export interface AuthResult {
  authenticated: boolean
  error?: string
  statusCode?: number
}

/**
 * Check if host is localhost
 */
export function isLocalHost(host: string | undefined | null): boolean {
  if (!host) return false
  const lowerHost = host.toLowerCase()
  return (
    lowerHost.startsWith('localhost') ||
    lowerHost.startsWith('127.0.0.1') ||
    lowerHost.startsWith('::1')
  )
}

/**
 * Validate API key from request headers
 *
 * @param request - Request with headers
 * @param config - Authentication configuration
 * @returns Authentication result
 */
export function validateApiKey(
  request: AuthRequest,
  config: ApiKeyAuthConfig = {},
): AuthResult {
  const {
    requiredApiKey,
    allowLocalhost = true,
    headerName = A2A_API_KEY_HEADER,
  } = config

  // Get host from headers if available
  const host = request.host ?? request.headers.get('host')

  // Allow localhost in development if configured
  if (allowLocalhost && isLocalHost(host)) {
    return { authenticated: true }
  }

  // Check if API key is configured
  if (!requiredApiKey) {
    logger.error('A2A API key is not configured', {}, 'A2AAuth')
    return {
      authenticated: false,
      error: 'A2A server is not configured. Contact support.',
      statusCode: 503,
    }
  }

  // Validate provided API key using constant-time comparison
  // to prevent timing attacks
  const providedKey = request.headers.get(headerName) ?? ''
  if (!constantTimeEqual(providedKey, requiredApiKey)) {
    // SECURITY: Don't log key prefixes - could help attackers guess keys
    logger.warn(
      'Invalid or missing A2A API key',
      {
        headerPresent: providedKey.length > 0,
      },
      'A2AAuth',
    )
    return {
      authenticated: false,
      error: `Unauthorized: Valid ${headerName} header is required`,
      statusCode: 401,
    }
  }

  return { authenticated: true }
}

/**
 * Get the required API key from environment
 */
export function getRequiredApiKey(): string | undefined {
  return process.env.A2A_API_KEY
}
