/**
 * Git OID Encoding/Decoding Utilities
 * Handles conversion between Git OID strings (40-char hex) and bytes32 for on-chain storage
 */

import type { Hex } from 'viem'

/**
 * Convert Git OID (40-char hex string) to bytes32
 * Git OIDs are 20 bytes, bytes32 is 32 bytes, so we pad with zeros on the left
 */
export function encodeOidToBytes32(oid: string): Hex {
  if (oid.length !== 40) {
    throw new Error(
      `Invalid Git OID length: expected 40 chars, got ${oid.length}`,
    )
  }
  if (!/^[0-9a-f]{40}$/i.test(oid)) {
    throw new Error(`Invalid Git OID format: must be 40 hex characters`)
  }
  // Pad with zeros on the left (higher-order bytes) to make 64 chars (32 bytes)
  return `0x${oid.padStart(64, '0')}` as Hex
}

/**
 * Convert bytes32 back to Git OID (40-char hex string)
 * Removes the leading zeros to get back the original 40-char OID
 */
export function decodeBytes32ToOid(bytes32: Hex): string {
  const hex = bytes32.slice(2) // Remove '0x' prefix
  if (hex.length !== 64) {
    throw new Error(
      `Invalid bytes32 length: expected 64 chars, got ${hex.length}`,
    )
  }
  // Remove leading zeros to get back 40-char OID
  // But ensure we always return exactly 40 chars (pad if needed, though shouldn't happen)
  const oid = hex.replace(/^0+/, '')
  if (oid.length === 0) {
    return '0'.repeat(40) // All zeros case
  }
  if (oid.length > 40) {
    throw new Error(`Decoded OID too long: ${oid.length} chars`)
  }
  return oid.padStart(40, '0')
}
