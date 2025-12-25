/**
 * Safe JSON Parsing Utilities
 *
 * Replaces the dangerous `.catch(() => ({}))` pattern with proper error handling.
 * Always returns a result object instead of throwing.
 *
 * @module @jejunetwork/shared/json
 */

import { logger } from '../logger'

export interface ParseResult<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Safely parse JSON from a Response object
 *
 * Parses a fetch Response's JSON body, returning a result object instead of throwing.
 * Handles network errors, invalid JSON, and empty responses gracefully.
 *
 * @param response - Fetch Response object to parse
 * @param context - Optional context string for error logging
 * @returns Promise resolving to ParseResult with success flag and data or error
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/data')
 * const result = await parseJsonResponse<MyType>(response)
 * if (result.success) {
 *   console.log(result.data) // Typed data
 * } else {
 *   console.error(result.error) // Error message
 * }
 * ```
 */
export async function parseJsonResponse<T = unknown>(
  response: Response,
  context?: string,
): Promise<ParseResult<T>> {
  try {
    const data = (await response.json()) as T
    return { success: true, data }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to parse JSON'
    logger.warn('JSON parse failed', {
      context,
      status: response.status,
      contentType: response.headers.get('content-type'),
      error: errorMessage,
    })
    return { success: false, error: errorMessage }
  }
}

/**
 * Parse JSON string with proper error handling
 *
 * Safely parses a JSON string, returning a result object instead of throwing.
 * Useful for parsing user input or cached data where errors are expected.
 *
 * @param jsonString - JSON string to parse (can be null/undefined)
 * @param context - Optional context string for error logging
 * @returns ParseResult with success flag and data or error message
 *
 * @example
 * ```typescript
 * const result = parseJsonString('{"key": "value"}')
 * if (result.success) {
 *   console.log(result.data) // { key: "value" }
 * } else {
 *   console.error(result.error) // Error message
 * }
 * ```
 */
export function parseJsonString<T = unknown>(
  jsonString: string | null | undefined,
  context?: string,
): ParseResult<T> {
  if (!jsonString) {
    return { success: false, error: 'Empty or null input' }
  }

  try {
    const data = JSON.parse(jsonString)
    return { success: true, data }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to parse JSON'
    logger.warn('JSON string parse failed', {
      context,
      preview: jsonString.substring(0, 100),
      error: errorMessage,
    })
    return { success: false, error: errorMessage }
  }
}

/**
 * Parse JSON with fallback value
 *
 * Parses JSON string, returning fallback value if parsing fails.
 * Use this ONLY when a fallback is truly acceptable - prefer parseJsonString
 * for better error handling.
 *
 * @param jsonString - JSON string to parse (can be null/undefined)
 * @param fallback - Value to return if parsing fails
 * @param context - Optional context string for error logging
 * @returns Parsed data or fallback value
 *
 * @example
 * ```typescript
 * const data = parseJsonWithFallback('invalid', { default: 'value' })
 * // Returns: { default: 'value' } (fallback)
 * ```
 */
export function parseJsonWithFallback<T>(
  jsonString: string | null | undefined,
  fallback: T,
  context?: string,
): T {
  const result = parseJsonString<T>(jsonString, context)
  if (result.success && result.data !== undefined) {
    return result.data
  }
  return fallback
}

/**
 * Try to parse JSON, returning undefined on failure
 *
 * Useful when you want to handle missing/invalid data inline.
 *
 * @param jsonString - JSON string to parse
 * @returns Parsed data or undefined
 *
 * @example
 * ```typescript
 * const config = tryParseJson<Config>(rawConfig) ?? defaultConfig
 * ```
 */
export function tryParseJson<T = unknown>(
  jsonString: string | null | undefined,
): T | undefined {
  if (!jsonString) return undefined
  try {
    return JSON.parse(jsonString) as T
  } catch {
    return undefined
  }
}

/**
 * Stringify value to JSON with error handling
 *
 * @param value - Value to stringify
 * @param pretty - Whether to format output (default: false)
 * @returns JSON string or undefined on error
 */
export function tryStringifyJson(
  value: unknown,
  pretty = false,
): string | undefined {
  try {
    return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)
  } catch {
    return undefined
  }
}
