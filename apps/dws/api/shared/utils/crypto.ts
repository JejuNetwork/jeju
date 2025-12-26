/**
 * Cryptographic utilities for secure operations
 * Provides constant-time operations and safe BigInt handling
 */

import {
  bytesToHex,
  hash256,
  constantTimeEqual as universalConstantTimeEqual,
} from '@jejunetwork/shared'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { isAddress, isHex } from 'viem'

/** Zero hash constant - properly typed */
export const ZERO_HASH: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

/**
 * Create a validated Hex value from a string
 * Throws if the string is not valid hex
 */
export function toHex(value: string): Hex {
  if (!isHex(value)) {
    throw new Error(`Invalid hex value: ${value}`)
  }
  return value
}

/**
 * Create a validated Address value from a string
 * Throws if the string is not a valid address
 */
export function toAddress(value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Invalid address: ${value}`)
  }
  return value
}

/**
 * Safely parse an optional string as Address
 * Returns ZERO_ADDRESS if the string is empty or invalid
 */
export function parseAddressOrDefault(
  value: string | undefined,
  defaultValue: Address = ZERO_ADDRESS,
): Address {
  if (!value || value === '') return defaultValue
  if (!isAddress(value)) return defaultValue
  return value
}

/**
 * Safely parse an optional string as Hex
 * Returns ZERO_HASH if the string is empty or invalid
 */
export function parseHexOrDefault(
  value: string | undefined,
  defaultValue: Hex = ZERO_HASH,
): Hex {
  if (!value || value === '') return defaultValue
  if (!isHex(value)) return defaultValue
  return value
}

/**
 * Create a bytes32 hex from a string (pads with zeros)
 */
export function stringToBytes32(value: string): Hex {
  const hex = Buffer.from(value).toString('hex').padEnd(64, '0')
  return `0x${hex}`
}

/**
 * Create a zero-padded hex of specified byte length
 */
export function zeroBytes(length: number): Hex {
  return `0x${'0'.repeat(length * 2)}`
}

/**
 * Constant-time string comparison to prevent timing attacks
 * Both strings must be the same length for a meaningful comparison
 */
export function constantTimeEquals(a: string, b: string): boolean {
  // If lengths differ, still do a comparison to maintain constant time
  const maxLen = Math.max(a.length, b.length)
  const encoder = new TextEncoder()
  const bufA = new Uint8Array(maxLen)
  const bufB = new Uint8Array(maxLen)

  const encodedA = encoder.encode(a)
  const encodedB = encoder.encode(b)
  bufA.set(encodedA)
  bufB.set(encodedB)

  // Use universal constant time comparison
  const equal = universalConstantTimeEqual(bufA, bufB)

  // Also check lengths match (do this after to maintain constant time)
  return equal && a.length === b.length
}

/**
 * Constant-time buffer comparison
 */
export function constantTimeBufferEquals(
  a: Uint8Array,
  b: Uint8Array,
): boolean {
  if (a.length !== b.length) {
    // Still do comparison to maintain constant time
    const maxLen = Math.max(a.length, b.length)
    const bufA = new Uint8Array(maxLen)
    const bufB = new Uint8Array(maxLen)
    bufA.set(a)
    bufB.set(b)
    universalConstantTimeEqual(bufA, bufB) // Run comparison to maintain timing
    return false
  }
  return universalConstantTimeEqual(a, b)
}

/**
 * Constant-time comparison for hex strings (e.g., signatures, hashes)
 */
export function constantTimeHexEquals(a: string, b: string): boolean {
  // Normalize to lowercase for comparison
  const normA = a.toLowerCase().replace(/^0x/, '')
  const normB = b.toLowerCase().replace(/^0x/, '')
  return constantTimeEquals(normA, normB)
}

// Safe BigInt Operations

/** Maximum safe value for BigInt operations to prevent overflow issues */
export const MAX_SAFE_BIGINT = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
) // 2^256 - 1

/**
 * Safely add two BigInts with overflow check
 * Throws if result would exceed MAX_SAFE_BIGINT
 */
export function safeAdd(a: bigint, b: bigint): bigint {
  const result = a + b
  if (result > MAX_SAFE_BIGINT || result < 0n) {
    throw new Error('BigInt overflow in addition')
  }
  return result
}

/**
 * Safely subtract two BigInts with underflow check
 * Throws if result would be negative
 */
export function safeSub(a: bigint, b: bigint): bigint {
  if (a < b) {
    throw new Error('BigInt underflow in subtraction')
  }
  return a - b
}

/**
 * Safely multiply two BigInts with overflow check
 */
export function safeMul(a: bigint, b: bigint): bigint {
  const result = a * b
  if (result > MAX_SAFE_BIGINT) {
    throw new Error('BigInt overflow in multiplication')
  }
  return result
}

/**
 * Safely divide two BigInts (prevents division by zero)
 */
export function safeDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) {
    throw new Error('Division by zero')
  }
  return a / b
}

/**
 * Check if a BigInt value is within safe bounds
 */
export function isSafeBigInt(value: bigint): boolean {
  return value >= 0n && value <= MAX_SAFE_BIGINT
}

/**
 * Parse a string to BigInt with validation
 */
export function safeParseBigInt(value: string): bigint {
  const parsed = BigInt(value)
  if (!isSafeBigInt(parsed)) {
    throw new Error(`BigInt value out of safe range: ${value}`)
  }
  return parsed
}

// Hash Utilities

/**
 * Create a SHA256 hash of input
 */
export function sha256(data: string | Uint8Array): Uint8Array {
  return hash256(data)
}

/**
 * Create a SHA256 hash as hex string
 */
export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(data))
}

/**
 * Create a deterministic hash from multiple inputs
 */
export function deterministicHash(
  ...inputs: (string | number | bigint)[]
): string {
  const combined = inputs.map((i) => String(i)).join(':')
  return sha256Hex(combined)
}
