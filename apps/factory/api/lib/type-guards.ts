/**
 * Factory-specific Type Guards
 *
 * App-specific utilities for factory API.
 * Import common validators directly from @jejunetwork/types.
 */

import { expectAddress, expectHex } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'

// ─────────────────────────────────────────────────────────────────────────────
// Factory-specific Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates and returns an Address type.
 */
export function validateAddress(value: string): Address {
  return expectAddress(value, 'address')
}

/**
 * Validates and returns a hex string. Throws if invalid.
 */
export function validateHexString(value: string): Hex {
  return expectHex(value, 'hex string')
}

/**
 * Coerces a value to (string | number)[] for SQL params.
 * Only accepts primitive values that are valid SQL params.
 */
export function toSqlParams(
  values: (string | number | boolean | null)[],
): (string | number)[] {
  return values.map((v) => {
    if (v === null) return 0
    if (typeof v === 'boolean') return v ? 1 : 0
    return v
  })
}

/**
 * Type for raw auth headers from request
 */
export interface RawAuthHeaders {
  'x-jeju-address'?: string
  'x-jeju-timestamp'?: string
  'x-jeju-signature'?: string
  'x-jeju-nonce'?: string
}

/**
 * Extracts auth headers from a generic headers object
 */
export function extractRawAuthHeaders(
  headers: Record<string, string | undefined>,
): RawAuthHeaders {
  return {
    'x-jeju-address': headers['x-jeju-address'],
    'x-jeju-timestamp': headers['x-jeju-timestamp'],
    'x-jeju-signature': headers['x-jeju-signature'],
    'x-jeju-nonce': headers['x-jeju-nonce'],
  }
}
