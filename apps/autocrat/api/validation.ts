import {
  expectAddress as baseExpectAddress,
  expectBigInt,
  expectDefined,
  expectTrue,
  expectValid,
  type JsonValue,
} from '@jejunetwork/types'
import type { Hex } from 'viem'
import type { z } from 'zod'
import { toHex } from '../lib'

/**
 * Query string parameter type from HTTP frameworks.
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
 * Validate JSON body against a schema
 * Framework-agnostic: accepts the body directly
 */
export function validateBody<T>(
  body: JsonValue | Record<string, JsonValue>,
  schema: z.ZodType<T>,
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
  schema: z.ZodType<T>,
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
  schema: z.ZodType<string>,
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
  schema: z.ZodType<T>,
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
): Hex {
  expectDefined(value, `${context}: proposalId is required`)
  expectTrue(
    typeof value === 'string',
    `${context}: proposalId must be a string`,
  )
  expectTrue(
    value.length === 66,
    `${context}: Invalid proposalId format: ${value}`,
  )
  return toHex(value)
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
 * Validate enum value using type guard
 */
export function validateEnum<T extends string>(
  value: string | undefined,
  enumValues: readonly T[],
  context: string,
): T {
  expectDefined(value, `${context}: value is required`)
  const isValidEnum = (v: string): v is T =>
    (enumValues as readonly string[]).includes(v)
  expectTrue(
    isValidEnum(value),
    `${context}: Invalid value '${value}'. Must be one of: ${enumValues.join(', ')}`,
  )
  return value
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
 * Validate URL (try-catch is valid - URL constructor throws on invalid user input)
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
 * Create success response
 * Returns data directly for Elysia handlers
 *
 * @example
 * return successResponse({ result: 'ok' })
 */
export function successResponse<T>(data: T): T {
  return data
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

/**
 * Elysia context interface for request handling
 */
export interface ElysiaContext {
  body: JsonValue | Record<string, JsonValue>
  query: QueryParams
  params: PathParams
}

/**
 * Parse and validate JSON body from Elysia request context
 */
export function parseAndValidateBody<T>(
  c: ElysiaContext,
  schema: z.ZodType<T>,
  context = 'Request body',
): T {
  return validateBody(c.body, schema, context)
}

/**
 * Parse and validate query parameters from Elysia request context
 */
export function parseAndValidateQuery<T>(
  c: ElysiaContext,
  schema: z.ZodType<T>,
  context = 'Query parameters',
): T {
  return validateQuery(c.query, schema, context)
}

/**
 * Parse and validate route parameter from Elysia request context
 */
export function parseAndValidateParam(
  c: ElysiaContext,
  paramName: string,
  schema: z.ZodType<string>,
  context?: string,
): string {
  const param = c.params[paramName]

  expectDefined(
    param,
    `${context ?? 'Route parameter'} '${paramName}' is required`,
  )
  return expectValid(schema, param, context ?? `Route parameter '${paramName}'`)
}
