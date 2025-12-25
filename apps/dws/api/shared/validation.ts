/**
 * Shared validation utilities and helpers
 * Provides Zod-based validation with fail-fast error handling
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
import { z } from 'zod'

export { z }

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

export type JSONPrimitive = string | number | boolean | null
export type JSONArray = JSONValue[]
export type JSONObject = { [key: string]: JSONValue }
export type JSONValue = JSONPrimitive | JSONObject | JSONArray

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

// Use z.custom for proper type inference with recursive JSON types
export const JSONObjectSchema: z.ZodType<JSONObject> = z.lazy(() =>
  z.record(z.string(), jsonValueSchema),
)

export const JSONArraySchema: z.ZodType<JSONArray> = z.lazy(() =>
  z.array(jsonValueSchema),
)

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.string(), jsonValueSchema).optional(),
})

export function validateBodyDirect<T>(
  schema: z.ZodType<T>,
  body: unknown,
  context?: string,
): T {
  return expectValid(schema, body ?? {}, context ?? 'Request body')
}

/**
 * Validate request body with fail-fast
 */
export function validateBody<T>(
  schema: z.ZodType<T>,
  ctx: ElysiaContext,
  context?: string,
): T {
  return expectValid(schema, ctx.body ?? {}, context ?? 'Request body')
}

export function validateQuery<T>(
  schema: z.ZodType<T>,
  ctx: ElysiaContext,
  context?: string,
): T {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(ctx.query)) {
    if (value !== undefined) query[key] = value
  }
  return expectValid(schema, query, context ?? 'Query parameters')
}

export function validateQueryFromObj<T>(
  schema: z.ZodType<T>,
  queryObj: Record<string, string | undefined>,
  context?: string,
): T {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(queryObj)) {
    if (value !== undefined) query[key] = value
  }
  return expectValid(schema, query, context ?? 'Query parameters')
}

/**
 * Validate path parameters with fail-fast
 */
export function validateParams<T>(
  schema: z.ZodType<T>,
  ctx: ElysiaContext,
  context?: string,
): T {
  return expectValid(schema, ctx.params, context ?? 'Path parameters')
}

export function validateHeaders<T>(
  schema: z.ZodType<T>,
  ctx: ElysiaContext,
  context?: string,
): T {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(ctx.headers)) {
    if (value) headers[key.toLowerCase()] = value
  }
  return expectValid(schema, headers, context ?? 'Headers')
}

export function createValidationDerive<
  TBody = never,
  TQuery = never,
  TParams = never,
  THeaders = never,
>(options: {
  body?: z.ZodType<TBody>
  query?: z.ZodType<TQuery>
  params?: z.ZodType<TParams>
  headers?: z.ZodType<THeaders>
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

export const addressSchema = AddressSchema
export const hexSchema = HexSchema
export const strictHexSchema = HexSchema
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

export const jejuAddressHeaderSchema = z.object({
  'x-jeju-address': addressSchema,
})

export const jejuAuthHeadersSchema = z.object({
  'x-jeju-address': addressSchema,
  'x-jeju-nonce': nonEmptyStringSchema,
  'x-jeju-signature': strictHexSchema,
  'x-jeju-timestamp': z.string().regex(/^\d+$/, 'Invalid timestamp'),
})
