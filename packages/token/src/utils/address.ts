/**
 * Address Utilities
 *
 * Common address conversion functions used across the package.
 */

import type { Address, Hex } from 'viem';

/**
 * Convert an EVM address to bytes32 format
 * Used for Hyperlane cross-chain messaging
 */
export function addressToBytes32(address: string): Hex {
  const clean = address.toLowerCase().replace('0x', '');
  return `0x${clean.padStart(64, '0')}` as Hex;
}

/**
 * Convert bytes32 back to an EVM address
 * Takes the last 40 characters (20 bytes)
 */
export function bytes32ToAddress(bytes32: Hex): Address {
  const addressPart = bytes32.slice(-40);
  return `0x${addressPart}` as Address;
}

/**
 * Check if a string is a valid EVM address format
 */
export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

/**
 * Normalize an address to lowercase with 0x prefix
 */
export function normalizeAddress(address: string): Address {
  const clean = address.toLowerCase().replace('0x', '');
  return `0x${clean}` as Address;
}

/**
 * Get checksum address format
 */
export function checksumAddress(address: string): Address {
  // For full checksum implementation, use viem's getAddress
  // This is a simple normalization
  return normalizeAddress(address);
}
