/**
 * Shared type definitions for SDK modules
 *
 * Import JSON types from @jejunetwork/types directly.
 */

import type { JsonRecord, JsonValue } from '@jejunetwork/types'

/**
 * Represents a JSON array.
 */
export type JsonArray = JsonValue[]

/**
 * Type guard to check if a value is a valid JsonRecord
 * Accepts unknown to allow narrowing from parsed JSON
 */
export function isJsonRecord(value: unknown): value is JsonRecord {
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
