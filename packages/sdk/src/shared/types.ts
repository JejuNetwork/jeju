/**
 * Shared type definitions for SDK modules
 *
 * These types provide type-safe representations of JSON data
 * instead of using `unknown` or `any`.
 */

/**
 * Represents any valid JSON value.
 * Use this instead of `unknown` when dealing with JSON data.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonRecord

/**
 * Represents a JSON object with string keys.
 * Use this instead of `Record<string, unknown>` for JSON objects.
 */
export type JsonRecord = { [key: string]: JsonValue }

/**
 * Represents a JSON array.
 */
export type JsonArray = JsonValue[]

/**
 * Type guard to check if a value is a valid JsonRecord
 */
export function isJsonRecord(value: JsonValue): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard to check if a value is a valid JsonArray
 */
export function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value)
}

/**
 * Type guard to check if a value is a string
 */
export function isJsonString(value: JsonValue): value is string {
  return typeof value === 'string'
}

/**
 * Type guard to check if a value is a number
 */
export function isJsonNumber(value: JsonValue): value is number {
  return typeof value === 'number'
}

/**
 * Type guard to check if a value is a boolean
 */
export function isJsonBoolean(value: JsonValue): value is boolean {
  return typeof value === 'boolean'
}
