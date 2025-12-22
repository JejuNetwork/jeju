/**
 * Validation Utilities
 *
 * Helper functions for validating requests and responses with Zod.
 * Implements fail-fast patterns to expose bugs early.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { type ZodError, z } from 'zod'

// Export access control helpers
export {
  type AuthContext,
  extractAuthHeaders,
  generateAuthMessage,
  isOwner,
  requireAuth,
} from './access-control'

// Export BigInt conversion utilities
export {
  bigIntEpochToNumber,
  bigIntTimestampToMs,
  bigIntToNumber,
  bigIntToNumberSafe,
  formatBigInt,
  isSafeInteger,
} from './bigint-utils'

/**
 * Validate request body against a Zod schema
 * Throws immediately on validation failure (fail-fast)
 */
export async function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown | Promise<unknown>,
): Promise<z.infer<T>> {
  const resolvedBody = await Promise.resolve(body)
  try {
    return schema.parse(resolvedBody) as z.infer<T>
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = formatZodError(error)
      throw new Error(`Validation failed: ${message}`)
    }
    throw error
  }
}

/**
 * Validate query parameters against a Zod schema
 * Throws immediately on validation failure (fail-fast)
 */
export function validateQuery<T extends z.ZodTypeAny>(
  schema: T,
  searchParams: URLSearchParams,
): z.infer<T> {
  const params: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    params[key] = value
  })

  try {
    return schema.parse(params) as z.infer<T>
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = formatZodError(error)
      throw new Error(`Query validation failed: ${message}`)
    }
    throw error
  }
}

/**
 * Validate path parameters
 * Throws immediately on validation failure (fail-fast)
 */
export function validateParams<T extends z.ZodTypeAny>(
  schema: T,
  params: Record<string, string | string[]>,
): z.infer<T> {
  try {
    return schema.parse(params) as z.infer<T>
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = formatZodError(error)
      throw new Error(`Path parameter validation failed: ${message}`)
    }
    throw error
  }
}

/**
 * Format Zod error into a readable message
 */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/**
 * Sanitize error message to prevent information leakage
 * Removes stack traces, file paths, and internal details
 */
function sanitizeErrorMessage(message: string): string {
  // Remove file paths (Unix and Windows)
  let sanitized = message.replace(/\/[^\s:]+\.(ts|js|tsx|jsx)/g, '[file]')
  sanitized = sanitized.replace(/[A-Z]:\\[^\s:]+\.(ts|js|tsx|jsx)/gi, '[file]')

  // Remove stack traces
  sanitized = sanitized.replace(/\s+at\s+.*$/gm, '')

  // Remove internal error details that shouldn't be exposed
  if (sanitized.includes('ENOENT') || sanitized.includes('EACCES')) {
    return 'Resource not available'
  }
  if (sanitized.includes('ECONNREFUSED')) {
    return 'Service temporarily unavailable'
  }

  // Truncate overly long messages
  if (sanitized.length > 200) {
    sanitized = `${sanitized.substring(0, 200)}...`
  }

  return sanitized.trim()
}

/**
 * Create an error response with sanitized message
 */
export function errorResponse(
  message: string,
  status: number = 400,
): NextResponse {
  const sanitizedMessage = sanitizeErrorMessage(message)

  return NextResponse.json(
    {
      error: {
        code:
          status === 401
            ? 'UNAUTHORIZED'
            : status === 403
              ? 'FORBIDDEN'
              : status === 404
                ? 'NOT_FOUND'
                : 'VALIDATION_ERROR',
        message: sanitizedMessage,
      },
    },
    { status },
  )
}

/**
 * Expect a value to be defined, throw if not (fail-fast)
 */
export function expect<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message)
  }
  return value
}

/**
 * Expect a condition to be true, throw if not (fail-fast)
 */
export function expectCondition(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * Parse JSON body with validation
 */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await request.json()
  } catch (_error) {
    throw new Error('Invalid JSON body')
  }
  return validateBody(schema, body)
}

/**
 * Parse form data with validation
 */
export async function parseFormData<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> {
  const formData = await request.formData()
  const data: Record<string, unknown> = {}

  formData.forEach((value, key) => {
    if (value instanceof File) {
      data[key] = value
    } else {
      data[key] = value
    }
  })

  return validateBody(schema, data)
}
