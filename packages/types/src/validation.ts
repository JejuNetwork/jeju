/**
 * Core validation primitives and security constants.
 */

import { type Address, type Hex, isAddress, isHex as viemIsHex } from 'viem'
import type { NetworkType } from './chain'

/**
 * Type guard to check if a value is a valid hex string.
 * Wraps viem's isHex with proper type narrowing.
 */
export function isHex(value: unknown): value is `0x${string}` {
  return viemIsHex(value)
}

import { type ZodIssue, z } from 'zod'

export const MAX_ARRAY_LENGTH = 1000
export const MAX_SMALL_ARRAY_LENGTH = 100
export const MAX_STRING_LENGTH = 10000
export const MAX_SHORT_STRING_LENGTH = 256
export const MAX_URL_LENGTH = 2048
export const MAX_CID_LENGTH = 128
export const MAX_RECORD_KEYS = 100
export const MAX_RECURSION_DEPTH = 10

export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonRecord = Record<string, JsonValue>

export type JsonObject = { [key: string]: JsonValue }

export type LogValue = JsonValue | Error | undefined

export const AddressSchema = z.custom<Address>(
  (val): val is Address => typeof val === 'string' && isAddress(val),
  'Invalid Ethereum address',
)

export const HexSchema = z.custom<Hex>(
  (val): val is Hex => typeof val === 'string' && viemIsHex(val),
  'Invalid hex string',
)

export const HashSchema = z.custom<Hex>(
  (val): val is Hex =>
    typeof val === 'string' && viemIsHex(val) && val.length === 66,
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

// API & Pagination Schemas

/**
 * Standard Pagination Schema (Page-based)
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

// String Schemas

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

// Network Schemas

/**
 * Chain ID Schema
 * Validates positive integer chain IDs
 */
export const ChainIdSchema = z.number().int().positive()

// Fail-Fast Validation Helpers

/**
 * Convert an unknown caught error to a proper Error instance.
 * Use this in catch blocks to safely convert unknown to Error.
 *
 * `unknown` is necessary here because JavaScript allows throwing
 * any value. This function provides a type-safe way to handle caught errors.
 *
 * Handles:
 * - Error instances (returned as-is)
 * - Strings (wrapped in Error)
 * - Error-like objects with message property
 * - Everything else (stringified)
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) {
    return err
  }
  if (typeof err === 'string') {
    return new Error(err)
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string'
  ) {
    const error = new Error(err.message)
    if ('name' in err && typeof err.name === 'string') {
      error.name = err.name
    }
    return error
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
  if (typeof value !== 'string' || !viemIsHex(value)) {
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
 * Convert unknown value to bigint.
 * Use this when parsing contract results where the type is unknown at compile time.
 */
export function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (typeof value === 'string') return BigInt(value)
  throw new Error(`Cannot convert ${typeof value} to bigint`)
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

// Type-Safe Param Extraction
// Used for extracting typed values from untyped params objects (e.g., A2A skills, MCP tools)

/**
 * Extract a required string from a params object
 * @throws Error if key is missing or not a string
 */
export function getString(
  params: Record<string, unknown>,
  key: string,
): string {
  const value = params[key]
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`)
  }
  return value
}

/**
 * Extract an optional string from a params object
 * @returns undefined if key is missing, throws if present but not a string
 */
export function getOptionalString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`)
  }
  return value
}

/**
 * Extract a required number from a params object
 * @throws Error if key is missing or not a number
 */
export function getNumber(
  params: Record<string, unknown>,
  key: string,
): number {
  const value = params[key]
  if (typeof value !== 'number') {
    throw new Error(`${key} must be a number`)
  }
  return value
}

/**
 * Extract an optional number from a params object
 * @returns undefined if key is missing, throws if present but not a number
 */
export function getOptionalNumber(
  params: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number') {
    throw new Error(`${key} must be a number`)
  }
  return value
}

/**
 * Extract a required boolean from a params object
 * @throws Error if key is missing or not a boolean
 */
export function getBoolean(
  params: Record<string, unknown>,
  key: string,
): boolean {
  const value = params[key]
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`)
  }
  return value
}

/**
 * Extract an optional boolean from a params object
 * @returns undefined if key is missing, throws if present but not a boolean
 */
export function getOptionalBoolean(
  params: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`)
  }
  return value
}

/**
 * Extract a required Address from a params object
 * @throws Error if key is missing or not a valid address
 */
export function getAddress(
  params: Record<string, unknown>,
  key: string,
): Address {
  const value = params[key]
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${key} must be a valid address`)
  }
  return value as Address
}

/**
 * Extract an optional Address from a params object
 * @returns ZERO_ADDRESS if key is missing or invalid
 */
export function getOptionalAddress(
  params: Record<string, unknown>,
  key: string,
): Address {
  const value = params[key]
  if (typeof value === 'string' && isAddress(value)) {
    return value as Address
  }
  return ZERO_ADDRESS
}

/**
 * Extract a string array from a params object
 * @returns Empty array if key is missing or not an array
 */
export function getStringArray(
  params: Record<string, unknown>,
  key: string,
): string[] {
  const value = params[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

// Type Guards

/**
 * Type guard to check if a string is a hex string (starts with 0x)
 */
export function isHexString(value: string): value is `0x${string}` {
  return value.startsWith('0x')
}

/**
 * Check if value is a plain object (not null, not array)
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Alias for isPlainObject - check if value is a record/object
 * Use this when checking API responses or unknown data structures
 */
export const isRecord = isPlainObject

/**
 * Check if value is a string record
 */
export function isStringRecord(
  value: unknown,
): value is Record<string, string> {
  if (!isPlainObject(value)) return false
  return Object.values(value).every((v) => typeof v === 'string')
}

/**
 * Check if an object has a property that is an array
 * Common pattern for API response validation
 */
export function hasArrayProperty<K extends string>(
  data: unknown,
  key: K,
): data is Record<K, unknown[]> {
  return isPlainObject(data) && Array.isArray(data[key])
}

/**
 * Create a type guard for API responses with a specific array property
 * @example const isBountiesResponse = createArrayResponseGuard('bounties')
 */
export function createArrayResponseGuard<K extends string>(key: K) {
  return (data: unknown): data is Record<K, unknown[]> => {
    return isPlainObject(data) && Array.isArray(data[key])
  }
}

// Address Constants and Utilities

/** Zero address constant for default values and null checks */
export const ZERO_ADDRESS: Address =
  '0x0000000000000000000000000000000000000000'

/**
 * Check if an address is valid (not zero and properly formatted)
 */
export function isValidAddress(
  address: Address | string | undefined | null,
): address is Address {
  return (
    !!address &&
    typeof address === 'string' &&
    address !== ZERO_ADDRESS &&
    isAddress(address)
  )
}

/**
 * Parse an environment variable as an Ethereum address.
 * Returns the default address if the env var is not set or invalid.
 */
export function parseEnvAddress(
  envValue: string | undefined,
  defaultAddress: Address = ZERO_ADDRESS,
): Address {
  if (!envValue) {
    return defaultAddress
  }
  if (isAddress(envValue)) {
    return envValue as Address
  }
  console.warn(`Invalid address in environment variable: ${envValue}`)
  return defaultAddress
}

/**
 * Parse an environment variable as a hex string (e.g., private key).
 * Returns undefined if the env var is not set or invalid.
 */
export function parseEnvHex(envValue: string | undefined): Hex | undefined {
  if (!envValue) return undefined
  if (viemIsHex(envValue)) return envValue as Hex
  return undefined
}

/**
 * Parse a string as an optional Address.
 * Returns undefined if the value is empty/invalid.
 * Use for nullable database values or optional fields.
 */
export function parseOptionalAddress(
  value: string | null | undefined,
): Address | undefined {
  if (!value) return undefined
  return isAddress(value) ? (value as Address) : undefined
}

/**
 * Parse a string as an optional Hex.
 * Returns undefined if the value is empty/invalid.
 * Use for nullable database values or optional fields.
 */
export function parseOptionalHex(
  value: string | null | undefined,
): Hex | undefined {
  if (!value) return undefined
  return viemIsHex(value) ? value : undefined
}

/**
 * Check if an address is the native token (zero address).
 * Handles various formats including null/undefined.
 */
export function isNativeToken(addr: string | null | undefined): boolean {
  return addr === ZERO_ADDRESS || addr === '0x' || !addr
}

// ─────────────────────────────────────────────────────────────────────────────
// FormData Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract a string value from FormData
 * @returns The string value or null if not present or not a string
 */
export function getFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

/**
 * Extract a string value from FormData with a default fallback
 * @returns The string value or default value if not present
 */
export function getFormStringOr(
  formData: FormData,
  key: string,
  defaultValue: string,
): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : defaultValue
}

/**
 * Extract an integer value from FormData with a default fallback
 * @returns Parsed integer or default value
 */
export function getFormInt(
  formData: FormData,
  key: string,
  defaultValue: number,
): number {
  const value = formData.get(key)
  if (typeof value !== 'string') return defaultValue
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? defaultValue : parsed
}

/**
 * Extract a required string from FormData, throw if missing
 * @throws Error if key is missing or not a string
 */
export function expectFormString(formData: FormData, key: string): string {
  const value = formData.get(key)
  if (typeof value !== 'string') {
    throw new Error(`${key} is required`)
  }
  return value
}

// ─────────────────────────────────────────────────────────────────────────────
// Network Types
// ─────────────────────────────────────────────────────────────────────────────

export const NETWORKS = ['localnet', 'testnet', 'mainnet'] as const

/** Check if a string is a valid network type */
export function isValidNetwork(
  value: string | undefined,
): value is NetworkType {
  return value !== undefined && NETWORKS.includes(value as NetworkType)
}

/** Get network from environment variable with type safety */
export function getNetworkEnv(
  defaultNetwork: NetworkType = 'localnet',
): NetworkType {
  const network = process.env.NETWORK
  return isValidNetwork(network) ? network : defaultNetwork
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Level Types
// ─────────────────────────────────────────────────────────────────────────────

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Check if a string is a valid log level */
export function isValidLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && LOG_LEVELS.includes(value as LogLevel)
}

/** Get log level from environment variable */
export function getLogLevelEnv(defaultLevel: LogLevel = 'info'): LogLevel {
  const level = process.env.LOG_LEVEL
  return isValidLogLevel(level) ? level : defaultLevel
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Check if value is a valid JSON value (recursive) */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  if (typeof value === 'object') {
    return Object.values(value).every(isJsonValue)
  }
  return false
}

/** Safely parse JSON and validate with a type guard */
export function parseJsonAs<T>(
  json: string,
  validator: (data: unknown) => data is T,
): T | null {
  try {
    const data: unknown = JSON.parse(json)
    return validator(data) ? data : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Numeric Parsing Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Parse number from string or return default */
export function parseIntOrDefault(
  value: string | null | undefined,
  defaultValue: number,
): number {
  if (typeof value !== 'string') return defaultValue
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? defaultValue : parsed
}

/** Parse BigInt from string or return default */
export function parseBigIntOrDefault(
  value: string | null | undefined,
  defaultValue: bigint,
): bigint {
  if (typeof value !== 'string') return defaultValue
  try {
    return BigInt(value)
  } catch {
    return defaultValue
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hex and Bytes Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Validate and return hex string, throws if invalid */
export function requireHex(value: string, context: string): Hex {
  if (!viemIsHex(value)) {
    throw new Error(`Invalid hex string for ${context}: ${value}`)
  }
  return value
}

/** Pad a string to bytes32 hex format */
export function toBytes32(value: string): Hex {
  const hex = Buffer.from(value).toString('hex').padStart(64, '0').slice(0, 64)
  return `0x${hex}` as Hex
}

/** Zero-padded hex of specified byte length */
export function zeroHex(bytes: number): Hex {
  return `0x${'0'.repeat(bytes * 2)}` as Hex
}

// ─────────────────────────────────────────────────────────────────────────────
// Common Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Type guard for checking if an object has a specific key */
export function hasKey<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, unknown> {
  return isPlainObject(obj) && key in obj
}

/** Type guard for checking if an object has a specific key with a string value */
export function hasStringKey<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, string> {
  return hasKey(obj, key) && typeof obj[key] === 'string'
}

/** Type guard for checking if an object has a specific key with a bigint value */
export function hasBigIntKey<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, bigint> {
  return hasKey(obj, key) && typeof obj[key] === 'bigint'
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract Return Type Helpers
// ─────────────────────────────────────────────────────────────────────────────
// Use these when extracting typed values from viem contract read results

/**
 * Type-safe helper for extracting Address from contract read results
 * Use when the ABI specifies an address return type
 */
export function asAddress(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`Expected address, got: ${typeof value}`)
  }
  return value as Address
}

/**
 * Type-safe helper for extracting Hex from contract read results
 * Use when the ABI specifies a bytes/bytes32 return type
 */
export function asHex(value: unknown): Hex {
  if (typeof value !== 'string' || !viemIsHex(value)) {
    throw new Error(`Expected hex, got: ${typeof value}`)
  }
  return value
}

/**
 * Type-safe helper for extracting bigint from contract read results
 * Use when the ABI specifies a uint256 return type
 */
export function asBigInt(value: unknown): bigint {
  if (typeof value !== 'bigint') {
    throw new Error(`Expected bigint, got: ${typeof value}`)
  }
  return value
}

/**
 * Type-safe helper for extracting boolean from contract read results
 */
export function asBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Expected boolean, got: ${typeof value}`)
  }
  return value
}

/**
 * Type-safe helper for extracting number from contract read results
 */
export function asNumber(value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error(`Expected number, got: ${typeof value}`)
  }
  return value
}

/**
 * Type-safe tuple extractor for contract read results
 * Validates array structure before returning typed values
 */
export function asTuple<T extends readonly unknown[]>(
  value: unknown,
  length: number,
): T {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`Expected tuple of length ${length}, got: ${typeof value}`)
  }
  // After validation, we know value is an array of correct length
  // The cast is safe because T extends readonly unknown[] and we validated the array constraint
  const arr: readonly unknown[] = value
  return arr as T
}

/**
 * Type-safe array extractor for Address[] returns
 */
export function asAddressArray(value: unknown): Address[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array, got: ${typeof value}`)
  }
  return value.map((v, i) => {
    if (typeof v !== 'string' || !isAddress(v)) {
      throw new Error(`Expected address at index ${i}, got: ${typeof v}`)
    }
    return v as Address
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Method Types
// ─────────────────────────────────────────────────────────────────────────────

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS'

const HTTP_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
])

/** Check if value is a valid HTTP method */
export function isHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHODS.has(value.toUpperCase() as HttpMethod)
}
