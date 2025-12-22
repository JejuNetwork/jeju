import { z, type ZodIssue, type ZodSchema } from 'zod';
import { isAddress, isHex, type Address, type Hex } from 'viem';

// Re-export Address and Hex types from viem for convenience
export type { Address, Hex };

// ============================================================================
// Core Primitive Schemas
// ============================================================================

/**
 * Ethereum Address Schema
 * Validates 0x-prefixed 40-character hex strings
 * Infers as `Address` type from viem
 */
export const AddressSchema = z.string().refine(
  (val): val is Address => isAddress(val),
  'Invalid Ethereum address'
) as unknown as z.ZodType<Address>;

/**
 * Hex String Schema
 * Validates 0x-prefixed hex strings
 * Infers as `Hex` type from viem
 */
export const HexSchema = z.string().refine(
  (val): val is Hex => isHex(val),
  'Invalid hex string'
) as unknown as z.ZodType<Hex>;

/**
 * 32-byte Hash Schema (e.g. transaction hash, block hash)
 * Infers as `Hex` type from viem
 */
export const HashSchema = z.string().refine(
  (val): val is Hex => isHex(val) && val.length === 66, // 0x + 64 chars
  'Invalid 32-byte hash'
) as unknown as z.ZodType<Hex>;

/**
 * BigInt Schema
 * Handles various inputs that can be converted to BigInt
 */
export const BigIntSchema = z.union([
  z.string(),
  z.number(),
  z.bigint(),
]).transform((val) => BigInt(val));

/**
 * Positive BigInt Schema
 */
export const PositiveBigIntSchema = z.union([
  z.bigint().positive(),
  z.string().transform((val) => {
    const parsed = BigInt(val);
    if (parsed <= 0n) throw new Error('Must be positive');
    return parsed;
  }),
]);

/**
 * Non-negative BigInt Schema
 */
export const NonNegativeBigIntSchema = z.union([
  z.bigint().nonnegative(),
  z.string().transform((val) => {
    const parsed = BigInt(val);
    if (parsed < 0n) throw new Error('Must be non-negative');
    return parsed;
  }),
]);

/**
 * Timestamp Schema
 * Validates positive integer timestamps (seconds or ms)
 */
export const TimestampSchema = z.number().int().positive();

/**
 * CID Schema (IPFS content identifier)
 */
export const CidSchema = z.string().min(1, 'CID is required');

/**
 * URL Schema
 */
export const UrlSchema = z.string().url('Invalid URL');

/**
 * Email Schema
 */
export const EmailSchema = z.string().email('Invalid email address');

/**
 * ISO 8601 Date Schema
 */
export const IsoDateSchema = z.string().datetime('Invalid ISO 8601 date');

// ============================================================================
// API & Pagination Schemas
// ============================================================================

/**
 * Standard Pagination Schema (Page-based)
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});


// ============================================================================
// String Schemas
// ============================================================================

/**
 * Validates a string that must contain at least 1 character
 */
export const NonEmptyStringSchema = z.string().min(1, 'String cannot be empty');

/**
 * Validates a string that represents a positive number
 * Useful for query params or JSON APIs that pass numbers as strings
 */
export const PositiveNumberStringSchema = z.string().refine(
  (val) => {
    const num = Number(val);
    return !isNaN(num) && num > 0;
  },
  'Must be a positive number string'
);

/**
 * Validates a string that represents a non-negative number
 */
export const NonNegativeNumberStringSchema = z.string().refine(
  (val) => {
    const num = Number(val);
    return !isNaN(num) && num >= 0;
  },
  'Must be a non-negative number string'
);

/**
 * Positive Number Schema
 */
export const PositiveNumberSchema = z.number().positive('Must be positive');

/**
 * Non-negative Number Schema
 */
export const NonNegativeNumberSchema = z.number().nonnegative('Must be non-negative');

/**
 * Positive Integer Schema
 */
export const PositiveIntSchema = z.number().int().positive();

/**
 * Non-negative Integer Schema
 */
export const NonNegativeIntSchema = z.number().int().nonnegative();

/**
 * Percentage Schema (0-100)
 */
export const PercentageSchema = z.number().min(0).max(100);

// ============================================================================
// Network Schemas
// ============================================================================

/**
 * Chain ID Schema
 * Validates positive integer chain IDs
 */
export const ChainIdSchema = z.number().int().positive();

// ============================================================================
// Fail-Fast Validation Helpers
// ============================================================================

/**
 * Expect a value to exist, throw if null/undefined
 * Use this for values that MUST exist - fails fast to expose bugs
 */
export function expect<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

/**
 * Expect a condition to be true, throw if false
 * Use this for assertions that MUST hold - fails fast to expose bugs
 */
export function expectTrue(value: boolean, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

/**
 * Expect a value to exist, throw if null/undefined
 * Type guard version that narrows type
 */
export function expectDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

/**
 * Expect an array to be non-empty, throw if empty or null/undefined
 */
export function expectNonEmpty<T>(value: T[] | null | undefined, message: string): T[] {
  const arr = expect(value, message);
  expectTrue(arr.length > 0, `${message}: array is empty`);
  return arr;
}

/**
 * Expect a number/bigint to be positive, throw if not
 */
export function expectPositive(value: number | bigint, message: string): number | bigint {
  if (typeof value === 'number') {
    expectTrue(value > 0, `${message}: must be positive`);
  } else {
    expectTrue(value > 0n, `${message}: must be positive`);
  }
  return value;
}

/**
 * Expect a number/bigint to be non-negative, throw if negative
 */
export function expectNonNegative(value: number | bigint, message: string): number | bigint {
  if (typeof value === 'number') {
    expectTrue(value >= 0, `${message}: must be non-negative`);
  } else {
    expectTrue(value >= 0n, `${message}: must be non-negative`);
  }
  return value;
}

/**
 * Validate data against a Zod schema, throw on failure (fail-fast)
 * This is the primary validation function - validates and returns typed data
 */
export function expectValid<T>(schema: ZodSchema<T>, value: unknown, context?: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const errors = result.error.issues.map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation failed${context ? ` in ${context}` : ''}: ${errors}`);
  }
  return result.data;
}

/**
 * Alias for expectValid - validates data against a Zod schema
 */
export function validateOrThrow<T>(schema: ZodSchema<T>, data: unknown, context?: string): T {
  return expectValid(schema, data, context);
}

/**
 * Validate and return data, or null if invalid
 * Use this only when null is a valid/expected outcome (e.g., optional cache lookups)
 */
export function validateOrNull<T>(schema: ZodSchema<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Validate an Ethereum address, throw if invalid
 */
export function expectAddress(value: unknown, context?: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(context ? `${context}: Invalid address ${value}` : `Invalid address: ${value}`);
  }
  return value as Address;
}

/**
 * Validate a hex string, throw if invalid
 */
export function expectHex(value: unknown, context?: string): Hex {
  if (typeof value !== 'string' || !isHex(value)) {
    throw new Error(context ? `${context}: Invalid hex ${value}` : `Invalid hex: ${value}`);
  }
  return value as Hex;
}

/**
 * Validate a chain ID, throw if invalid
 */
export function expectChainId(value: unknown, context?: string): number {
  const result = ChainIdSchema.safeParse(value);
  if (!result.success) {
    throw new Error(context ? `${context}: Invalid chain ID ${value}` : `Invalid chain ID: ${value}`);
  }
  return result.data;
}

/**
 * Validate a BigInt, throw if invalid
 */
export function expectBigInt(value: bigint | string | number, fieldName = 'value'): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid ${fieldName}: expected valid bigint, got ${value}`);
  }
}

/**
 * Validate a non-empty string, throw if empty
 */
export function expectNonEmptyString(value: string | undefined | null, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`);
  }
  return value;
}

/**
 * Parse JSON and validate against schema, throw on failure
 */
export function expectJson<T>(json: string, schema: ZodSchema<T>, fieldName = 'json'): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid ${fieldName}: failed to parse JSON - ${error instanceof Error ? error.message : String(error)}`);
  }
  return expectValid(schema, parsed, fieldName);
}
