/**
 * Factory-specific Type Guards
 *
 * App-specific utilities for factory API.
 * Import common validators directly from @jejunetwork/types.
 */

import { type Address, isAddress } from 'viem'

// ─────────────────────────────────────────────────────────────────────────────
// Factory-specific Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates and returns an Address type. Uses viem's isAddress for validation.
 */
export function validateAddress(value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Invalid Ethereum address: ${value}`)
  }
  return value
}

/**
 * Validates and returns a hex string. Throws if invalid.
 */
export function validateHexString(value: string): `0x${string}` {
  if (!value.startsWith('0x')) {
    throw new Error(`Invalid hex string: ${value}`)
  }
  return value as `0x${string}`
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
