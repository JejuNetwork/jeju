/**
 * CAIP-19: Asset Identification
 * 
 * Format: chain_id/asset_namespace:asset_reference
 * Examples:
 *   - eip155:1/erc20:0xdAC17F958D2ee523a2206206994597C13D831ec7 (USDT on Ethereum)
 *   - eip155:1/slip44:60 (Native ETH)
 *   - solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (USDC on Solana)
 */

import { PublicKey } from '@solana/web3.js';
import { isAddress as isEvmAddress, getAddress as checksumAddress } from 'viem';
import { 
  parseChainId, 
  formatChainId, 
  isEvmChain, 
  isSolanaChain,
  SOLANA_MAINNET_GENESIS,
  SOLANA_DEVNET_GENESIS,
  type ChainId,
} from './chains';

// ============================================================================
// Types
// ============================================================================

export type AssetNamespace = 'slip44' | 'erc20' | 'erc721' | 'erc1155' | 'spl' | 'native';

export interface AssetType {
  chainId: ChainId;
  assetNamespace: AssetNamespace;
  assetReference: string;
  tokenId?: string; // For NFTs
}

export interface AssetInfo {
  caip19: string;
  chainId: ChainId;
  namespace: AssetNamespace;
  reference: string;
  tokenId?: string;
  isNative: boolean;
  isFungible: boolean;
  isNFT: boolean;
}

// ============================================================================
// Constants
// ============================================================================

// SLIP44 coin types for native currencies
export const SLIP44 = {
  ETH: 60,
  BTC: 0,
  SOL: 501,
  MATIC: 966,
  AVAX: 9000,
} as const;

// Well-known tokens
export const KNOWN_ASSETS: Record<string, { name: string; symbol: string; decimals: number }> = {
  // Ethereum Mainnet
  'eip155:1/erc20:0xdAC17F958D2ee523a2206206994597C13D831ec7': {
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 6,
  },
  'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
  },
  'eip155:1/erc20:0x6B175474E89094C44Da98b954EescdecB5Fc4d6F': {
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18,
  },

  // Solana Mainnet
  [`solana:${SOLANA_MAINNET_GENESIS}/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`]: {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
  },
  [`solana:${SOLANA_MAINNET_GENESIS}/spl:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`]: {
    name: 'USDT',
    symbol: 'USDT',
    decimals: 6,
  },
};

// ============================================================================
// Parsing & Formatting
// ============================================================================

/**
 * Parse a CAIP-19 asset type string
 */
export function parseAssetType(caip19: string): AssetType {
  // Format: chain_id/asset_namespace:asset_reference[:token_id]
  const slashIndex = caip19.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(`Invalid CAIP-19 asset type: ${caip19}`);
  }

  const chainIdStr = caip19.slice(0, slashIndex);
  const assetPart = caip19.slice(slashIndex + 1);

  const colonIndex = assetPart.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(`Invalid CAIP-19 asset type: ${caip19}`);
  }

  const assetNamespace = assetPart.slice(0, colonIndex) as AssetNamespace;
  const assetReferenceAndTokenId = assetPart.slice(colonIndex + 1);

  // Check for token ID (for NFTs)
  let assetReference = assetReferenceAndTokenId;
  let tokenId: string | undefined;

  if (assetNamespace === 'erc721' || assetNamespace === 'erc1155') {
    const tokenIdIndex = assetReferenceAndTokenId.lastIndexOf(':');
    if (tokenIdIndex !== -1) {
      assetReference = assetReferenceAndTokenId.slice(0, tokenIdIndex);
      tokenId = assetReferenceAndTokenId.slice(tokenIdIndex + 1);
    }
  }

  return {
    chainId: parseChainId(chainIdStr),
    assetNamespace,
    assetReference,
    tokenId,
  };
}

/**
 * Format an AssetType to CAIP-19 string
 */
export function formatAssetType(asset: AssetType): string {
  let result = `${formatChainId(asset.chainId)}/${asset.assetNamespace}:${asset.assetReference}`;
  
  if (asset.tokenId !== undefined) {
    result += `:${asset.tokenId}`;
  }

  return result;
}

/**
 * Create detailed asset info from CAIP-19 string
 */
export function getAssetInfo(caip19: string): AssetInfo {
  const asset = parseAssetType(caip19);

  const isNative = asset.assetNamespace === 'slip44' || asset.assetNamespace === 'native';
  const isFungible = asset.assetNamespace === 'erc20' || 
                      asset.assetNamespace === 'spl' || 
                      isNative;
  const isNFT = asset.assetNamespace === 'erc721' || asset.assetNamespace === 'erc1155';

  return {
    caip19: formatAssetType(asset),
    chainId: asset.chainId,
    namespace: asset.assetNamespace,
    reference: asset.assetReference,
    tokenId: asset.tokenId,
    isNative,
    isFungible,
    isNFT,
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a CAIP-19 asset type
 */
export function isValidAssetType(caip19: string): boolean {
  try {
    const asset = parseAssetType(caip19);
    const chainIdStr = formatChainId(asset.chainId);

    // Validate asset reference based on namespace and chain
    if (isEvmChain(chainIdStr)) {
      if (asset.assetNamespace === 'erc20' || 
          asset.assetNamespace === 'erc721' || 
          asset.assetNamespace === 'erc1155') {
        return isEvmAddress(asset.assetReference);
      }
      if (asset.assetNamespace === 'slip44') {
        return !isNaN(parseInt(asset.assetReference, 10));
      }
    }

    if (isSolanaChain(chainIdStr)) {
      if (asset.assetNamespace === 'spl') {
        try {
          new PublicKey(asset.assetReference);
          return true;
        } catch {
          return false;
        }
      }
      if (asset.assetNamespace === 'native') {
        return asset.assetReference === 'SOL';
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Create CAIP-19 for native currency
 */
export function nativeCurrencyToCAIP19(chainId: number | string): string {
  if (typeof chainId === 'number') {
    // EVM chain - use SLIP44
    return `eip155:${chainId}/slip44:${SLIP44.ETH}`;
  } else if (chainId.startsWith('solana:')) {
    const reference = chainId.split(':')[1];
    return `solana:${reference}/native:SOL`;
  }
  throw new Error(`Unsupported chain: ${chainId}`);
}

/**
 * Create CAIP-19 for ERC20 token
 */
export function erc20ToCAIP19(chainId: number, tokenAddress: string): string {
  if (!isEvmAddress(tokenAddress)) {
    throw new Error(`Invalid ERC20 address: ${tokenAddress}`);
  }

  return `eip155:${chainId}/erc20:${checksumAddress(tokenAddress as `0x${string}`)}`;
}

/**
 * Create CAIP-19 for SPL token
 */
export function splTokenToCAIP19(
  tokenMint: string,
  cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'
): string {
  const pubkey = new PublicKey(tokenMint);
  
  const genesisHashes: Record<string, string> = {
    'mainnet-beta': SOLANA_MAINNET_GENESIS,
    'devnet': SOLANA_DEVNET_GENESIS,
  };

  return `solana:${genesisHashes[cluster]}/spl:${pubkey.toBase58()}`;
}

/**
 * Create CAIP-19 for ERC721 NFT
 */
export function erc721ToCAIP19(
  chainId: number,
  contractAddress: string,
  tokenId: string | number
): string {
  if (!isEvmAddress(contractAddress)) {
    throw new Error(`Invalid contract address: ${contractAddress}`);
  }

  return `eip155:${chainId}/erc721:${checksumAddress(contractAddress as `0x${string}`)}:${tokenId}`;
}

/**
 * Extract ERC20 address from CAIP-19
 */
export function caip19ToErc20Address(caip19: string): `0x${string}` | undefined {
  const asset = parseAssetType(caip19);
  
  if (asset.assetNamespace !== 'erc20') {
    return undefined;
  }

  return checksumAddress(asset.assetReference as `0x${string}`);
}

/**
 * Extract SPL mint from CAIP-19
 */
export function caip19ToSplMint(caip19: string): PublicKey | undefined {
  const asset = parseAssetType(caip19);
  
  if (asset.assetNamespace !== 'spl') {
    return undefined;
  }

  return new PublicKey(asset.assetReference);
}

// ============================================================================
// Cross-chain Asset Mapping
// ============================================================================

export interface CrossChainAsset {
  name: string;
  symbol: string;
  decimals: number;
  chains: Map<string, string>; // CAIP-2 chain ID -> CAIP-19 asset ID
}

/**
 * Well-known cross-chain assets (bridged tokens)
 */
export const CROSS_CHAIN_ASSETS: Map<string, CrossChainAsset> = new Map([
  ['USDC', {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    chains: new Map([
      ['eip155:1', 'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
      ['eip155:8453', 'eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
      ['eip155:137', 'eip155:137/erc20:0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'],
      ['eip155:42161', 'eip155:42161/erc20:0xaf88d065e77c8cC2239327C5EDb3A432268e5831'],
      [`solana:${SOLANA_MAINNET_GENESIS}`, `solana:${SOLANA_MAINNET_GENESIS}/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`],
    ]),
  }],
  ['USDT', {
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 6,
    chains: new Map([
      ['eip155:1', 'eip155:1/erc20:0xdAC17F958D2ee523a2206206994597C13D831ec7'],
      ['eip155:137', 'eip155:137/erc20:0xc2132D05D31c914a87C6611C10748AEb04B58e8F'],
      ['eip155:42161', 'eip155:42161/erc20:0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'],
      [`solana:${SOLANA_MAINNET_GENESIS}`, `solana:${SOLANA_MAINNET_GENESIS}/spl:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`],
    ]),
  }],
]);

/**
 * Find equivalent asset on another chain
 */
export function findEquivalentAsset(
  caip19: string,
  targetChain: string
): string | undefined {
  for (const [, asset] of CROSS_CHAIN_ASSETS) {
    for (const [chain, assetId] of asset.chains) {
      if (assetId === caip19) {
        return asset.chains.get(targetChain);
      }
    }
  }
  return undefined;
}

/**
 * Get all chain addresses for a cross-chain asset
 */
export function getAssetChainMap(symbol: string): Map<string, string> | undefined {
  const asset = CROSS_CHAIN_ASSETS.get(symbol);
  return asset?.chains;
}



