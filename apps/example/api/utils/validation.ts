import type { z } from 'zod'

type ZodError = z.ZodError
type ZodSchema<T = unknown> = z.ZodType<T>

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError?: ZodError,
  ) {
    super(message)
    this.name = 'ValidationError'
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

function formatZodError(error: ZodError, context?: string): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
    return `${path}: ${issue.message}`
  })

  const message = issues.join('; ')
  return context ? `${context}: ${message}` : message
}

export function expectValid<T>(
  schema: ZodSchema<T>,
  data: unknown,
  context?: string,
): T {
  const result = schema.safeParse(data)

  if (!result.success) {
    const errorMessage = formatZodError(result.error, context)
    throw new ValidationError(errorMessage, result.error)
  }

  return result.data
}

export function validateOrThrow<T>(
  schema: ZodSchema<T>,
  data: unknown,
  context?: string,
): T {
  return expectValid(schema, data, context)
}

export function expectDefined<T>(
  value: T | null | undefined,
  message?: string,
): T {
  if (value === null || value === undefined) {
    throw new ValidationError(message || 'Expected value to be defined')
  }
  return value
}

export function expectTruthy<T>(
  value: T | null | undefined | false | 0 | '' | 0n,
  message?: string,
): T {
  if (!value) {
    throw new ValidationError(message || 'Expected value to be truthy')
  }
  return value
}

export function expectInRange(
  value: number,
  min: number,
  max: number,
  context?: string,
): number {
  if (value < min || value > max) {
    throw new ValidationError(
      context
        ? `${context}: Expected value between ${min} and ${max}, got ${value}`
        : `Expected value between ${min} and ${max}, got ${value}`,
    )
  }
  return value
}

export function expectMatch(
  value: string,
  pattern: RegExp,
  message?: string,
): string {
  if (!pattern.test(value)) {
    throw new ValidationError(
      message || `Expected string to match pattern ${pattern}, got: ${value}`,
    )
  }
  return value
}

export function expectMinLength<T>(
  array: T[],
  minLength: number,
  context?: string,
): T[] {
  if (array.length < minLength) {
    throw new ValidationError(
      context
        ? `${context}: Expected array with at least ${minLength} elements, got ${array.length}`
        : `Expected array with at least ${minLength} elements, got ${array.length}`,
    )
  }
  return array
}

export function expectMaxLength<T>(
  array: T[],
  maxLength: number,
  context?: string,
): T[] {
  if (array.length > maxLength) {
    throw new ValidationError(
      context
        ? `${context}: Expected array with at most ${maxLength} elements, got ${array.length}`
        : `Expected array with at most ${maxLength} elements, got ${array.length}`,
    )
  }
  return array
}

export function sanitizeErrorMessage(
  error: Error | ValidationError,
  isLocalnet: boolean,
): string {
  if (error instanceof ValidationError) {
    return error.message
  }

  if (isLocalnet) {
    return error.message
  }

  const message = error.message.toLowerCase()

  if (
    message.includes('not found') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('bad request') ||
    message.includes('invalid')
  ) {
    return error.message
      .replace(/\/[^\s]+/g, '[path]')
      .replace(/at .+$/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return 'An internal error occurred'
}
