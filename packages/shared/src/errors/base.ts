/**
 * Base error classes for Jeju Network applications
 *
 * Provides structured error handling with proper context and metadata.
 * All application errors extend JejuError, which includes timestamp, context,
 * error codes, and operational flags for consistent error handling.
 */

import { isDevMode } from '@jejunetwork/config'

/**
 * Base error class for all Jeju errors
 *
 * Extends the native Error class with additional context and metadata.
 * All application errors should extend this class for consistent error handling,
 * logging, and API responses.
 */
export abstract class JejuError extends Error {
  public readonly timestamp: Date
  public readonly context?: Record<string, unknown>

  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true,
    context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = this.constructor.name
    this.timestamp = new Date()
    this.context = context

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      context: this.context,
      ...(isDevMode() && { stack: this.stack }),
    }
  }
}

/**
 * Validation error for input validation failures
 */
export class ValidationError extends JejuError {
  constructor(
    message: string,
    public readonly fields?: string[],
    public readonly violations?: Array<{ field: string; message: string }>,
  ) {
    super(message, 'VALIDATION_ERROR', 400, true, { fields, violations })
  }
}

/**
 * Authentication error for auth failures
 */
export class AuthenticationError extends JejuError {
  constructor(
    message: string,
    public readonly reason:
      | 'NO_TOKEN'
      | 'INVALID_TOKEN'
      | 'EXPIRED_TOKEN'
      | 'INVALID_CREDENTIALS',
  ) {
    super(message, `AUTH_${reason}`, 401, true, { reason })
  }
}

/**
 * Authorization error for permission failures
 */
export class AuthorizationError extends JejuError {
  constructor(
    message: string,
    public readonly resource: string,
    public readonly action: string,
  ) {
    super(message, 'FORBIDDEN', 403, true, { resource, action })
  }
}

/**
 * Not found error for missing resources
 */
export class NotFoundError extends JejuError {
  constructor(
    resource: string,
    identifier?: string | number,
    customMessage?: string,
  ) {
    const message =
      customMessage ||
      (identifier !== undefined
        ? `${resource} not found: ${identifier}`
        : `${resource} not found`)

    super(message, 'NOT_FOUND', 404, true, { resource, identifier })
  }
}

/**
 * Conflict error for duplicate resources or conflicting operations
 */
export class ConflictError extends JejuError {
  constructor(
    message: string,
    public readonly conflictingResource?: string,
  ) {
    super(message, 'CONFLICT', 409, true, { conflictingResource })
  }
}

/**
 * Database error for database issues
 */
export class DatabaseError extends JejuError {
  constructor(
    message: string,
    public readonly operation: string,
    originalError?: Error,
  ) {
    super(message, 'DATABASE_ERROR', 500, true, {
      operation,
      originalError: originalError?.message,
      originalStack: isDevMode() ? originalError?.stack : undefined,
    })
  }
}

/**
 * External service error for third-party service failures
 */
export class ExternalServiceError extends JejuError {
  constructor(
    service: string,
    message: string,
    public readonly originalStatusCode?: number,
  ) {
    super(`${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, true, {
      service,
      originalStatusCode,
    })
  }
}

/**
 * Rate limit error for rate limiting
 */
export class RateLimitError extends JejuError {
  constructor(
    public readonly limit: number,
    public readonly windowMs: number,
    public readonly retryAfter?: number,
  ) {
    super(
      `Rate limit exceeded: ${limit} requests per ${windowMs}ms`,
      'RATE_LIMIT',
      429,
      true,
      { limit, windowMs, retryAfter },
    )
  }
}

/**
 * Business logic error for domain-specific errors
 */
export class BusinessLogicError extends JejuError {
  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>,
  ) {
    super(message, code, 400, true, context)
  }
}

/**
 * Bad request error for malformed requests
 */
export class BadRequestError extends JejuError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'BAD_REQUEST', 400, true, details)
  }
}

/**
 * Internal server error for unexpected failures
 */
export class InternalServerError extends JejuError {
  constructor(
    message = 'An unexpected error occurred',
    details?: Record<string, unknown>,
  ) {
    super(message, 'INTERNAL_ERROR', 500, false, details)
  }
}

/**
 * Service unavailable error for temporary outages
 */
export class ServiceUnavailableError extends JejuError {
  constructor(
    message = 'Service temporarily unavailable',
    public readonly retryAfter?: number,
  ) {
    super(message, 'SERVICE_UNAVAILABLE', 503, true, { retryAfter })
  }
}
