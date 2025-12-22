/**
 * Example App Eden Client
 *
 * Type-safe client for the example Elysia backend using Eden treaty.
 * Follows the established pattern from apps/bazaar/lib/api.ts and apps/gateway/src/client/index.ts
 */

import { treaty } from '@elysiajs/eden'
import type { App } from '../server/index'

// ============================================================================
// Eden Treaty Client
// ============================================================================

/**
 * Get the API base URL based on environment
 */
function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // Browser: check for configured API URL first
    const configuredUrl =
      typeof process !== 'undefined' ? process.env.API_URL : undefined
    if (configuredUrl) return configuredUrl

    // Default to relative path for same-origin
    return ''
  }
  // Server-side: use configured URL
  return process.env.API_URL || 'http://localhost:4500'
}

/**
 * Create an Eden treaty client with optional custom headers
 */
export function createExampleClient(
  baseUrl?: string,
  options?: { headers?: Record<string, string> },
) {
  return treaty<App>(
    baseUrl || getApiBaseUrl(),
    options?.headers ? { headers: options.headers } : {},
  )
}

/**
 * Default Eden treaty client for the example app
 */
export const api = createExampleClient()

export type ExampleClient = ReturnType<typeof createExampleClient>

// ============================================================================
// API Error Handling
// ============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface EdenErrorValue {
  error?: string
  message?: string
  code?: string
}

/**
 * Handle Eden response and throw on error
 */
export function handleEdenResponse<T>(response: {
  data: T | null
  error: { value: EdenErrorValue | string; status: number } | null
}): T {
  if (response.error) {
    const status = response.error.status
    const errorValue = response.error.value
    const message =
      typeof errorValue === 'string'
        ? errorValue
        : errorValue?.error || errorValue?.message || 'API request failed'
    throw new ApiError(message, status)
  }
  if (response.data === null) {
    throw new ApiError('No data returned', 500)
  }
  return response.data
}

// ============================================================================
// Auth Header Utilities
// ============================================================================

export interface AuthHeadersInput {
  address: string
  signMessage: (message: string) => Promise<string>
}

/**
 * Generate auth headers for API requests
 */
export async function generateAuthHeaders(
  input: AuthHeadersInput,
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  const message = `jeju-dapp:${timestamp}`
  const signature = await input.signMessage(message)

  return {
    'Content-Type': 'application/json',
    'x-jeju-address': input.address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  }
}

/**
 * Create an authenticated client with generated auth headers
 */
export async function createAuthenticatedClient(
  input: AuthHeadersInput,
  baseUrl?: string,
): Promise<ExampleClient> {
  const headers = await generateAuthHeaders(input)
  return createExampleClient(baseUrl, { headers })
}

// ============================================================================
// Type Re-exports
// ============================================================================

export type { App } from '../server/index'
