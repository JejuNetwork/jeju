/**
 * CID Encoding/Decoding Utilities
 * Handles conversion between CID strings (hex/IPFS base58) and bytes32 for on-chain storage
 */

import { type Hex, keccak256, toBytes } from 'viem'

/**
 * Check if a CID is in hex format (local backend) or base58 (IPFS)
 */
export function isHexCid(cid: string): boolean {
  // Local backend generates hex CIDs (48 chars, keccak256 hash)
  // IPFS generates base58 CIDs (starts with Qm or bafy)
  return /^[0-9a-f]{48}$/i.test(cid)
}

/**
 * Check if a CID is an IPFS CID (base58)
 */
export function isIPFSCid(cid: string): boolean {
  return cid.startsWith('Qm') || cid.startsWith('bafy') || cid.startsWith('baf')
}

/**
 * Encode CID string to bytes32 for on-chain storage
 * Uses keccak256 hash of the CID string to ensure deterministic encoding
 * This allows us to recover the CID from storage backend using the hash as lookup key
 */
export function encodeCidToBytes32(cid: string): Hex {
  // Hash the CID string to get deterministic bytes32
  // Store mapping in backend for recovery
  return keccak256(toBytes(cid))
}

/**
 * Decode bytes32 back to CID string
 * Since we hash the CID, we need to look it up from storage backend
 * This function returns the lookup key - actual CID retrieval happens in registry manager
 */
export function decodeBytes32ToCidKey(bytes32: Hex): string {
  // Return the hex representation for lookup
  // The registry manager will use this to look up the actual CID from storage
  return bytes32
}

/**
 * Convert CID to hex string for storage lookup
 * Handles both hex CIDs (local) and base58 CIDs (IPFS)
 */
export function cidToHex(cid: string): string {
  if (isHexCid(cid)) {
    return cid
  }
  // For IPFS CIDs, we'll use the keccak256 hash as the lookup key
  return keccak256(toBytes(cid)).slice(2)
}

/**
 * Get CID from bytes32 hash
 * Since bytes32 is a hash of the CID, we need to look it up
 * This is a helper that returns the hash for backend lookup
 */
export function getCidFromBytes32(
  bytes32: Hex,
  cidMap: Map<Hex, string>,
): string | null {
  return cidMap.get(bytes32) || null
}
