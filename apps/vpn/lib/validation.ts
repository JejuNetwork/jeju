import type { z } from 'zod'

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

export function expectExists<T>(
  value: T | null | undefined,
  message: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message)
  }
}

export function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export function getExists<T>(value: T | null | undefined, message: string): T {
  expectExists(value, message)
  return value
}
