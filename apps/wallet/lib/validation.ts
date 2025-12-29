import {
  expectNonEmptyString,
  expectValid,
  expectJson as typesExpectJson,
} from '@jejunetwork/types'
import type { z } from 'zod'

/**
 * Validates a non-empty string
 * Wrapper around expectNonEmptyString for backwards compatibility
 * (types/validation's expectNonEmpty is for arrays)
 */
export function expectNonEmpty(value: string, fieldName: string): string {
  return expectNonEmptyString(value, fieldName)
}

/**
 * Validates an object against a schema, throwing on failure
 * Wrapper with (value, schema) parameter order for backwards compatibility
 */
export function expectSchema<T>(
  value: unknown,
  schema: z.ZodType<T>,
  fieldName = 'value',
): T {
  return expectValid(schema, value, fieldName)
}

/**
 * Returns the value if defined, throws if null/undefined
 * Unlike the asserts version, this returns the narrowed value
 */
export function requireDefined<T>(
  value: T | null | undefined,
  fieldName: string,
): T {
  if (value === null || value === undefined) {
    throw new Error(`${fieldName} is required`)
  }
  return value
}

/**
 * Parse JSON and validate against schema
 * @param json - JSON string to parse
 * @param schema - Zod schema to validate against
 * @param fieldName - Optional field name for error messages
 */
export function parseJson<T>(
  json: string,
  schema: z.ZodType<T>,
  fieldName = 'json',
): T {
  return typesExpectJson(json, schema, fieldName)
}

/**
 * Alias for parseJson for backwards compatibility
 */
export const expectJson = parseJson
