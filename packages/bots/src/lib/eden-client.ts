/**
 * Typed API Client for Bot Services
 *
 * Type-safe HTTP client for internal API calls.
 */

import type { z } from 'zod'

/** Request options for API client */
export interface ApiRequestOptions {
  headers?: Record<string, string>
  timeout?: number
}

/**
 * Check health of an endpoint
 */
export async function checkApiHealth(
  baseUrl: string,
  path = '/health',
  timeout = 5000,
): Promise<boolean> {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null)
  return response?.ok ?? false
}

/**
 * Validated fetch helper with Zod validation
 */
export async function fetchAndValidate<T>(
  url: string,
  schema: z.ZodType<T>,
  options?: RequestInit & { timeout?: number },
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options?.timeout ?? 30000),
  })

  if (!response.ok) {
    const error = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${error || response.statusText}`)
  }

  const rawData: unknown = await response.json()
  return schema.parse(rawData)
}

/**
 * Create an API client with typed methods
 */
export function createApiClient(
  baseUrl: string,
  options: ApiRequestOptions = {},
) {
  const { headers: defaultHeaders = {}, timeout = 30000 } = options
  const normalizedUrl = baseUrl.replace(/\/$/, '')

  async function request<T>(
    path: string,
    init: RequestInit,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const response = await fetch(`${normalizedUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...defaultHeaders,
        ...(init.headers as Record<string, string>),
      },
      signal: AbortSignal.timeout(timeout),
    })

    if (!response.ok) {
      const error = await response.text().catch(() => '')
      throw new Error(
        `HTTP ${response.status}: ${error || response.statusText}`,
      )
    }

    const data: unknown = await response.json()
    if (schema) {
      return schema.parse(data)
    }
    return data as T
  }

  return {
    get<T>(path: string, schema?: z.ZodType<T>): Promise<T> {
      return request(path, { method: 'GET' }, schema)
    },

    post<T>(
      path: string,
      body: Record<string, unknown>,
      schema?: z.ZodType<T>,
    ): Promise<T> {
      return request(
        path,
        { method: 'POST', body: JSON.stringify(body) },
        schema,
      )
    },

    put<T>(
      path: string,
      body: Record<string, unknown>,
      schema?: z.ZodType<T>,
    ): Promise<T> {
      return request(
        path,
        { method: 'PUT', body: JSON.stringify(body) },
        schema,
      )
    },

    delete<T>(path: string, schema?: z.ZodType<T>): Promise<T> {
      return request(path, { method: 'DELETE' }, schema)
    },

    checkHealth(): Promise<boolean> {
      return checkApiHealth(normalizedUrl)
    },
  }
}

// Re-export legacy names for backwards compatibility
export const createEdenClient = createApiClient
export const checkEdenHealth = checkApiHealth
