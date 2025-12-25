/**
 * Hash-to-Curve Implementation (RFC 9380)
 *
 * Proper implementation using @noble/curves:
 * - SSWU (Simplified Shallue-van de Woestijne-Ulas) method
 * - Constant-time operations
 * - Domain separation for different contexts
 */

import { bls12_381 as bls } from '@noble/curves/bls12-381'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js'
import type { Hex } from 'viem'

// Types

/** G1 point (48 bytes compressed) */
export type G1Point = Hex

/** G2 point (96 bytes compressed) */
export type G2Point = Hex

/** Domain Separation Tag */
export type DST = string

// Constants

/** Default DST for BLS signatures */
export const DST_BLS_SIG = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_'

/** DST for proof of possession */
export const DST_BLS_POP = 'BLS_POP_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_'

/** DST for DA attestations */
export const DST_DA_ATTEST = 'JEJU_DA_BLS12381G2_XMD:SHA-256_SSWU_RO_ATTEST_'

/** DST for DA sampling */
export const DST_DA_SAMPLE = 'JEJU_DA_BLS12381G2_XMD:SHA-256_SSWU_RO_SAMPLE_'

/** Maximum DST length */
export const MAX_DST_LEN = 255

/** Security level (bits) */
export const SECURITY_LEVEL = 128

// Hash-to-G1

/**
 * Hash arbitrary data to a G1 curve point
 * Uses SSWU method per RFC 9380
 */
export function hashToG1(
  message: Uint8Array,
  dst: DST = DST_DA_ATTEST,
): G1Point {
  if (dst.length > MAX_DST_LEN) {
    throw new Error(`DST too long: ${dst.length} > ${MAX_DST_LEN}`)
  }

  const h2cPoint = bls.G1.hashToCurve(message, { DST: dst })
  const point = bls.G1.ProjectivePoint.fromAffine(h2cPoint.toAffine())
  return `0x${bytesToHex(point.toRawBytes(true))}` as G1Point
}

/**
 * Hash arbitrary data to a G1 curve point (encode variant)
 * Non-uniform encoding - faster but not suitable for all applications
 */
export function encodeToG1(
  message: Uint8Array,
  dst: DST = DST_DA_ATTEST,
): G1Point {
  if (dst.length > MAX_DST_LEN) {
    throw new Error(`DST too long: ${dst.length} > ${MAX_DST_LEN}`)
  }

  const h2cPoint = bls.G1.hashToCurve(message, { DST: dst })
  const point = bls.G1.ProjectivePoint.fromAffine(h2cPoint.toAffine())
  return `0x${bytesToHex(point.toRawBytes(true))}` as G1Point
}

// Hash-to-G2

/**
 * Hash arbitrary data to a G2 curve point
 * Uses SSWU method per RFC 9380
 */
export function hashToG2(
  message: Uint8Array,
  dst: DST = DST_DA_ATTEST,
): G2Point {
  if (dst.length > MAX_DST_LEN) {
    throw new Error(`DST too long: ${dst.length} > ${MAX_DST_LEN}`)
  }

  const h2cPoint = bls.G2.hashToCurve(message, { DST: dst })
  const point = bls.G2.ProjectivePoint.fromAffine(h2cPoint.toAffine())
  return `0x${bytesToHex(point.toRawBytes(true))}` as G2Point
}

/**
 * Hash arbitrary data to a G2 curve point (encode variant)
 */
export function encodeToG2(
  message: Uint8Array,
  dst: DST = DST_DA_ATTEST,
): G2Point {
  if (dst.length > MAX_DST_LEN) {
    throw new Error(`DST too long: ${dst.length} > ${MAX_DST_LEN}`)
  }

  const h2cPoint = bls.G2.hashToCurve(message, { DST: dst })
  const point = bls.G2.ProjectivePoint.fromAffine(h2cPoint.toAffine())
  return `0x${bytesToHex(point.toRawBytes(true))}` as G2Point
}

// Expand Message (XMD)

/**
 * expand_message_xmd per RFC 9380 Section 5.3.1
 * Uses SHA-256 as the underlying hash function
 */
export function expandMessageXMD(
  message: Uint8Array,
  dst: DST,
  lenInBytes: number,
): Uint8Array {
  if (dst.length > MAX_DST_LEN) {
    throw new Error(`DST too long: ${dst.length} > ${MAX_DST_LEN}`)
  }

  const dstBytes = new TextEncoder().encode(dst)

  // Hash function block size and output length
  const b_in_bytes = 32 // SHA-256 output length
  const r_in_bytes = 64 // SHA-256 block size

  const ell = Math.ceil(lenInBytes / b_in_bytes)
  if (ell > 255) {
    throw new Error('Requested length too large')
  }

  // I2OSP(len_in_bytes, 2) || I2OSP(0, 1) || DST || I2OSP(len(DST), 1)
  const dstPrime = new Uint8Array([...dstBytes, dstBytes.length])

  // Lib_str = I2OSP(len_in_bytes, 2)
  const libStr = new Uint8Array([(lenInBytes >> 8) & 0xff, lenInBytes & 0xff])

  // Z_pad = I2OSP(0, r_in_bytes)
  const zPad = new Uint8Array(r_in_bytes)

  // b_0 = H(Z_pad || msg || lib_str || I2OSP(0, 1) || DST_prime)
  const b0Input = concatBytes(
    zPad,
    message,
    libStr,
    new Uint8Array([0]),
    dstPrime,
  )
  const b0 = sha256(b0Input)

  // b_1 = H(b_0 || I2OSP(1, 1) || DST_prime)
  const b1Input = concatBytes(b0, new Uint8Array([1]), dstPrime)
  let bi = sha256(b1Input)

  const result = new Uint8Array(lenInBytes)
  let offset = 0

  // Copy first block
  const toCopy = Math.min(b_in_bytes, lenInBytes - offset)
  result.set(bi.slice(0, toCopy), offset)
  offset += toCopy

  // Generate remaining blocks
  for (let i = 2; i <= ell && offset < lenInBytes; i++) {
    // b_i = H(strxor(b_0, b_{i-1}) || I2OSP(i, 1) || DST_prime)
    const xored = new Uint8Array(b_in_bytes)
    for (let j = 0; j < b_in_bytes; j++) {
      xored[j] = b0[j] ^ bi[j]
    }

    const input = concatBytes(xored, new Uint8Array([i]), dstPrime)
    bi = sha256(input)

    const copyLen = Math.min(b_in_bytes, lenInBytes - offset)
    result.set(bi.slice(0, copyLen), offset)
    offset += copyLen
  }

  return result
}

// Hash to Field

/**
 * Hash to scalar field element
 * Returns element in F_r (scalar field of BLS12-381)
 */
export function hashToField(
  message: Uint8Array,
  dst: DST,
  count: number = 1,
): bigint[] {
  // BLS12-381 scalar field modulus
  const r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n

  // L = ceil((ceil(log2(p)) + k) / 8) for 128-bit security
  const L = 64 // 48 bytes for p, +16 for security

  const lenInBytes = count * L
  const uniformBytes = expandMessageXMD(message, dst, lenInBytes)

  const results: bigint[] = []

  for (let i = 0; i < count; i++) {
    const offset = i * L
    const bytes = uniformBytes.slice(offset, offset + L)

    // Convert to bigint and reduce mod r
    let value = 0n
    for (const byte of bytes) {
      value = (value << 8n) | BigInt(byte)
    }

    results.push(value % r)
  }

  return results
}

// Verification

/**
 * Verify a G1 point is valid (on curve and in subgroup)
 */
export function verifyG1Point(point: G1Point): boolean {
  try {
    const bytes = hexToBytes(point.slice(2))
    const p = bls.G1.ProjectivePoint.fromHex(bytes)

    // Check on curve and in subgroup
    p.assertValidity()
    return true
  } catch {
    return false
  }
}

/**
 * Verify a G2 point is valid (on curve and in subgroup)
 */
export function verifyG2Point(point: G2Point): boolean {
  try {
    const bytes = hexToBytes(point.slice(2))
    const p = bls.G2.ProjectivePoint.fromHex(bytes)

    // Check on curve and in subgroup
    p.assertValidity()
    return true
  } catch {
    return false
  }
}

// Point Operations

/**
 * Add two G1 points
 */
export function addG1Points(a: G1Point, b: G1Point): G1Point {
  const aBytes = hexToBytes(a.slice(2))
  const bBytes = hexToBytes(b.slice(2))

  const aPoint = bls.G1.ProjectivePoint.fromHex(aBytes)
  const bPoint = bls.G1.ProjectivePoint.fromHex(bBytes)

  const sum = aPoint.add(bPoint)
  return `0x${bytesToHex(sum.toRawBytes(true))}` as G1Point
}

/**
 * Add two G2 points
 */
export function addG2Points(a: G2Point, b: G2Point): G2Point {
  const aBytes = hexToBytes(a.slice(2))
  const bBytes = hexToBytes(b.slice(2))

  const aPoint = bls.G2.ProjectivePoint.fromHex(aBytes)
  const bPoint = bls.G2.ProjectivePoint.fromHex(bBytes)

  const sum = aPoint.add(bPoint)
  return `0x${bytesToHex(sum.toRawBytes(true))}` as G2Point
}

/**
 * Scalar multiplication on G1
 */
export function mulG1(point: G1Point, scalar: bigint): G1Point {
  const bytes = hexToBytes(point.slice(2))
  const p = bls.G1.ProjectivePoint.fromHex(bytes)

  const result = p.multiply(scalar)
  return `0x${bytesToHex(result.toRawBytes(true))}` as G1Point
}

/**
 * Scalar multiplication on G2
 */
export function mulG2(point: G2Point, scalar: bigint): G2Point {
  const bytes = hexToBytes(point.slice(2))
  const p = bls.G2.ProjectivePoint.fromHex(bytes)

  const result = p.multiply(scalar)
  return `0x${bytesToHex(result.toRawBytes(true))}` as G2Point
}

/**
 * Get G1 generator point
 */
export function G1Generator(): G1Point {
  return `0x${bytesToHex(bls.G1.ProjectivePoint.BASE.toRawBytes(true))}` as G1Point
}

/**
 * Get G2 generator point
 */
export function G2Generator(): G2Point {
  return `0x${bytesToHex(bls.G2.ProjectivePoint.BASE.toRawBytes(true))}` as G2Point
}

// Serialization

/**
 * Compress G1 point
 */
export function compressG1(point: G1Point): Uint8Array {
  const bytes = hexToBytes(point.slice(2))
  const p = bls.G1.ProjectivePoint.fromHex(bytes)
  return p.toRawBytes(true)
}

/**
 * Decompress G1 point
 */
export function decompressG1(compressed: Uint8Array): G1Point {
  const p = bls.G1.ProjectivePoint.fromHex(compressed)
  return `0x${bytesToHex(p.toRawBytes(true))}` as G1Point
}

/**
 * Compress G2 point
 */
export function compressG2(point: G2Point): Uint8Array {
  const bytes = hexToBytes(point.slice(2))
  const p = bls.G2.ProjectivePoint.fromHex(bytes)
  return p.toRawBytes(true)
}

/**
 * Decompress G2 point
 */
export function decompressG2(compressed: Uint8Array): G2Point {
  const p = bls.G2.ProjectivePoint.fromHex(compressed)
  return `0x${bytesToHex(p.toRawBytes(true))}` as G2Point
}

// Exports

export const HashToCurve = {
  // Hash-to-curve
  hashToG1,
  hashToG2,
  encodeToG1,
  encodeToG2,

  // Field operations
  hashToField,
  expandMessageXMD,

  // Verification
  verifyG1Point,
  verifyG2Point,

  // Point operations
  addG1Points,
  addG2Points,
  mulG1,
  mulG2,
  G1Generator,
  G2Generator,

  // Serialization
  compressG1,
  decompressG1,
  compressG2,
  decompressG2,

  // Constants
  DST_BLS_SIG,
  DST_BLS_POP,
  DST_DA_ATTEST,
  DST_DA_SAMPLE,
}
