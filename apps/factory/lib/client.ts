/**
 * Typed Eden Treaty Client for Factory API
 *
 * Provides fully typed API calls with end-to-end type safety
 * from Elysia routes to client code.
 */

import { treaty } from '@elysiajs/eden'
import { getCoreAppUrl } from '@jejunetwork/config/ports'
import type { App } from '../src/server'

const API_BASE =
  typeof window !== 'undefined'
    ? ''
    : process.env.FACTORY_API_URL || getCoreAppUrl('FACTORY')

/**
 * Typed Eden Treaty client for Factory API
 *
 * Usage:
 * ```ts
 * // GET request
 * const { data, error } = await api.api.packages.get({ query: { q: 'search' } })
 *
 * // POST request
 * const { data, error } = await api.api.packages.post({ body: { name: 'pkg' } })
 * ```
 */
export const api = treaty<App>(API_BASE)

/**
 * Response type from Eden Treaty calls
 */
export type EdenResponse<T> = {
  data: T | null
  error: {
    status: number
    message: string
    value: unknown
  } | null
}

/**
 * Extract data from Eden response, throwing on error
 *
 * @throws Error if response contains an error or no data
 */
export function extractData<T>(response: {
  data: T | null
  error: unknown
}): T {
  if (response.error) {
    const err = response.error as { message?: string; value?: unknown }
    throw new Error(
      err.message || (typeof err.value === 'string' ? err.value : 'API Error'),
    )
  }
  if (response.data === null) {
    throw new Error('No data returned from API')
  }
  return response.data
}

/**
 * Safely extract data from Eden response, returning null on error
 */
export function extractDataSafe<T>(response: {
  data: T | null
  error: unknown
}): T | null {
  if (response.error || response.data === null) {
    return null
  }
  return response.data
}

export type FactoryClient = typeof api
