/**
 * Validation Utilities
 *
 * Framework-agnostic validation helpers that wrap shared validation from @jejunetwork/types.
 * Uses fail-fast expect/throw patterns - validation errors expose bugs immediately.
 *
 * These work with Elysia by accepting raw data (body, query, params) directly.
 */

import {
  expectAddress as baseExpectAddress,
  expectBigInt,
  expectDefined,
  expectTrue,
  expectValid,
} from '@jejunetwork/types'
import { isHex } from 'viem'
import type { z } from 'zod'

/**
 * Query string parameter type from HTTP frameworks (Elysia, Hono, Express, etc.)
 * Allows nested objects and arrays for complex query params.
 */
export interface QueryParams {
  [key: string]: string | string[] | QueryParams | QueryParams[] | undefined
}

/**
 * Path parameter type from HTTP frameworks
 * Path params are string values extracted from URL patterns.
 */
export type PathParams = Record<string, string | undefined>

/**
 * JSON value type for request bodies
 */
export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Validate JSON body against a schema
 * Framework-agnostic: accepts the body directly
 */
export function validateBody<T>(
  body: JsonValue | Record<string, JsonValue>,
  schema: z.ZodSchema<T>,
  context = 'Request body',
): T {
  return expectValid(schema, body, context)
}

/**
 * Validate query parameters against a schema
 * Framework-agnostic: accepts the query object directly
 */
export function validateQuery<T>(
  query: QueryParams,
  schema: z.ZodSchema<T>,
  context = 'Query parameters',
): T {
  return expectValid(schema, query, context)
}

/**
 * Validate a single route parameter
 * Framework-agnostic: accepts the params object directly
 */
export function validateParam(
  params: PathParams,
  paramName: string,
  schema: z.ZodSchema<string>,
  context?: string,
): string {
  const param = params[paramName]
  expectDefined(
    param,
    `${context ?? 'Route parameter'} '${paramName}' is required`,
  )
  return expectValid(schema, param, context ?? `Route parameter '${paramName}'`)
}

/**
 * Validate all route parameters against an object schema
 * Framework-agnostic: accepts the params object directly
 */
export function validateParams<T>(
  params: PathParams,
  schema: z.ZodSchema<T>,
  context = 'Route parameters',
): T {
  return expectValid(schema, params, context)
}

/**
 * Parse and validate BigInt from string (uses shared expectBigInt)
 */
export function parseBigInt(
  value: string | undefined,
  context: string,
): bigint {
  expectDefined(value, `${context}: value is required`)
  const parsed = expectBigInt(value, context)
  expectTrue(parsed >= 0n, `${context}: BigInt must be non-negative`)
  return parsed
}

/**
 * Parse and validate address (uses shared expectAddress)
 */
export function parseAddress(
  value: string | undefined,
  context: string,
): `0x${string}` {
  expectDefined(value, `${context}: address is required`)
  return baseExpectAddress(value, context)
}

/**
 * Parse and validate proposal ID (64-char hex hash)
 */
export function parseProposalId(
  value: string | undefined,
  context: string,
): `0x${string}` {
  expectDefined(value, `${context}: proposalId is required`)
  expectTrue(
    typeof value === 'string',
    `${context}: proposalId must be a string`,
  )
  expectTrue(
    isHex(value) && value.length === 66,
    `${context}: Invalid proposalId format: ${value}`,
  )
  return value as `0x${string}`
}

/**
 * Parse and validate integer with bounds
 */
export function parseInteger(
  value: string | number | undefined,
  context: string,
  min?: number,
  max?: number,
): number {
  if (typeof value === 'number') {
    expectTrue(Number.isInteger(value), `${context}: must be an integer`)
    if (min !== undefined)
      expectTrue(value >= min, `${context}: must be >= ${min}`)
    if (max !== undefined)
      expectTrue(value <= max, `${context}: must be <= ${max}`)
    return value
  }

  expectDefined(value, `${context}: value is required`)
  const parsed = parseInt(String(value), 10)
  expectTrue(!Number.isNaN(parsed), `${context}: Invalid integer: ${value}`)
  expectTrue(Number.isInteger(parsed), `${context}: must be an integer`)
  if (min !== undefined)
    expectTrue(parsed >= min, `${context}: must be >= ${min}`)
  if (max !== undefined)
    expectTrue(parsed <= max, `${context}: must be <= ${max}`)
  return parsed
}

/**
 * Validate enum value
 */
export function validateEnum<T extends string>(
  value: string | undefined,
  enumValues: readonly T[],
  context: string,
): T {
  expectDefined(value, `${context}: value is required`)
  expectTrue(
    enumValues.includes(value as T),
    `${context}: Invalid value '${value}'. Must be one of: ${enumValues.join(', ')}`,
  )
  return value as T
}

/**
 * Validate string length
 */
export function expectStringLength(
  value: string | undefined,
  context: string,
  min: number,
  max?: number,
): string {
  expectDefined(value, `${context}: string is required`)
  expectTrue(typeof value === 'string', `${context}: must be a string`)
  expectTrue(
    value.length >= min,
    `${context}: must be at least ${min} characters`,
  )
  if (max !== undefined) {
    expectTrue(
      value.length <= max,
      `${context}: must be at most ${max} characters`,
    )
  }
  return value
}

/**
 * Validate URL
 */
export function expectUrl(value: string | undefined, context: string): string {
  expectDefined(value, `${context}: URL is required`)
  expectTrue(typeof value === 'string', `${context}: URL must be a string`)
  try {
    new URL(value)
    return value
  } catch {
    throw new Error(`${context}: Invalid URL format: ${value}`)
  }
}

/**
 * Validate that a value is within a range
 */
export function expectInRange(
  value: number | undefined,
  context: string,
  min: number,
  max: number,
): number {
  expectDefined(value, `${context}: value is required`)
  expectTrue(typeof value === 'number', `${context}: must be a number`)
  expectTrue(value >= min, `${context}: must be >= ${min}`)
  expectTrue(value <= max, `${context}: must be <= ${max}`)
  return value
}

/**
 * HTTP error response type
 */
export interface ErrorResponse {
  error: string
  status: number
}

/**
 * Create error response object
 * Framework-agnostic: returns an object that can be used with any framework
 * For Elysia, throw an error or return this with set.status
 */
export function errorResponse(message: string, status = 400): ErrorResponse {
  return { error: message, status }
}

/**
 * Hono context with json response method
 */
interface HonoResponseContext {
  json<U>(data: U, status?: number): Response
}

/**
 * Create success response
 * For Hono: use successResponse(c, data) which calls c.json(data)
 * For Elysia: use successResponse(data) which returns data directly
 *
 * @example
 * // Hono usage:
 * return successResponse(c, { result: 'ok' })
 *
 * // Elysia usage (data only):
 * return successResponse({ result: 'ok' })
 */
export function successResponse<T>(
  context: HonoResponseContext,
  data: T,
): Response
export function successResponse<T>(data: T): T
export function successResponse<T>(
  contextOrData: HonoResponseContext | T,
  maybeData?: T,
): Response | T {
  if (maybeData !== undefined) {
    return (contextOrData as HonoResponseContext).json(maybeData)
  }
  return contextOrData as T
}

/**
 * Validation error class for HTTP error responses
 * Throw this in Elysia handlers to return error responses
 */
export class ValidationError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ValidationError'
    this.status = status
  }
}

// ============================================================================
// Backward-compatible aliases for Hono migration
// These functions work with framework contexts that have body, query, params
// ============================================================================

/**
 * Hono context interface for request handling
 */
interface HonoContext {
  req: {
    json(): Promise<JsonValue | Record<string, JsonValue>>
    query(): Record<string, string | undefined>
    param(name: string): string | undefined
  }
}

/**
 * Elysia context interface for request handling
 */
interface ElysiaContext {
  body: JsonValue | Record<string, JsonValue>
  query: QueryParams
  params: PathParams
}

/** Union type for both framework contexts */
type FrameworkContext = HonoContext | ElysiaContext

/** Type guard to check if context is Hono */
function isHonoContext(c: FrameworkContext): c is HonoContext {
  return 'req' in c && typeof c.req?.json === 'function'
}

/** Type guard to check if context is Elysia */
function isElysiaContext(c: FrameworkContext): c is ElysiaContext {
  return (
    'body' in c &&
    !('req' in c && typeof (c as HonoContext).req?.json === 'function')
  )
}

/**
 * Parse and validate JSON body from request context
 * Compatible with both Hono (c.req.json()) and Elysia (c.body)
 */
export async function parseAndValidateBody<T>(
  c: FrameworkContext,
  schema: z.ZodSchema<T>,
  context = 'Request body',
): Promise<T> {
  let body: JsonValue | Record<string, JsonValue>

  if (isHonoContext(c)) {
    body = await c.req.json().catch(() => {
      throw new Error(`${context}: Invalid JSON`)
    })
  } else if (isElysiaContext(c)) {
    body = c.body
  } else {
    throw new Error(`${context}: No body available`)
  }

  return validateBody(body, schema, context)
}

/**
 * Parse and validate query parameters from request context
 * Compatible with both Hono (c.req.query()) and Elysia (c.query)
 */
export function parseAndValidateQuery<T>(
  c: FrameworkContext,
  schema: z.ZodSchema<T>,
  context = 'Query parameters',
): T {
  let query: QueryParams

  if (isHonoContext(c)) {
    const rawQuery = c.req.query()
    query = Object.fromEntries(
      Object.entries(rawQuery).map(([k, v]) => [k, v ?? '']),
    )
  } else if (isElysiaContext(c)) {
    query = c.query
  } else {
    query = {}
  }

  return validateQuery(query, schema, context)
}

/**
 * Parse and validate route parameter from request context
 * Compatible with both Hono (c.req.param()) and Elysia (c.params)
 */
export function parseAndValidateParam(
  c: FrameworkContext,
  paramName: string,
  schema: z.ZodSchema<string>,
  context?: string,
): string {
  let param: string | undefined

  if (isHonoContext(c)) {
    param = c.req.param(paramName)
  } else if (isElysiaContext(c)) {
    param = c.params[paramName]
  }

  expectDefined(
    param,
    `${context ?? 'Route parameter'} '${paramName}' is required`,
  )
  return expectValid(schema, param, context ?? `Route parameter '${paramName}'`)
}
