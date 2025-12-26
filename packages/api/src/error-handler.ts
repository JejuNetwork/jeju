import type { JsonValue } from '@jejunetwork/types'
import { z } from 'zod'

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: Record<string, JsonValue>,
  ) {
    super(message)
    this.name = 'APIError'
  }

  toJSON(): {
    error: string
    code: string
    statusCode: number
    details?: Record<string, JsonValue>
  } {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details }),
    }
  }
}

export class ValidationError extends APIError {
  constructor(message: string, details?: Record<string, JsonValue>) {
    super(message, 400, 'VALIDATION_ERROR', details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends APIError {
  constructor(resource: string, id?: string) {
    const message = id
      ? `${resource} not found: ${id}`
      : `${resource} not found`
    super(message, 404, 'NOT_FOUND', id ? { resource, id } : { resource })
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends APIError {
  constructor(message: string, details?: Record<string, JsonValue>) {
    super(message, 409, 'CONFLICT', details)
    this.name = 'ConflictError'
  }
}

export class ServiceUnavailableError extends APIError {
  constructor(service: string, details?: Record<string, JsonValue>) {
    super(`Service unavailable: ${service}`, 503, 'SERVICE_UNAVAILABLE', {
      service,
      ...details,
    })
    this.name = 'ServiceUnavailableError'
  }
}

export class InternalError extends APIError {
  constructor(message: string = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR')
    this.name = 'InternalError'
  }
}

export class UnauthorizedError extends APIError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends APIError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN')
    this.name = 'ForbiddenError'
  }
}

export interface ErrorResponse {
  error: string
  code: string
  statusCode: number
  details?: Record<string, JsonValue>
  stack?: string
}

export function sanitizeErrorMessage(
  error: Error,
  isDevelopment: boolean,
): string {
  if (isDevelopment) {
    return error.message
  }

  if (error instanceof APIError) {
    return error.message
  }

  return 'An unexpected error occurred'
}

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
    const issueStrings = error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    )
    // Map ZodIssues to JSON-serializable objects
    const serializedIssues = error.issues.map((i) => ({
      path: i.path.map(String),
      message: i.message,
      code: i.code,
    }))
    return {
      error: `Validation failed: ${issueStrings.join(', ')}`,
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: { issues: serializedIssues },
      ...(isDevelopment && { stack: error.stack }),
    }
  }

  return {
    error: sanitizeErrorMessage(error, isDevelopment),
    code: 'INTERNAL_ERROR',
    statusCode: 500,
    ...(isDevelopment && { stack: error.stack }),
  }
}

export function getStatusCode(error: Error): number {
  if (error instanceof APIError) {
    return error.statusCode
  }
  if (error instanceof z.ZodError) {
    return 400
  }
  return 500
}

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
 * Validate unknown external data against a Zod schema.
 * The unknown type is intentional - this function exists to validate data
 * from external sources (API requests, JSON parsing) where the type is not known.
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
    // Map ZodIssues to JSON-serializable objects
    const serializedIssues = result.error.issues.map((i) => ({
      path: i.path.map(String),
      message: i.message,
      code: i.code,
    }))
    throw new ValidationError(`Invalid ${context}: ${errors}`, {
      issues: serializedIssues,
    })
  }
  return result.data
}

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
