/**
 * Validation Utilities
 * 
 * Re-exports shared validation functions from @jejunetwork/types/validation.
 * Provides backwards compatibility for existing code.
 */

import { z } from 'zod';

// ============================================================================
// Re-exports from @jejunetwork/types/validation
// ============================================================================

export {
  // Core validation helpers
  expectAddress,
  expectHex,
  expectChainId,
  expectJson,
  expectDefined,
  expectPositive,
  expectNonNegative,
  expectValid,
  expectNonEmptyString,
  // Schemas
  AddressSchema,
  HexSchema,
  ChainIdSchema,
  TimestampSchema,
  BigIntSchema as BaseBigIntSchema,
  NonNegativeBigIntSchema,
} from '@jejunetwork/types/validation';

import {
  expectBigInt as typesExpectBigInt,
  expectValid,
  expectNonEmptyString,
  expectJson,
  BigIntSchema as BaseBigIntSchema,
} from '@jejunetwork/types/validation';

// ============================================================================
// Backwards-compatible wrappers
// ============================================================================

/**
 * Validates a bigint (enforces non-negative for backwards compatibility)
 */
export function expectBigInt(value: bigint | string | number, fieldName = 'value'): bigint {
  const parsed = typesExpectBigInt(value, fieldName);
  if (parsed < 0n) {
    throw new Error(`Invalid ${fieldName}: expected non-negative bigint, got ${value}`);
  }
  return parsed;
}

/**
 * Validates a non-empty string
 * Wrapper around expectNonEmptyString for backwards compatibility
 */
export function expectNonEmpty(value: string, fieldName: string): string {
  return expectNonEmptyString(value, fieldName);
}

/**
 * Returns the value if defined, throws if null/undefined
 * Unlike the asserts version, this returns the narrowed value
 */
export function requireDefined<T>(value: T | null | undefined, fieldName: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

/**
 * Validates an object against a schema, throwing on failure
 * Wrapper around expectValid for backwards compatibility
 */
export function expectSchema<T>(value: unknown, schema: z.ZodSchema<T>, fieldName = 'value'): T {
  return expectValid(schema, value, fieldName);
}

// ============================================================================
// Schemas
// ============================================================================

export const BigIntSchema = BaseBigIntSchema.refine((val) => val >= 0n, {
  error: 'BigInt must be non-negative',
});

// ============================================================================
// Helper to create validated JSON parse
// ============================================================================

export function parseJson<T>(json: string, schema: z.ZodSchema<T>): T {
  return expectJson(json, schema);
}
