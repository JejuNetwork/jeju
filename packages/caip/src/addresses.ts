/**
 * CAIP-10: Account Identification
 * 
 * Format: chain_id:account_address
 * Examples:
 *   - eip155:1:0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb
 *   - solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */

import { PublicKey } from '@solana/web3.js';
import { isAddress as isEvmAddress, getAddress as checksumAddress } from 'viem';
import { parseChainId, formatChainId, isEvmChain, isSolanaChain, type ChainId } from './chains';

// ============================================================================
// Types
// ============================================================================

export interface AccountId {
  chainId: ChainId;
  address: string;
}

export interface UniversalAddress {
  caip10: string;
  chainId: ChainId;
  address: string;
  isEvm: boolean;
  isSolana: boolean;
  normalized: string;
}

// ============================================================================
// Parsing & Formatting
// ============================================================================

/**
 * Parse a CAIP-10 account ID string
 */
export function parseAccountId(caip10: string): AccountId {
  const lastColonIndex = caip10.lastIndexOf(':');
  if (lastColonIndex === -1) {
    throw new Error(`Invalid CAIP-10 account ID: ${caip10}`);
  }

  // Find the chain ID portion (everything before the last colon for EVM, 
  // or structured differently for Solana)
  const parts = caip10.split(':');
  if (parts.length < 3) {
    throw new Error(`Invalid CAIP-10 account ID: ${caip10}`);
  }

  const namespace = parts[0];
  const reference = parts[1];
  const address = parts.slice(2).join(':');

  return {
    chainId: { namespace: namespace as 'eip155' | 'solana', reference },
    address,
  };
}

/**
 * Format an AccountId to CAIP-10 string
 */
export function formatAccountId(accountId: AccountId): string {
  return `${formatChainId(accountId.chainId)}:${accountId.address}`;
}

/**
 * Create a universal address from a CAIP-10 string
 */
export function createUniversalAddress(caip10: string): UniversalAddress {
  const { chainId, address } = parseAccountId(caip10);
  const chainIdStr = formatChainId(chainId);
  const isEvm = isEvmChain(chainIdStr);
  const isSolana = isSolanaChain(chainIdStr);

  // Normalize address
  let normalized = address;
  if (isEvm) {
    normalized = checksumAddress(address as `0x${string}`);
  } else if (isSolana) {
    normalized = new PublicKey(address).toBase58();
  }

  return {
    caip10: formatAccountId({ chainId, address: normalized }),
    chainId,
    address,
    isEvm,
    isSolana,
    normalized,
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a CAIP-10 account ID
 */
export function isValidAccountId(caip10: string): boolean {
  try {
    const { chainId, address } = parseAccountId(caip10);
    const chainIdStr = formatChainId(chainId);

    if (isEvmChain(chainIdStr)) {
      return isEvmAddress(address);
    }

    if (isSolanaChain(chainIdStr)) {
      return isValidSolanaAddress(address);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if string is valid Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if string is valid EVM address
 */
export function isValidEvmAddress(address: string): boolean {
  return isEvmAddress(address);
}

// ============================================================================
// Conversion
// ============================================================================

/**
 * Convert EVM address to CAIP-10
 */
export function evmAddressToCAIP10(chainId: number, address: string): string {
  if (!isEvmAddress(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }

  return `eip155:${chainId}:${checksumAddress(address as `0x${string}`)}`;
}

/**
 * Convert Solana address to CAIP-10
 */
export function solanaAddressToCAIP10(
  address: string,
  cluster: 'mainnet-beta' | 'devnet' | 'testnet' = 'mainnet-beta'
): string {
  const pubkey = new PublicKey(address);
  
  const genesisHashes: Record<string, string> = {
    'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'devnet': 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    'testnet': '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
  };

  return `solana:${genesisHashes[cluster]}:${pubkey.toBase58()}`;
}

/**
 * Extract EVM address from CAIP-10
 */
export function caip10ToEvmAddress(caip10: string): `0x${string}` | undefined {
  const { chainId, address } = parseAccountId(caip10);
  const chainIdStr = formatChainId(chainId);
  
  if (!isEvmChain(chainIdStr)) {
    return undefined;
  }

  return checksumAddress(address as `0x${string}`);
}

/**
 * Extract Solana PublicKey from CAIP-10
 */
export function caip10ToSolanaPublicKey(caip10: string): PublicKey | undefined {
  const { chainId, address } = parseAccountId(caip10);
  const chainIdStr = formatChainId(chainId);
  
  if (!isSolanaChain(chainIdStr)) {
    return undefined;
  }

  return new PublicKey(address);
}

// ============================================================================
// Multi-chain Address Utilities
// ============================================================================

export interface MultiChainAddress {
  original: string;
  evm?: `0x${string}`;
  solana?: PublicKey;
  bytes32: Uint8Array;
}

/**
 * Create a multi-chain compatible address representation
 */
export function createMultiChainAddress(caip10: string): MultiChainAddress {
  const { chainId, address } = parseAccountId(caip10);
  const chainIdStr = formatChainId(chainId);
  
  const result: MultiChainAddress = {
    original: address,
    bytes32: new Uint8Array(32),
  };

  if (isEvmChain(chainIdStr)) {
    result.evm = checksumAddress(address as `0x${string}`);
    // EVM addresses are 20 bytes, pad to 32
    const bytes = Buffer.from(address.slice(2), 'hex');
    result.bytes32.set(bytes, 12); // Right-align in 32 bytes
  } else if (isSolanaChain(chainIdStr)) {
    result.solana = new PublicKey(address);
    result.bytes32 = result.solana.toBytes();
  }

  return result;
}

/**
 * Convert 32-byte representation back to address
 */
export function bytes32ToAddress(bytes: Uint8Array, isEvm: boolean): string {
  if (isEvm) {
    // EVM addresses are the last 20 bytes
    const addressBytes = bytes.slice(12);
    return checksumAddress(`0x${Buffer.from(addressBytes).toString('hex')}` as `0x${string}`);
  } else {
    // Solana uses full 32 bytes
    return new PublicKey(bytes).toBase58();
  }
}

/**
 * Compare two CAIP-10 addresses for equality
 */
export function areAddressesEqual(a: string, b: string): boolean {
  try {
    const addrA = createUniversalAddress(a);
    const addrB = createUniversalAddress(b);

    return (
      formatChainId(addrA.chainId) === formatChainId(addrB.chainId) &&
      addrA.normalized.toLowerCase() === addrB.normalized.toLowerCase()
    );
  } catch {
    return false;
  }
}

/**
 * Get short display version of address
 */
export function shortenAddress(caip10: string, chars: number = 4): string {
  const { address } = parseAccountId(caip10);
  
  if (address.length <= chars * 2 + 3) {
    return address;
  }

  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

