/**
 * Validation Utilities
 *
 * Hono-specific validation helpers that wrap shared validation from @jejunetwork/types.
 * Uses fail-fast expect/throw patterns - validation errors expose bugs immediately.
 */

import {
  expectAddress as baseExpectAddress,
  expectBigInt,
  expectDefined,
  expectTrue,
  expectValid,
} from '@jejunetwork/types'
import type { Context } from 'hono'
import { isHex } from 'viem'
import type { z } from 'zod'

/**
 * Parse and validate JSON body from Hono request
 */
export async function parseAndValidateBody<T>(
  c: Context,
  schema: z.ZodSchema<T>,
  context = 'Request body',
): Promise<T> {
  const body = await c.req.json().catch(() => {
    throw new Error(`${context}: Invalid JSON`)
  })
  return expectValid(schema, body, context)
}

/**
 * Parse and validate query parameters from Hono request
 */
export function parseAndValidateQuery<T>(
  c: Context,
  schema: z.ZodSchema<T>,
  context = 'Query parameters',
): T {
  const query = Object.fromEntries(
    Object.entries(c.req.query()).map(([k, v]) => [k, v ?? '']),
  )
  return expectValid(schema, query, context)
}

/**
 * Parse and validate route parameter
 */
export function parseAndValidateParam(
  c: Context,
  paramName: string,
  schema: z.ZodSchema<string>,
  context?: string,
): string {
  const param = c.req.param(paramName)
  expectDefined(
    param,
    `${context ?? 'Route parameter'} '${paramName}' is required`,
  )
  return expectValid(schema, param, context ?? `Route parameter '${paramName}'`)
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
 * Create error response helper (Hono-specific)
 */
export function errorResponse(
  c: Context,
  message: string,
  status: number = 400,
) {
  return c.json(
    { error: message },
    status as 200 | 201 | 400 | 401 | 403 | 404 | 500 | 502 | 503,
  )
}

/**
 * Create success response helper (Hono-specific)
 */
export function successResponse<T>(c: Context, data: T, status: number = 200) {
  return c.json(
    data as T & (Record<string, unknown> | unknown[]),
    status as 200 | 201 | 400 | 401 | 403 | 404 | 500 | 502 | 503,
  )
}
