/**
 * @jeju/caip
 * 
 * Chain Agnostic Improvement Proposals (CAIP) implementation
 * for universal cross-chain addressing.
 * 
 * Supports:
 * - CAIP-2: Chain Identification
 * - CAIP-10: Account Identification
 * - CAIP-19: Asset Identification
 * 
 * Compatible with EVM and Solana chains.
 */

// Chain identification (CAIP-2)
export {
  parseChainId,
  formatChainId,
  getChainInfo,
  evmChainIdToCAIP2,
  caip2ToEvmChainId,
  isEvmChain,
  isSolanaChain,
  getSolanaCluster,
  solanaClusterToCAIP2,
  getAllChains,
  getMainnetChains,
  getTestnetChains,
  CHAINS,
  SOLANA_MAINNET_GENESIS,
  SOLANA_DEVNET_GENESIS,
  SOLANA_TESTNET_GENESIS,
  type ChainNamespace,
  type ChainId,
  type ChainInfo,
} from './chains';

// Account identification (CAIP-10)
export {
  parseAccountId,
  formatAccountId,
  createUniversalAddress,
  isValidAccountId,
  isValidSolanaAddress,
  isValidEvmAddress,
  evmAddressToCAIP10,
  solanaAddressToCAIP10,
  caip10ToEvmAddress,
  caip10ToSolanaPublicKey,
  createMultiChainAddress,
  bytes32ToAddress,
  areAddressesEqual,
  shortenAddress,
  type AccountId,
  type UniversalAddress,
  type MultiChainAddress,
} from './addresses';

// Asset identification (CAIP-19)
export {
  parseAssetType,
  formatAssetType,
  getAssetInfo,
  isValidAssetType,
  nativeCurrencyToCAIP19,
  erc20ToCAIP19,
  splTokenToCAIP19,
  erc721ToCAIP19,
  caip19ToErc20Address,
  caip19ToSplMint,
  findEquivalentAsset,
  getAssetChainMap,
  SLIP44,
  KNOWN_ASSETS,
  CROSS_CHAIN_ASSETS,
  type AssetNamespace,
  type AssetType,
  type AssetInfo,
  type CrossChainAsset,
} from './assets';

// ============================================================================
// Convenience Re-exports
// ============================================================================

export { PublicKey } from '@solana/web3.js';
export { isAddress as isEvmAddress, getAddress as checksumEvmAddress } from 'viem';

// ============================================================================
// Unified Types
// ============================================================================

/**
 * Universal identifier that can represent any chain, account, or asset
 */
export interface UniversalId {
  type: 'chain' | 'account' | 'asset';
  raw: string;
  namespace: string;
  chainId?: string;
  address?: string;
  assetNamespace?: string;
  assetReference?: string;
  tokenId?: string;
}

/**
 * Parse any CAIP identifier (CAIP-2, CAIP-10, or CAIP-19)
 */
export function parseUniversalId(caip: string): UniversalId {
  // CAIP-19 contains '/'
  if (caip.includes('/')) {
    const { chainId, assetNamespace, assetReference, tokenId } = parseAssetType(caip);
    return {
      type: 'asset',
      raw: caip,
      namespace: chainId.namespace,
      chainId: formatChainId(chainId),
      assetNamespace,
      assetReference,
      tokenId,
    };
  }

  // Count colons to distinguish CAIP-2 from CAIP-10
  const colonCount = (caip.match(/:/g) || []).length;
  
  if (colonCount === 1) {
    // CAIP-2: namespace:reference
    const chainId = parseChainId(caip);
    return {
      type: 'chain',
      raw: caip,
      namespace: chainId.namespace,
      chainId: formatChainId(chainId),
    };
  }

  // CAIP-10: namespace:reference:address
  const accountId = parseAccountId(caip);
  return {
    type: 'account',
    raw: caip,
    namespace: accountId.chainId.namespace,
    chainId: formatChainId(accountId.chainId),
    address: accountId.address,
  };
}

/**
 * Check if identifier is valid CAIP format
 */
export function isValidCAIP(caip: string): boolean {
  try {
    parseUniversalId(caip);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the type of CAIP identifier
 */
export function getCAIPType(caip: string): 'chain' | 'account' | 'asset' | null {
  try {
    return parseUniversalId(caip).type;
  } catch {
    return null;
  }
}

// ============================================================================
// Builder Utilities
// ============================================================================

/**
 * Builder for creating CAIP identifiers
 */
export class CAIPBuilder {
  private namespace: string = 'eip155';
  private chainReference: string = '1';

  /**
   * Set chain using EVM chain ID
   */
  evmChain(chainId: number): this {
    this.namespace = 'eip155';
    this.chainReference = chainId.toString();
    return this;
  }

  /**
   * Set chain to Solana
   */
  solanaChain(cluster: 'mainnet-beta' | 'devnet' | 'testnet' = 'mainnet-beta'): this {
    this.namespace = 'solana';
    const genesisHashes: Record<string, string> = {
      'mainnet-beta': SOLANA_MAINNET_GENESIS,
      'devnet': SOLANA_DEVNET_GENESIS,
      'testnet': '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
    };
    this.chainReference = genesisHashes[cluster];
    return this;
  }

  /**
   * Build CAIP-2 chain identifier
   */
  chainId(): string {
    return `${this.namespace}:${this.chainReference}`;
  }

  /**
   * Build CAIP-10 account identifier
   */
  accountId(address: string): string {
    return `${this.namespace}:${this.chainReference}:${address}`;
  }

  /**
   * Build CAIP-19 asset identifier for native currency
   */
  nativeAsset(): string {
    if (this.namespace === 'eip155') {
      return `${this.namespace}:${this.chainReference}/slip44:60`;
    }
    return `${this.namespace}:${this.chainReference}/native:SOL`;
  }

  /**
   * Build CAIP-19 asset identifier for token
   */
  tokenAsset(tokenAddress: string): string {
    if (this.namespace === 'eip155') {
      return `${this.namespace}:${this.chainReference}/erc20:${tokenAddress}`;
    }
    return `${this.namespace}:${this.chainReference}/spl:${tokenAddress}`;
  }

  /**
   * Build CAIP-19 asset identifier for NFT
   */
  nftAsset(contractAddress: string, tokenId: string | number): string {
    if (this.namespace === 'eip155') {
      return `${this.namespace}:${this.chainReference}/erc721:${contractAddress}:${tokenId}`;
    }
    throw new Error('NFT assets are EVM-only in this implementation');
  }
}

/**
 * Create a new CAIP builder
 */
export function caip(): CAIPBuilder {
  return new CAIPBuilder();
}

// Import required items for parseAssetType and parseChainId
import { parseAssetType } from './assets';
import { parseChainId, formatChainId, SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS } from './chains';
import { parseAccountId } from './addresses';



