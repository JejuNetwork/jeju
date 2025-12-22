/**
 * Address Utilities
 *
 * Common address conversion functions used across the package.
 */

import type { Address, Hex } from 'viem'

// Regex patterns for validation
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/
const BYTES32_REGEX = /^0x[a-fA-F0-9]{64}$/
const HEX_REGEX = /^0x[a-fA-F0-9]+$/

/**
 * Validate an EVM address format
 */
export function isValidEvmAddress(address: string): boolean {
  return EVM_ADDRESS_REGEX.test(address)
}

/**
 * Validate a bytes32 hex string
 */
export function isValidBytes32(hex: string): boolean {
  return BYTES32_REGEX.test(hex)
}

/**
 * Convert an EVM address to bytes32 format
 * Used for Hyperlane cross-chain messaging
 * @throws Error if address format is invalid
 */
export function addressToBytes32(address: string): Hex {
  // Validate address format (must be 0x + 40 hex chars, or just 40 hex chars)
  const isWithPrefix = EVM_ADDRESS_REGEX.test(address)
  const isWithoutPrefix = /^[a-fA-F0-9]{40}$/.test(address)

  if (!isWithPrefix && !isWithoutPrefix) {
    throw new Error(
      `Invalid EVM address format: ${address}. Expected 0x followed by 40 hex characters.`,
    )
  }

  const clean = address.toLowerCase().replace('0x', '')
  return `0x${clean.padStart(64, '0')}` as Hex
}

/**
 * Convert bytes32 back to an EVM address
 * Takes the last 40 characters (20 bytes)
 * @throws Error if bytes32 format is invalid
 */
export function bytes32ToAddress(bytes32: Hex): Address {
  // Validate bytes32 format
  if (!HEX_REGEX.test(bytes32)) {
    throw new Error(
      `Invalid hex string: ${bytes32}. Expected 0x followed by hex characters.`,
    )
  }

  // Must have at least 40 hex chars (20 bytes) for the address
  const hexPart = bytes32.slice(2) // Remove 0x prefix
  if (hexPart.length < 40) {
    throw new Error(
      `Hex string too short: ${bytes32}. Need at least 40 hex characters for an address.`,
    )
  }

  const addressPart = bytes32.slice(-40)
  return `0x${addressPart}` as Address
}
