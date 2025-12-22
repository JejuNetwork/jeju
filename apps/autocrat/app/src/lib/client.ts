/**
 * Typed Eden Treaty Client for Autocrat API
 *
 * Provides full type inference from the Elysia server
 */

import { treaty } from '@elysiajs/eden'
import type { App } from '../../../src/server'

const API_BASE = import.meta.env.VITE_AUTOCRAT_API || ''

/**
 * Typed Eden Treaty client for Autocrat API
 * All endpoints are fully typed based on the server definition
 */
// @ts-expect-error - elysia version mismatch between app and server in monorepo
export const api = treaty<App>(API_BASE)

/**
 * Extract data from Eden response, throwing on error
 */
export function extractData<T>(response: {
  data: T | null
  error: unknown
}): T {
  if (response.error) {
    const err = response.error as {
      message?: string
      error?: { message: string }
    }
    throw new Error(err.message || err.error?.message || 'Unknown error')
  }
  if (response.data === null) {
    throw new Error('No data returned')
  }
  return response.data
}

/**
 * Extract data with a default value for null responses
 */
export function extractDataOrDefault<T>(
  response: { data: T | null; error: unknown },
  defaultValue: T,
): T {
  if (response.error) {
    const err = response.error as {
      message?: string
      error?: { message: string }
    }
    throw new Error(err.message || err.error?.message || 'Unknown error')
  }
  return response.data ?? defaultValue
}
