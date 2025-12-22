/**
 * Typed API Client for OAuth3 Services
 */

import type { z } from 'zod'

export interface EdenRequestOptions {
  headers?: Record<string, string>
  timeout?: number
}

export function unwrapEden<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) {
    throw new Error(
      result.error instanceof Error ? result.error.message : String(result.error),
    )
  }
  return result.data as T
}

export async function checkEdenHealth(
  baseUrl: string,
  path = '/health',
  timeout = 5000,
): Promise<boolean> {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null)
  return response?.ok ?? false
}

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
  return schema.parse(await response.json())
}
