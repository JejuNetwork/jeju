/**
 * Shared validation utilities and helpers
 * Provides Zod-based validation with fail-fast error handling
 * 
 * Base schemas imported from @jejunetwork/types/validation
 * Hono-specific helpers defined here
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { Address, Hex } from 'viem';
import {
  expectValid,
  AddressSchema,
  HexSchema,
  CidSchema,
  PositiveIntSchema,
  NonNegativeIntSchema,
  NonEmptyStringSchema,
  UrlSchema,
  EmailSchema,
  IsoDateSchema,
  TimestampSchema,
  LimitOffsetPaginationSchema,
  PositiveBigIntSchema,
  ErrorResponseSchema,
} from '@jejunetwork/types/validation';

// Re-export expectValid from types
export { expectValid };

/**
 * Validate request body with fail-fast
 */
export async function validateBody<T>(schema: z.ZodSchema<T>, c: Context, context?: string): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  return expectValid(schema, body, context || 'Request body');
}

/**
 * Validate query parameters with fail-fast
 */
export function validateQuery<T>(schema: z.ZodSchema<T>, c: Context, context?: string): T {
  const query: Record<string, string> = {};
  const url = new URL(c.req.url);
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = value;
  }
  return expectValid(schema, query, context || 'Query parameters');
}

/**
 * Validate path parameters with fail-fast
 */
export function validateParams<T>(schema: z.ZodSchema<T>, c: Context, context?: string): T {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(c.req.param())) {
    params[key] = value;
  }
  return expectValid(schema, params, context || 'Path parameters');
}

/**
 * Validate headers with fail-fast
 */
export function validateHeaders<T>(schema: z.ZodSchema<T>, c: Context, context?: string): T {
  const headers: Record<string, string> = {};
  const rawHeaders = c.req.header();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value) headers[key.toLowerCase()] = value;
  }
  return expectValid(schema, headers, context || 'Headers');
}

/**
 * Hono middleware for request validation
 * Validates body, query, params, and headers based on provided schemas
 * Throws immediately on validation failure (fail-fast)
 */
export function validateRequest<TBody = never, TQuery = never, TParams = never, THeaders = never>(options: {
  body?: z.ZodSchema<TBody>;
  query?: z.ZodSchema<TQuery>;
  params?: z.ZodSchema<TParams>;
  headers?: z.ZodSchema<THeaders>;
}) {
  return async (c: Context, next: () => Promise<void>) => {
    if (options.body) {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        body = {};
      }
      c.set('validatedBody', expectValid(options.body, body, 'Request body'));
    }
    if (options.query) {
      const query: Record<string, string> = {};
      const url = new URL(c.req.url);
      for (const [key, value] of url.searchParams.entries()) {
        query[key] = value;
      }
      c.set('validatedQuery', expectValid(options.query, query, 'Query parameters'));
    }
    if (options.params) {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(c.req.param())) {
        params[key] = value;
      }
      c.set('validatedParams', expectValid(options.params, params, 'Path parameters'));
    }
    if (options.headers) {
      const headers: Record<string, string> = {};
      const rawHeaders = c.req.header();
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (value) headers[key.toLowerCase()] = value;
      }
      c.set('validatedHeaders', expectValid(options.headers, headers, 'Headers'));
    }
    await next();
  };
}

// ============ Re-exported Schemas with camelCase aliases for backwards compatibility ============

// Core schemas - re-exported with camelCase for backwards compatibility
export const addressSchema = AddressSchema as z.ZodType<Address>;
export const hexSchema = HexSchema as z.ZodType<Hex>;
export const strictHexSchema = HexSchema as z.ZodType<Hex>; // HexSchema already requires 0x prefix
export const cidSchema = CidSchema;
export const positiveIntSchema = PositiveIntSchema;
export const nonNegativeIntSchema = NonNegativeIntSchema;
export const nonEmptyStringSchema = NonEmptyStringSchema;
export const urlSchema = UrlSchema;
export const emailSchema = EmailSchema;
export const isoDateSchema = IsoDateSchema;
export const timestampSchema = TimestampSchema;
export const paginationSchema = LimitOffsetPaginationSchema;
export const positiveBigIntSchema = PositiveBigIntSchema;
export const errorResponseSchema = ErrorResponseSchema;

/**
 * Common header schemas (Hono/DWS-specific)
 */
export const jejuAddressHeaderSchema = z.object({
  'x-jeju-address': addressSchema,
});

export const jejuAuthHeadersSchema = z.object({
  'x-jeju-address': addressSchema,
  'x-jeju-nonce': nonEmptyStringSchema,
  'x-jeju-signature': strictHexSchema,
  'x-jeju-timestamp': z.string().regex(/^\d+$/, 'Invalid timestamp'),
});
