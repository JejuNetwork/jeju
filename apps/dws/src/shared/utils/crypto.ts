/**
 * Cryptographic utilities for secure operations
 * Provides constant-time operations and safe BigInt handling
 */

import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison to prevent timing attacks
 * Both strings must be the same length for a meaningful comparison
 */
export function constantTimeEquals(a: string, b: string): boolean {
  // If lengths differ, still do a comparison to maintain constant time
  // but we'll use the shorter length and add the difference
  const maxLen = Math.max(a.length, b.length)
  const bufA = Buffer.alloc(maxLen)
  const bufB = Buffer.alloc(maxLen)

  Buffer.from(a).copy(bufA)
  Buffer.from(b).copy(bufB)

  // timingSafeEqual requires same length buffers
  const equal = timingSafeEqual(bufA, bufB)

  // Also check lengths match (do this after to maintain constant time)
  return equal && a.length === b.length
}

/**
 * Constant-time buffer comparison
 */
export function constantTimeBufferEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Still do comparison to maintain constant time
    const maxLen = Math.max(a.length, b.length)
    const bufA = Buffer.alloc(maxLen)
    const bufB = Buffer.alloc(maxLen)
    a.copy(bufA)
    b.copy(bufB)
    timingSafeEqual(bufA, bufB) // Run comparison to maintain timing
    return false
  }
  return timingSafeEqual(a, b)
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

// ============================================================================
// Safe BigInt Operations
// ============================================================================

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

// ============================================================================
// Hash Utilities
// ============================================================================

/**
 * Create a SHA256 hash of input
 */
export function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

/**
 * Create a SHA256 hash as hex string
 */
export function sha256Hex(data: string | Buffer): string {
  return sha256(data).toString('hex')
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
