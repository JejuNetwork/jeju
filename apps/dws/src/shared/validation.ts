/**
 * Shared validation utilities and helpers
 * Provides Zod-based validation with fail-fast error handling
 *
 * Base schemas imported from @jejunetwork/types/validation
 * Elysia-specific helpers defined here
 */

import {
  AddressSchema,
  CidSchema,
  EmailSchema,
  expectValid,
  HexSchema,
  IsoDateSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  PaginationSchema,
  PositiveBigIntSchema,
  PositiveIntSchema,
  TimestampSchema,
  UrlSchema,
} from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'

/**
 * Elysia context type for validation helpers
 */
export interface ElysiaContext {
  request: Request
  body: unknown
  query: Record<string, string | undefined>
  params: Record<string, string>
  headers: Record<string, string | undefined>
  set: { status: number; headers: Record<string, string> }
}

// ============ JSON Value Types ============

/**
 * Represents any valid JSON primitive value
 */
export type JSONPrimitive = string | number | boolean | null

/**
 * Represents any valid JSON array
 */
export type JSONArray = JSONValue[]

/**
 * Represents any valid JSON object
 */
export type JSONObject = { [key: string]: JSONValue }

/**
 * Represents any valid JSON value (recursive type)
 * Use this for data that needs to be JSON-serializable but has no specific schema
 */
export type JSONValue = JSONPrimitive | JSONObject | JSONArray

/**
 * Zod schema for JSON values (recursive)
 */
const jsonValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

export const JSONValueSchema = jsonValueSchema
export const JSONObjectSchema = z.record(
  z.string(),
  jsonValueSchema,
) as z.ZodType<JSONObject>
export const JSONArraySchema = z.array(jsonValueSchema) as z.ZodType<JSONArray>

// Error response schema
const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.string(), jsonValueSchema).optional(),
})

/**
 * Validate body directly with fail-fast (no context required)
 * Use when you already have the body parsed
 */
export function validateBodyDirect<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
  context?: string,
): T {
  return expectValid(schema, body ?? {}, context || 'Request body')
}

/**
 * Hono context type for validation helpers
 */
interface HonoContext {
  req: {
    json: () => Promise<unknown>
    param: (name: string) => string
  }
}

/**
 * Validate request body with fail-fast
 * Supports both Elysia (body already parsed) and Hono (async json parsing)
 */
export async function validateBody<T>(
  schema: z.ZodSchema<T>,
  ctx: ElysiaContext | HonoContext,
  context?: string,
): Promise<T> {
  let body: unknown
  // Hono context has req.json as a function to parse request body
  // Elysia context has body as a property (not a function)
  if ('req' in ctx && typeof ctx.req.json === 'function') {
    // Hono context - parse JSON from request
    body = await ctx.req.json()
  } else if ('body' in ctx && typeof ctx.body !== 'function') {
    // Elysia context - body is already parsed as property
    body = ctx.body
  } else {
    throw new Error('Invalid context: expected Elysia or Hono context')
  }
  return expectValid(schema, body ?? {}, context || 'Request body')
}

/**
 * Validate query parameters with fail-fast
 */
export function validateQuery<T>(
  schema: z.ZodSchema<T>,
  ctx: ElysiaContext,
  context?: string,
): T {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(ctx.query)) {
    if (value !== undefined) query[key] = value
  }
  return expectValid(schema, query, context || 'Query parameters')
}

/**
 * Validate query parameters from object directly (for Elysia routes)
 */
export function validateQueryFromObj<T>(
  schema: z.ZodSchema<T>,
  queryObj: Record<string, string | undefined>,
  context?: string,
): T {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(queryObj)) {
    if (value !== undefined) query[key] = value
  }
  return expectValid(schema, query, context || 'Query parameters')
}

/**
 * Validate path parameters with fail-fast
 * Supports both Elysia and Hono contexts
 */
export function validateParams<T>(
  schema: z.ZodSchema<T>,
  ctx: ElysiaContext | HonoContext,
  context?: string,
): T {
  // Check if it's an Elysia context (has .params object) or Hono context
  let params: Record<string, string>
  if ('params' in ctx && typeof ctx.params === 'object') {
    // Elysia context - params is an object
    params = ctx.params
  } else if ('req' in ctx && typeof ctx.req.param === 'function') {
    // Hono context - need to extract params from route
    // For Hono, we use schema keys to get the param values
    params = {}
    const shape = schema._def.shape
    if (shape) {
      for (const key of Object.keys(shape)) {
        const value = ctx.req.param(key)
        if (value !== undefined) {
          params[key] = value
        }
      }
    }
  } else {
    throw new Error('Invalid context: expected Elysia or Hono context')
  }
  return expectValid(schema, params, context || 'Path parameters')
}

/**
 * Validate headers with fail-fast
 */
export function validateHeaders<T>(
  schema: z.ZodSchema<T>,
  ctx: ElysiaContext,
  context?: string,
): T {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(ctx.headers)) {
    if (value) headers[key.toLowerCase()] = value
  }
  return expectValid(schema, headers, context || 'Headers')
}

/**
 * Elysia derive hook for request validation
 * Validates body, query, params, and headers based on provided schemas
 * Throws immediately on validation failure (fail-fast)
 */
export function createValidationDerive<
  TBody = never,
  TQuery = never,
  TParams = never,
  THeaders = never,
>(options: {
  body?: z.ZodSchema<TBody>
  query?: z.ZodSchema<TQuery>
  params?: z.ZodSchema<TParams>
  headers?: z.ZodSchema<THeaders>
}) {
  return (ctx: ElysiaContext) => {
    const result: {
      validatedBody?: TBody
      validatedQuery?: TQuery
      validatedParams?: TParams
      validatedHeaders?: THeaders
    } = {}

    if (options.body) {
      result.validatedBody = expectValid(
        options.body,
        ctx.body ?? {},
        'Request body',
      )
    }
    if (options.query) {
      const query: Record<string, string> = {}
      for (const [key, value] of Object.entries(ctx.query)) {
        if (value !== undefined) query[key] = value
      }
      result.validatedQuery = expectValid(
        options.query,
        query,
        'Query parameters',
      )
    }
    if (options.params) {
      result.validatedParams = expectValid(
        options.params,
        ctx.params,
        'Path parameters',
      )
    }
    if (options.headers) {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(ctx.headers)) {
        if (value) headers[key.toLowerCase()] = value
      }
      result.validatedHeaders = expectValid(options.headers, headers, 'Headers')
    }

    return result
  }
}

// ============ Re-exported Schemas with camelCase aliases for backwards compatibility ============

// Core schemas - re-exported with camelCase for backwards compatibility
export const addressSchema = AddressSchema as z.ZodType<Address>
export const hexSchema = HexSchema as z.ZodType<Hex>
export const strictHexSchema = HexSchema as z.ZodType<Hex> // HexSchema already requires 0x prefix
export const cidSchema = CidSchema
export const positiveIntSchema = PositiveIntSchema
export const nonNegativeIntSchema = NonNegativeIntSchema
export const nonEmptyStringSchema = NonEmptyStringSchema
export const urlSchema = UrlSchema
export const emailSchema = EmailSchema
export const isoDateSchema = IsoDateSchema
export const timestampSchema = TimestampSchema
export const paginationSchema = PaginationSchema
export const positiveBigIntSchema = PositiveBigIntSchema
export const errorResponseSchema = ErrorResponseSchema

/**
 * Common header schemas (Elysia/DWS-specific)
 */
export const jejuAddressHeaderSchema = z.object({
  'x-jeju-address': addressSchema,
})

export const jejuAuthHeadersSchema = z.object({
  'x-jeju-address': addressSchema,
  'x-jeju-nonce': nonEmptyStringSchema,
  'x-jeju-signature': strictHexSchema,
  'x-jeju-timestamp': z.string().regex(/^\d+$/, 'Invalid timestamp'),
})
