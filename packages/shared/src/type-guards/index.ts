/**
 * Type Guards and Assertion Utilities
 *
 * Foundational type guards for runtime type checking.
 * Use these instead of `as` casts for safer type narrowing.
 *
 * @module @jejunetwork/shared/type-guards
 */

// Re-export JSON types from packages/types for convenience
export type {
  JsonObject,
  JsonPrimitive,
  JsonRecord,
  JsonValue,
} from '@jejunetwork/types'

import type { JsonValue } from '@jejunetwork/types'

// =============================================================================
// Primitive Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Type guard to check if a value is a number (and not NaN)
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

/**
 * Type guard to check if a value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * Type guard to check if a value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Type guard to check if an array contains elements of a specific type
 */
export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(guard)
}

/**
 * Type guard to check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Type guard to check if value is a finite number (not NaN, not Infinity)
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Type guard to check if value is a positive integer
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

// =============================================================================
// Object Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a non-null object (excludes arrays)
 *
 * @example
 * ```ts
 * if (isObject(value)) {
 *   console.log(value.someProperty)
 * }
 * ```
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard to check if a value is a plain object (excludes special object types)
 * More restrictive than isObject - excludes Date, RegExp, Map, Set, Error, Promise, etc.
 *
 * @example
 * ```ts
 * if (isPlainObject(value)) {
 *   Object.entries(value).forEach(([key, val]) => {...})
 * }
 * ```
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  if (value instanceof Date) return false
  if (value instanceof RegExp) return false
  if (value instanceof Map) return false
  if (value instanceof Set) return false
  if (value instanceof WeakMap) return false
  if (value instanceof WeakSet) return false
  if (value instanceof Error) return false
  if (value instanceof Promise) return false
  return true
}

/**
 * Type guard to check if a value is a Record<string, string>
 */
export function isStringRecord(
  value: unknown,
): value is Record<string, string> {
  if (!isObject(value)) return false
  return Object.values(value).every((v) => typeof v === 'string')
}

/**
 * Type guard for objects with potential JsonValue values
 */
export function isJsonRecord(
  value: unknown,
): value is Record<string, JsonValue> {
  return isObject(value)
}

/**
 * Safely cast an unknown value to Record<string, JsonValue> or return undefined
 */
export function toJsonRecord(
  value: unknown,
): Record<string, JsonValue> | undefined {
  if (isJsonRecord(value)) {
    return value
  }
  return undefined
}

// =============================================================================
// Array Type Guards
// =============================================================================

/**
 * Type guard for string arrays
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * Safely cast to string array or return empty array
 */
export function toStringArray(value: unknown): string[] {
  if (isStringArray(value)) {
    return value
  }
  return []
}

/**
 * Type guard for number arrays
 */
export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number')
}

// =============================================================================
// Property Checking Type Guards
// =============================================================================

/**
 * Type guard to check if a value has a specific property
 *
 * @example
 * ```ts
 * if (hasProperty(value, 'id')) {
 *   console.log(value.id)
 * }
 * ```
 */
export function hasProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return isObject(value) && key in value
}

/**
 * Type guard to check if a value has a string property
 */
export function hasStringProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  if (!hasProperty(value, key)) {
    return false
  }
  return typeof value[key] === 'string'
}

/**
 * Type guard to check if a value has a number property
 */
export function hasNumberProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, number> {
  return (
    hasProperty(value, key) &&
    typeof (value as Record<K, unknown>)[key] === 'number'
  )
}

/**
 * Type guard to check if a value has a boolean property
 */
export function hasBooleanProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, boolean> {
  return (
    hasProperty(value, key) &&
    typeof (value as Record<K, unknown>)[key] === 'boolean'
  )
}

/**
 * Check if an object has an array property
 */
export function hasArrayProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown[]> {
  return (
    hasProperty(value, key) && Array.isArray((value as Record<K, unknown>)[key])
  )
}

// =============================================================================
// JSON Value Type Guards
// =============================================================================

/**
 * Check if a value is a valid JsonValue (null, string, number, boolean, array, or plain object)
 * Excludes special object types like Date, Map, Set, RegExp, Error, Promise, etc.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string') return true
  if (typeof value === 'number') return true
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  // Must be a plain object - exclude Date, Map, Set, RegExp, Error, etc.
  if (isPlainObject(value)) {
    return Object.values(value).every(isJsonValue)
  }
  return false
}

/**
 * Safely convert unknown to JsonValue, returns null if not convertible
 */
export function toJsonValueOrNull(value: unknown): JsonValue | null {
  if (isJsonValue(value)) {
    return value
  }
  return null
}

// =============================================================================
// Assertion Utilities
// =============================================================================

/**
 * Assert that a value is defined (not null or undefined)
 * @throws Error if the value is null or undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message = 'Value is undefined or null',
): T {
  if (value === null || value === undefined) {
    throw new Error(message)
  }
  return value
}

/**
 * Assert that a value is not null
 * @throws Error if the value is null
 */
export function assertNotNull<T>(
  value: T | null,
  message = 'Value is null',
): T {
  if (value === null) {
    throw new Error(message)
  }
  return value
}

// =============================================================================
// Error Handling Utilities
// =============================================================================

/**
 * Convert unknown caught value to Error
 * Use this instead of `error as Error` in catch blocks
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
 * Get error message from unknown caught value
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  if (typeof err === 'string') {
    return err
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string'
  ) {
    return err.message
  }
  return String(err)
}

// =============================================================================
// JSON Parsing Utilities
// =============================================================================

/**
 * Type-safe JSON.parse wrapper
 * Returns unknown instead of any for proper type narrowing
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text)
}

/**
 * Parse JSON with type guard validation
 */
export function parseJsonAs<T>(
  json: string,
  guard: (value: unknown) => value is T,
  errorMessage = 'Invalid JSON structure',
): T {
  const parsed: unknown = JSON.parse(json)
  if (!guard(parsed)) {
    throw new Error(errorMessage)
  }
  return parsed
}

/**
 * Type-safe JSON parsing from Response
 * Wraps response.json() to return unknown instead of any
 */
export async function responseJson(response: Response): Promise<unknown> {
  return response.json()
}

/**
 * Fetch and parse JSON response with type validation
 */
export async function fetchJsonAs<T>(
  url: string,
  guard: (value: unknown) => value is T,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
  }
  const data: unknown = await response.json()
  if (!guard(data)) {
    throw new Error(`Invalid response structure from ${url}`)
  }
  return data
}

// =============================================================================
// Special Type Guards
// =============================================================================

/**
 * Type guard to check if value is a valid Date object
 * Returns false for invalid dates like new Date('invalid')
 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

/**
 * Type guard to check if value is a Uint8Array
 */
export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}
