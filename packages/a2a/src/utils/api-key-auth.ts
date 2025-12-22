/**
 * A2A API Key Authentication Utilities
 *
 * Generic utilities for API key validation (framework-agnostic)
 */

import { logger } from './logger'

export const A2A_API_KEY_HEADER = 'x-a2a-api-key'

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

  // Validate provided API key
  const providedKey = request.headers.get(headerName)
  if (providedKey !== requiredApiKey) {
    logger.warn(
      'Invalid or missing A2A API key',
      {
        headerPresent: Boolean(providedKey),
        providedPrefix: providedKey?.slice(0, 6) || 'empty',
        expectedPrefix: requiredApiKey?.slice(0, 6) || 'not-set',
        providedLength: providedKey?.length || 0,
        expectedLength: requiredApiKey?.length || 0,
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
