/**
 * Framework-Agnostic Error Handler
 *
 * Provides standardized error handling and error types.
 */

import { z } from 'zod'

// ============ Error Types ============

/**
 * Base API error with status code
 */
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'APIError'
  }

  toJSON(): {
    error: string
    code: string
    statusCode: number
    details?: Record<string, unknown>
  } {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details }),
    }
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends APIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', details)
    this.name = 'ValidationError'
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends APIError {
  constructor(resource: string, id?: string) {
    const message = id
      ? `${resource} not found: ${id}`
      : `${resource} not found`
    super(message, 404, 'NOT_FOUND', { resource, id })
    this.name = 'NotFoundError'
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends APIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT', details)
    this.name = 'ConflictError'
  }
}

/**
 * Service unavailable error (503)
 */
export class ServiceUnavailableError extends APIError {
  constructor(service: string, details?: Record<string, unknown>) {
    super(`Service unavailable: ${service}`, 503, 'SERVICE_UNAVAILABLE', {
      service,
      ...details,
    })
    this.name = 'ServiceUnavailableError'
  }
}

/**
 * Internal server error (500)
 */
export class InternalError extends APIError {
  constructor(message: string = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR')
    this.name = 'InternalError'
  }
}

// ============ Error Response Type ============

export interface ErrorResponse {
  error: string
  code: string
  statusCode?: number
  details?: Record<string, unknown>
  stack?: string
}

// ============ Error Handlers ============

/**
 * Sanitize error message for production (hide sensitive details)
 */
export function sanitizeErrorMessage(
  error: Error,
  isDevelopment: boolean,
): string {
  if (isDevelopment) {
    return error.message
  }

  // In production, hide detailed error messages
  if (error instanceof APIError) {
    return error.message
  }

  // Generic message for unexpected errors
  return 'An unexpected error occurred'
}

/**
 * Convert any error to an ErrorResponse
 */
export function toErrorResponse(
  error: Error,
  isDevelopment: boolean = false,
): ErrorResponse {
  if (error instanceof APIError) {
    return {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details,
      ...(isDevelopment && { stack: error.stack }),
    }
  }

  if (error instanceof z.ZodError) {
    const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    return {
      error: `Validation failed: ${issues.join(', ')}`,
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: { issues: error.issues },
      ...(isDevelopment && { stack: error.stack }),
    }
  }

  // Generic error
  return {
    error: sanitizeErrorMessage(error, isDevelopment),
    code: 'INTERNAL_ERROR',
    statusCode: 500,
    ...(isDevelopment && { stack: error.stack }),
  }
}

/**
 * Get HTTP status code from error
 */
export function getStatusCode(error: Error): number {
  if (error instanceof APIError) {
    return error.statusCode
  }
  if (error instanceof z.ZodError) {
    return 400
  }
  return 500
}

// ============ Validation Helpers ============

/**
 * Expect a value to be defined (fail-fast)
 */
export function expectDefined<T>(
  value: T | null | undefined,
  message: string,
): T {
  if (value === null || value === undefined) {
    throw new ValidationError(message)
  }
  return value
}

/**
 * Validate with Zod schema (fail-fast)
 */
export function expectValid<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string = 'data',
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new ValidationError(`Invalid ${context}: ${errors}`, {
      issues: result.error.issues,
    })
  }
  return result.data
}

/**
 * Assert a condition (fail-fast)
 */
export function assert(
  condition: boolean,
  message: string,
  statusCode: number = 400,
  code: string = 'ASSERTION_FAILED',
): asserts condition {
  if (!condition) {
    throw new APIError(message, statusCode, code)
  }
}

// ============ Elysia Error Handler ============

/**
 * Create Elysia-compatible error handler
 */
export function createElysiaErrorHandler(isDevelopment: boolean = false) {
  return function handleError({
    error,
    set,
  }: {
    error: Error
    set: { status: number }
  }): ErrorResponse {
    const response = toErrorResponse(error, isDevelopment)
    set.status = getStatusCode(error)
    return response
  }
}
