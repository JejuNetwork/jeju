/**
 * Secure MPC Share Storage
 *
 * Uses Uint8Array instead of BigInt for secret storage to enable secure zeroing.
 * BigInt is immutable in JavaScript and cannot be reliably zeroed from memory.
 *
 * SECURITY PROPERTIES:
 * - Shares stored as Uint8Array (zeroable)
 * - Automatic zeroing on revocation
 * - Memory protection for sensitive operations
 * - No logging of secret material
 */

import type { Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'

/** Fixed size for secret shares (32 bytes = 256 bits) */
const SHARE_SIZE = 32

/**
 * A secure container for an MPC share that can be zeroed.
 *
 * Unlike BigInt, Uint8Array can be securely zeroed from memory.
 */
export class SecureShare {
  private data: Uint8Array
  private isZeroed = false

  private constructor(data: Uint8Array) {
    if (data.length !== SHARE_SIZE) {
      throw new Error(`Share must be exactly ${SHARE_SIZE} bytes`)
    }
    // Make a copy to ensure we own the memory
    this.data = new Uint8Array(data)
  }

  /**
   * Create a SecureShare from a BigInt value.
   * The BigInt should be immediately discarded after this call.
   */
  static fromBigInt(value: bigint): SecureShare {
    const hex = value.toString(16).padStart(64, '0')
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return new SecureShare(bytes)
  }

  /**
   * Create a SecureShare from a hex string.
   */
  static fromHex(hex: Hex): SecureShare {
    const bytes = toBytes(hex)
    if (bytes.length !== SHARE_SIZE) {
      throw new Error(`Hex must represent exactly ${SHARE_SIZE} bytes`)
    }
    return new SecureShare(bytes)
  }

  /**
   * Create a SecureShare from random bytes.
   */
  static random(): SecureShare {
    const bytes = new Uint8Array(SHARE_SIZE)
    crypto.getRandomValues(bytes)
    return new SecureShare(bytes)
  }

  /**
   * Create a zero share (for additive operations).
   */
  static zero(): SecureShare {
    return new SecureShare(new Uint8Array(SHARE_SIZE))
  }

  /**
   * Securely zero the share data.
   *
   * After calling this, the share cannot be used.
   */
  secureZero(): void {
    if (this.isZeroed) return

    // Fill with zeros
    this.data.fill(0)
    // Fill with random to prevent optimization from skipping
    crypto.getRandomValues(this.data)
    // Fill with zeros again
    this.data.fill(0)

    this.isZeroed = true
  }

  /**
   * Get the share as a BigInt for arithmetic operations.
   *
   * WARNING: The returned BigInt cannot be zeroed. Use sparingly and
   * ensure the result is not stored long-term.
   */
  toBigInt(): bigint {
    this.ensureNotZeroed()
    let result = 0n
    for (let i = 0; i < this.data.length; i++) {
      result = (result << 8n) | BigInt(this.data[i])
    }
    return result
  }

  /**
   * Get the share as a hex string.
   */
  toHex(): Hex {
    this.ensureNotZeroed()
    return toHex(this.data)
  }

  /**
   * Get a commitment (hash) of the share for verification.
   */
  commitment(): Hex {
    this.ensureNotZeroed()
    return keccak256(this.data)
  }

  /**
   * Clone this share.
   */
  clone(): SecureShare {
    this.ensureNotZeroed()
    return new SecureShare(new Uint8Array(this.data))
  }

  /**
   * Add another share to this one (modular addition).
   * Returns a new SecureShare.
   */
  add(other: SecureShare, modulus: bigint): SecureShare {
    this.ensureNotZeroed()
    other.ensureNotZeroed()

    const result = (this.toBigInt() + other.toBigInt()) % modulus
    return SecureShare.fromBigInt(result)
  }

  /**
   * Multiply this share by a scalar (modular multiplication).
   * Returns a new SecureShare.
   */
  multiply(scalar: bigint, modulus: bigint): SecureShare {
    this.ensureNotZeroed()
    const result = (this.toBigInt() * scalar) % modulus
    return SecureShare.fromBigInt(result)
  }

  /**
   * Check if this share has been zeroed.
   */
  isSecurelyZeroed(): boolean {
    return this.isZeroed
  }

  private ensureNotZeroed(): void {
    if (this.isZeroed) {
      throw new Error('Share has been securely zeroed and cannot be used')
    }
  }
}

/**
 * A map of secure shares that provides automatic cleanup.
 */
export class SecureShareMap {
  private shares = new Map<string, SecureShare>()

  set(key: string, share: SecureShare): void {
    // Zero existing share if present
    const existing = this.shares.get(key)
    if (existing) {
      existing.secureZero()
    }
    this.shares.set(key, share)
  }

  get(key: string): SecureShare | undefined {
    return this.shares.get(key)
  }

  has(key: string): boolean {
    return this.shares.has(key)
  }

  delete(key: string): boolean {
    const share = this.shares.get(key)
    if (share) {
      share.secureZero()
      return this.shares.delete(key)
    }
    return false
  }

  /**
   * Clear all shares, securely zeroing each one.
   */
  clear(): void {
    for (const share of this.shares.values()) {
      share.secureZero()
    }
    this.shares.clear()
  }

  /**
   * Get the number of shares stored.
   */
  get size(): number {
    return this.shares.size
  }

  /**
   * Iterate over keys.
   */
  keys(): IterableIterator<string> {
    return this.shares.keys()
  }

  /**
   * Iterate over entries.
   */
  entries(): IterableIterator<[string, SecureShare]> {
    return this.shares.entries()
  }
}

/**
 * Generate Shamir polynomial coefficients using SecureShare.
 *
 * @param secret The secret to share (as SecureShare)
 * @param degree The polynomial degree (threshold - 1)
 * @param modulus The curve order for modular arithmetic
 * @returns Array of SecureShare coefficients
 */
export function generateSecurePolynomial(
  secret: SecureShare,
  degree: number,
  modulus: bigint,
): SecureShare[] {
  const coefficients: SecureShare[] = [secret.clone()]

  for (let i = 1; i <= degree; i++) {
    const coeff = SecureShare.random()
    // Reduce modulo curve order
    const reduced = SecureShare.fromBigInt(coeff.toBigInt() % modulus)
    coeff.secureZero() // Zero the unreduced value
    coefficients.push(reduced)
  }

  return coefficients
}

/**
 * Evaluate a polynomial at a point.
 *
 * @param coefficients The polynomial coefficients as SecureShares
 * @param x The evaluation point
 * @param modulus The curve order for modular arithmetic
 * @returns The result as a SecureShare
 */
export function evaluateSecurePolynomial(
  coefficients: SecureShare[],
  x: bigint,
  modulus: bigint,
): SecureShare {
  let result = 0n
  let xPow = 1n

  for (const coeff of coefficients) {
    result = (result + coeff.toBigInt() * xPow) % modulus
    xPow = (xPow * x) % modulus
  }

  // Ensure positive
  result = ((result % modulus) + modulus) % modulus

  return SecureShare.fromBigInt(result)
}

/**
 * Zero all coefficients in a polynomial.
 */
export function zeroPolynomial(coefficients: SecureShare[]): void {
  for (const coeff of coefficients) {
    coeff.secureZero()
  }
}

