import { type Address, type Hex, isAddress, isHex } from 'viem'
import { type ZodIssue, z } from 'zod'

// ============================================================================
// Security Constants - Prevent DoS via unbounded inputs
// ============================================================================

/** Maximum array length for most schemas (prevents memory exhaustion) */
export const MAX_ARRAY_LENGTH = 1000

/** Maximum array length for small arrays (signatures, sources) */
export const MAX_SMALL_ARRAY_LENGTH = 100

/** Maximum string length for general strings */
export const MAX_STRING_LENGTH = 10000

/** Maximum string length for short strings (names, symbols) */
export const MAX_SHORT_STRING_LENGTH = 256

/** Maximum string length for URLs */
export const MAX_URL_LENGTH = 2048

/** Maximum string length for CIDs/hashes */
export const MAX_CID_LENGTH = 128

/** Maximum keys in a z.record */
export const MAX_RECORD_KEYS = 100

/** Maximum recursion depth for nested schemas */
export const MAX_RECURSION_DEPTH = 10

// ============================================================================
// JSON Value Types
// ============================================================================

/**
 * JSON primitive types
 */
export type JsonPrimitive = string | number | boolean | null

/**
 * JSON-serializable value type
 * Use this for any value that should be JSON-serializable (API payloads, RPC params, etc.)
 */
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Loggable value type - extends JsonValue with Error for logging contexts
 */
export type LogValue = JsonValue | Error | undefined

// ============================================================================
// Core Primitive Schemas
// ============================================================================

/**
 * Ethereum Address Schema
 * Validates 0x-prefixed 40-character hex strings
 * Infers as `Address` type from viem
 */
export const AddressSchema = z.custom<Address>(
  (val): val is Address => typeof val === 'string' && isAddress(val),
  'Invalid Ethereum address',
)

/**
 * Hex String Schema
 * Validates 0x-prefixed hex strings
 * Infers as `Hex` type from viem
 */
export const HexSchema = z.custom<Hex>(
  (val): val is Hex => typeof val === 'string' && isHex(val),
  'Invalid hex string',
)

/**
 * 32-byte Hash Schema (e.g. transaction hash, block hash)
 * Infers as `Hex` type from viem
 */
export const HashSchema = z.custom<Hex>(
  (val): val is Hex =>
    typeof val === 'string' && isHex(val) && val.length === 66, // 0x + 64 chars
  'Invalid 32-byte hash',
)

/**
 * BigInt Schema
 * Handles various inputs that can be converted to BigInt
 */
export const BigIntSchema = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((val) => BigInt(val))

/**
 * Positive BigInt Schema
 */
export const PositiveBigIntSchema = z.union([
  z.bigint().positive(),
  z.string().transform((val) => {
    const parsed = BigInt(val)
    if (parsed <= 0n) throw new Error('Must be positive')
    return parsed
  }),
])

/**
 * Non-negative BigInt Schema
 */
export const NonNegativeBigIntSchema = z.union([
  z.bigint().nonnegative(),
  z.string().transform((val) => {
    const parsed = BigInt(val)
    if (parsed < 0n) throw new Error('Must be non-negative')
    return parsed
  }),
])

/**
 * Timestamp Schema
 * Validates positive integer timestamps (seconds or ms)
 */
export const TimestampSchema = z.number().int().positive()

/**
 * CID Schema (IPFS content identifier)
 * Limited to MAX_CID_LENGTH to prevent DoS
 */
export const CidSchema = z
  .string()
  .min(1, 'CID is required')
  .max(MAX_CID_LENGTH, 'CID too long')

/**
 * URL Schema
 * Limited to MAX_URL_LENGTH to prevent DoS
 */
export const UrlSchema = z
  .string()
  .max(MAX_URL_LENGTH, 'URL too long')
  .url('Invalid URL')

/**
 * Email Schema
 */
export const EmailSchema = z.string().email('Invalid email address')

/**
 * ISO 8601 Date Schema
 */
export const IsoDateSchema = z.string().datetime('Invalid ISO 8601 date')

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
})

// ============================================================================
// String Schemas
// ============================================================================

/**
 * Validates a string that must contain at least 1 character
 */
export const NonEmptyStringSchema = z.string().min(1, 'String cannot be empty')

/**
 * Validates a string that represents a positive number
 * Useful for query params or JSON APIs that pass numbers as strings
 */
export const PositiveNumberStringSchema = z.string().refine((val) => {
  const num = Number(val)
  return !Number.isNaN(num) && num > 0
}, 'Must be a positive number string')

/**
 * Validates a string that represents a non-negative number
 */
export const NonNegativeNumberStringSchema = z.string().refine((val) => {
  const num = Number(val)
  return !Number.isNaN(num) && num >= 0
}, 'Must be a non-negative number string')

/**
 * Positive Number Schema
 */
export const PositiveNumberSchema = z.number().positive('Must be positive')

/**
 * Non-negative Number Schema
 */
export const NonNegativeNumberSchema = z
  .number()
  .nonnegative('Must be non-negative')

/**
 * Positive Integer Schema
 */
export const PositiveIntSchema = z.number().int().positive()

/**
 * Non-negative Integer Schema
 */
export const NonNegativeIntSchema = z.number().int().nonnegative()

/**
 * Percentage Schema (0-100)
 */
export const PercentageSchema = z.number().min(0).max(100)

// ============================================================================
// Network Schemas
// ============================================================================

/**
 * Chain ID Schema
 * Validates positive integer chain IDs
 */
export const ChainIdSchema = z.number().int().positive()

// ============================================================================
// Fail-Fast Validation Helpers
// ============================================================================

/**
 * Convert an unknown caught error to a proper Error instance.
 * Use this in catch blocks to safely convert unknown to Error.
 *
 * Note: `unknown` is necessary here because JavaScript allows throwing
 * any value. This function provides a type-safe way to handle caught errors.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) {
    return err
  }
  return new Error(String(err))
}

/**
 * Expect a value to exist, throw if null/undefined
 * Use this for values that MUST exist - fails fast to expose bugs
 */
export function expect<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message)
  }
  return value
}

/**
 * Expect a condition to be true, throw if false
 * Use this for assertions that MUST hold - fails fast to expose bugs
 */
export function expectTrue(value: boolean, message: string): asserts value {
  if (!value) {
    throw new Error(message)
  }
}

/**
 * Expect a value to exist, throw if null/undefined
 * Type guard version that narrows type
 */
export function expectDefined<T>(
  value: T | null | undefined,
  message: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message)
  }
}

/**
 * Expect an array to be non-empty, throw if empty or null/undefined
 */
export function expectNonEmpty<T>(
  value: T[] | null | undefined,
  message: string,
): T[] {
  const arr = expect(value, message)
  expectTrue(arr.length > 0, `${message}: array is empty`)
  return arr
}

/**
 * Expect a number/bigint to be positive, throw if not
 */
export function expectPositive(
  value: number | bigint,
  message: string,
): number | bigint {
  if (typeof value === 'number') {
    expectTrue(value > 0, `${message}: must be positive`)
  } else {
    expectTrue(value > 0n, `${message}: must be positive`)
  }
  return value
}

/**
 * Expect a number/bigint to be non-negative, throw if negative
 */
export function expectNonNegative(
  value: number | bigint,
  message: string,
): number | bigint {
  if (typeof value === 'number') {
    expectTrue(value >= 0, `${message}: must be non-negative`)
  } else {
    expectTrue(value >= 0n, `${message}: must be non-negative`)
  }
  return value
}

/**
 * Validate data against a Zod schema, throw on failure (fail-fast)
 * This is the primary validation function - validates and returns typed data
 *
 * Security: Error messages show field paths but not actual values to prevent data leakage
 */
export function expectValid<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context?: string,
): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    // Only include field paths and messages, NOT actual values (security)
    const errors = result.error.issues
      .map((e: ZodIssue) => {
        const path = e.path.length > 0 ? e.path.join('.') : 'root'
        return `${path}: ${e.message}`
      })
      .join(', ')
    throw new Error(
      `Validation failed${context ? ` in ${context}` : ''}: ${errors}`,
    )
  }
  return result.data
}

/**
 * Alias for expectValid - validates data against a Zod schema
 */
export function validateOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context?: string,
): T {
  return expectValid(schema, data, context)
}

/**
 * Validate and return data, or null if invalid
 * Use this only when null is a valid/expected outcome (e.g., optional cache lookups)
 */
export function validateOrNull<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T | null {
  const result = schema.safeParse(value)
  return result.success ? result.data : null
}

/**
 * Validate an Ethereum address, throw if invalid
 * Security: Does not expose the invalid value in error messages
 */
export function expectAddress(value: unknown, context?: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(context ? `${context}: Invalid address` : 'Invalid address')
  }
  return value as Address
}

/**
 * Validate a hex string, throw if invalid
 * Security: Does not expose the invalid value in error messages
 */
export function expectHex(value: unknown, context?: string): Hex {
  if (typeof value !== 'string' || !isHex(value)) {
    throw new Error(context ? `${context}: Invalid hex` : 'Invalid hex')
  }
  return value as Hex
}

/**
 * Validate a chain ID, throw if invalid
 * Security: Does not expose the invalid value in error messages
 */
export function expectChainId(value: unknown, context?: string): number {
  const result = ChainIdSchema.safeParse(value)
  if (!result.success) {
    throw new Error(
      context ? `${context}: Invalid chain ID` : 'Invalid chain ID',
    )
  }
  return result.data
}

/**
 * Validate a BigInt, throw if invalid
 */
export function expectBigInt(
  value: bigint | string | number,
  fieldName = 'value',
): bigint {
  if (typeof value === 'bigint') {
    return value
  }
  try {
    return BigInt(value)
  } catch {
    throw new Error(`Invalid ${fieldName}: expected valid bigint, got ${value}`)
  }
}

/**
 * Validate a non-empty string, throw if empty
 */
export function expectNonEmptyString(
  value: string | undefined | null,
  fieldName: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`)
  }
  return value
}

/**
 * Parse JSON and validate against schema, throw on failure
 */
export function expectJson<T>(
  json: string,
  schema: z.ZodType<T>,
  fieldName = 'json',
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(
      `Invalid ${fieldName}: failed to parse JSON - ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return expectValid(schema, parsed, fieldName)
}
