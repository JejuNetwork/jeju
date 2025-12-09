/**
 * Protocol Token Configuration Utility
 * 
 * Loads and manages tokens.json configuration
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface TokenMarketData {
  marketCapUSD?: number;
  volumeUSD24h?: number;
  holders?: number;
  maxSupply?: number;
  circulatingSupply?: number;
}

interface TokenDexPools {
  uniswapV3?: {
    feeTiers: number[];
    primaryPair: string;
  };
}

interface TokenBridgeConfig {
  enabled: boolean;
  minAmount: string;
  estimatedTime: number;
}

interface DeployedContracts {
  vault: string;
  distributor: string;
  paymaster: string;
}

export interface TokenConfig {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  description?: string;
  priceUSD?: number;
  hasPaymaster: boolean;
  bridged?: boolean;
  originChain?: string;
  l1Address?: string;
  logoUrl: string;
  website?: string;
  tags: string[];
  marketData?: TokenMarketData;
  dexPools?: TokenDexPools;
  deployedContracts?: DeployedContracts;
  bridge?: TokenBridgeConfig;
}

interface TokensManifest {
  version: string;
  lastUpdated: string;
  chains: Record<string, { chainId: number; name: string }>;
  tokens: Record<string, TokenConfig>;
  oracle: {
    chainlinkETHUSD: string;
    uniswapV3Factory: string;
    weth: string;
    updateFrequency: number;
    priceDeviationThreshold: number;
  };
  bridge: {
    standardBridge: string;
    crossDomainMessenger: string;
    estimatedConfirmationTime: number;
  };
  lpRewards: {
    description: string;
    feeDistribution: {
      appShare: number;
      lpShare: number;
      ethLPShare: number;
      tokenLPShare: number;
    };
  };
}

let manifestCache: TokensManifest | null = null;

/**
 * Load tokens configuration
 */
export function loadTokensConfig(): TokensManifest {
  if (!manifestCache) {
    const configPath = join(process.cwd(), 'config', 'tokens.json');
    manifestCache = JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  return manifestCache!;
}

/**
 * Get all tokens
 */
export function getAllTokens(): TokenConfig[] {
  const manifest = loadTokensConfig();
  return Object.values(manifest.tokens);
}

/**
 * Get tokens with paymaster support
 */
export function getPaymasterTokens(): TokenConfig[] {
  return getAllTokens().filter(t => t.hasPaymaster);
}

/**
 * Get token by symbol or address
 */
export function getToken(symbolOrAddress: string): TokenConfig | null {
  const manifest = loadTokensConfig();
  
  // Try by symbol (key)
  if (manifest.tokens[symbolOrAddress]) {
    return manifest.tokens[symbolOrAddress];
  }
  
  // Try by symbol (case-insensitive)
  for (const [symbol, token] of Object.entries(manifest.tokens)) {
    if (symbol.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return token;
    }
  }
  
  // Try by address
  for (const token of Object.values(manifest.tokens)) {
    if (token.address.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return token;
    }
  }
  
  return null;
}

/**
 * Get tokens that support bridging
 */
export function getBridgeableTokens(): TokenConfig[] {
  return getAllTokens().filter(t => t.bridge?.enabled);
}

/**
 * Get native Jeju tokens
 */
export function getNativeTokens(): TokenConfig[] {
  return getAllTokens().filter(t => t.isNative);
}

/**
 * Get bridged tokens (from Ethereum)
 */
export function getBridgedTokens(): TokenConfig[] {
  return getAllTokens().filter(t => t.bridged);
}

/**
 * Get oracle configuration
 */
export function getOracleConfig() {
  return loadTokensConfig().oracle;
}

/**
 * Get bridge configuration
 */
export function getBridgeConfig() {
  return loadTokensConfig().bridge;
}

/**
 * Get LP rewards configuration
 */
export function getLPRewardsConfig() {
  return loadTokensConfig().lpRewards;
}

// Backwards compatibility aliases
export const loadProtocolTokens = loadTokensConfig;
export const getAllProtocolTokens = getPaymasterTokens;
export const getProtocolToken = getToken;
export type ProtocolTokenConfig = TokenConfig;

