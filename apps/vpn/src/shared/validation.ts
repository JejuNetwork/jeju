/**
 * Shared validation utilities
 *
 * Fail-fast validation helpers used across frontend and server
 */

import type { z } from 'zod'

/**
 * Expect a value to match schema, throw if invalid
 */
export function expectValid<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context?: string,
): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new Error(
      `Validation failed${context ? ` in ${context}` : ''}: ${errors}`,
    )
  }
  return result.data
}

/**
 * Expect a value to exist, throw if null/undefined
 * Type guard that narrows type
 */
export function expectExists<T>(
  value: T | null | undefined,
  message: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message)
  }
}

/**
 * Expect a condition to be true, throw if false
 */
export function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * Get a value after asserting it exists
 */
export function getExists<T>(value: T | null | undefined, message: string): T {
  expectExists(value, message)
  return value
}
