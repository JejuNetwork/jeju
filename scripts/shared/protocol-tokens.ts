/**
 * Protocol Token Configuration Utility
 * 
 * Loads and manages protocol-tokens.json configuration
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface ProtocolTokenConfig {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  isNative: boolean;
  description: string;
  priceUSD: number;
  hasPaymaster: boolean;
  bridged: boolean;
  originChain: string;
  baseAddress?: string;
  logoUrl: string;
  website?: string;
  tags: string[];
  deployedContracts: {
    vault: string;
    distributor: string;
    paymaster: string;
  };
  bridge?: {
    enabled: boolean;
    minAmount: string;
    estimatedTime: number;
  };
}

interface ProtocolTokensManifest {
  version: string;
  description: string;
  lastUpdated: string;
  tokens: ProtocolTokenConfig[];
  eligibility: {
    description: string;
    requirements: string[];
  };
  lpRewards: {
    description: string;
    feeDistribution: {
      appShare: number;
      lpShare: number;
      ethLPShare: number;
      tokenLPShare: number;
    };
    example: Record<string, string>;
  };
}

let manifestCache: ProtocolTokensManifest | null = null;

/**
 * Load protocol tokens configuration
 */
export function loadProtocolTokens(): ProtocolTokensManifest {
  if (!manifestCache) {
    const configPath = join(process.cwd(), 'config', 'protocol-tokens.json');
    manifestCache = JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  return manifestCache!;
}

/**
 * Get all protocol tokens
 */
export function getAllProtocolTokens(): ProtocolTokenConfig[] {
  const manifest = loadProtocolTokens();
  return manifest.tokens;
}

/**
 * Get protocol token by symbol
 */
export function getProtocolToken(symbolOrAddress: string): ProtocolTokenConfig | null {
  const tokens = getAllProtocolTokens();
  
  // Try by symbol
  for (const token of tokens) {
    if (token.symbol.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return token;
    }
  }
  
  // Try by address
  for (const token of tokens) {
    if (token.address.toLowerCase() === symbolOrAddress.toLowerCase()) {
      return token;
    }
  }
  
  return null;
}

/**
 * Get tokens that support bridging
 */
export function getBridgeableTokens(): ProtocolTokenConfig[] {
  return getAllProtocolTokens().filter(t => t.bridge?.enabled);
}

/**
 * Get native Jeju tokens
 */
export function getNativeTokens(): ProtocolTokenConfig[] {
  return getAllProtocolTokens().filter(t => t.isNative);
}

/**
 * Get bridged tokens (from Base)
 */
export function getBridgedTokens(): ProtocolTokenConfig[] {
  return getAllProtocolTokens().filter(t => t.bridged);
}

/**
 * Update deployed contract addresses
 */
export function updateDeployedAddresses(
  symbol: string,
  vault: string,
  distributor: string,
  paymaster: string
): void {
  const token = getProtocolToken(symbol);
  if (token) {
    token.deployedContracts = { vault, distributor, paymaster };
  }
}

export type { ProtocolTokenConfig, ProtocolTokensManifest };

