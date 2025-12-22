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
