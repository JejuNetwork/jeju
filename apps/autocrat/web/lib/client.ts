import { treaty } from '@elysiajs/eden'
import { isPlainObject, validateOrNull } from '@jejunetwork/types'
import { z } from 'zod'
// Type-only import for Eden type inference - no runtime dependency
import type { App } from '../../api/server'
import { AUTOCRAT_API_URL } from '../config/env'

const API_BASE = AUTOCRAT_API_URL

/**
 * Typed Eden Treaty client for Autocrat API
 * All endpoints are fully typed based on the server definition
 *
 * Uses explicit Treaty type assertion due to Eden/Elysia version
 * alignment in monorepo environments
 */
export const api = treaty<App>(API_BASE)

/**
 * Zod schema for Eden error value - possible structures from validation errors
 */
const EdenErrorValueSchema = z.object({
  type: z.string().optional(),
  on: z.string().optional(),
  summary: z.string().optional(),
  message: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
})

/**
 * Extract error message from Eden Treaty error value
 */
function getErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (isPlainObject(value)) {
    const v = validateOrNull(EdenErrorValueSchema, value)
    if (v) {
      return v.message ?? v.summary ?? v.error?.message ?? 'API error'
    }
  }
  return 'API error'
}

/**
 * Eden Treaty response shape - union of success and error states
 * This matches the actual TreatyResponse type from @elysiajs/eden
 */
type EdenResponse<T> =
  | { data: T; error: null }
  | {
      data: null
      error: { status: number; value: unknown } | { value: unknown }
    }

/**
 * Extract data from Eden response, throwing on error
 * Uses generic error type to accept actual TreatyResponse shape
 */
export function extractData<T>(response: EdenResponse<T>): T {
  if (response.error) {
    throw new Error(getErrorMessage(response.error.value))
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
  response: EdenResponse<T>,
  defaultValue: T,
): T {
  if (response.error) {
    throw new Error(getErrorMessage(response.error.value))
  }
  return response.data ?? defaultValue
}
