/**
 * Shared chain configuration for OIF/EIL scripts
 * 
 * Values are loaded from packages/config for consistency.
 * Use getChainConfig() or getRpcUrl() for most cases.
 */

import { getEILChains, getConfig, type NetworkType } from '../../packages/config';

// Compute chain data from config
function buildChainMaps() {
  const rpcs: Record<number, string> = {};
  const names: Record<number, string> = {};
  const testnetIds: number[] = [];
  const mainnetIds: number[] = [];
  
  // Add Jeju chains
  for (const network of ['testnet', 'mainnet'] as NetworkType[]) {
    try {
      const config = getConfig(network);
      const chainId = config.chain.chainId;
      rpcs[chainId] = config.services.rpc.l2;
      names[chainId] = network === 'testnet' ? 'Jeju Testnet' : 'Jeju Mainnet';
      if (network === 'testnet') testnetIds.push(chainId);
      else mainnetIds.push(chainId);
    } catch {
      // Config may not exist
    }
  }
  
  // Add EIL chains
  for (const network of ['testnet', 'mainnet'] as NetworkType[]) {
    try {
      const chains = getEILChains(network);
      for (const chain of Object.values(chains)) {
        rpcs[chain.chainId] = chain.rpcUrl;
        names[chain.chainId] = chain.name;
        if (network === 'testnet') {
          if (!testnetIds.includes(chain.chainId)) testnetIds.push(chain.chainId);
        } else {
          if (!mainnetIds.includes(chain.chainId)) mainnetIds.push(chain.chainId);
        }
      }
    } catch {
      // Config may not exist
    }
  }
  
  return { rpcs, names, testnetIds, mainnetIds };
}

// Build maps on module load
const { rpcs, names, testnetIds, mainnetIds } = buildChainMaps();

// Fallback values for when config isn't available
const FALLBACK_RPCS: Record<number, string> = {
  // Testnets
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  84532: 'https://sepolia.base.org',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  11155420: 'https://sepolia.optimism.io',
  420690: 'https://testnet-rpc.jejunetwork.org',
  97: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
  // Mainnets
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  420691: 'https://rpc.jejunetwork.org',
  56: 'https://bsc-dataseed.bnbchain.org',
};

const FALLBACK_NAMES: Record<number, string> = {
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  421614: 'Arbitrum Sepolia',
  11155420: 'Optimism Sepolia',
  420690: 'Jeju Testnet',
  97: 'BSC Testnet',
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum One',
  10: 'OP Mainnet',
  420691: 'Jeju Mainnet',
  56: 'BNB Chain',
};

/**
 * Public RPC URLs by chain ID
 * Prefer using getRpcUrl() which also checks env overrides
 */
export const PUBLIC_RPCS: Record<number, string> = { ...FALLBACK_RPCS, ...rpcs };

/**
 * Chain names by chain ID
 */
export const CHAIN_NAMES: Record<number, string> = { ...FALLBACK_NAMES, ...names };

/**
 * Testnet chain IDs
 */
export const TESTNET_CHAIN_IDS = testnetIds.length > 0 
  ? testnetIds 
  : [11155111, 84532, 421614, 11155420, 420690, 97];

/**
 * Mainnet chain IDs
 */
export const MAINNET_CHAIN_IDS = mainnetIds.length > 0
  ? mainnetIds
  : [1, 8453, 42161, 10, 420691, 56];

/**
 * Get chain IDs for a network type
 */
export function getChainIds(network: 'testnet' | 'mainnet'): number[] {
  return network === 'testnet' ? TESTNET_CHAIN_IDS : MAINNET_CHAIN_IDS;
}

/**
 * Get chain name
 */
export function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`;
}

/**
 * Get RPC URL with env override support
 */
export function rpcUrl(chainId: number): string {
  // Check env override first
  const envKey = `CHAIN_${chainId}_RPC_URL`;
  if (process.env[envKey]) return process.env[envKey]!;
  
  // Check chain-specific env vars
  const chainEnvMap: Record<number, string> = {
    11155111: 'SEPOLIA_RPC_URL',
    84532: 'BASE_SEPOLIA_RPC_URL',
    421614: 'ARBITRUM_SEPOLIA_RPC_URL',
    11155420: 'OPTIMISM_SEPOLIA_RPC_URL',
    97: 'BSC_TESTNET_RPC_URL',
    420690: 'JEJU_TESTNET_RPC_URL',
    1: 'ETHEREUM_RPC_URL',
    8453: 'BASE_RPC_URL',
    42161: 'ARBITRUM_RPC_URL',
    10: 'OPTIMISM_RPC_URL',
    56: 'BSC_RPC_URL',
    420691: 'JEJU_RPC_URL',
  };
  
  const specificEnv = chainEnvMap[chainId];
  if (specificEnv && process.env[specificEnv]) {
    return process.env[specificEnv]!;
  }
  
  // Use config/fallback
  const url = PUBLIC_RPCS[chainId];
  if (!url) throw new Error(`No RPC URL for chain ${chainId}`);
  return url;
}

/**
 * Check if chain ID is a testnet
 */
export function isTestnet(chainId: number): boolean {
  return TESTNET_CHAIN_IDS.includes(chainId);
}

/**
 * Check if chain ID is a mainnet
 */
export function isMainnet(chainId: number): boolean {
  return MAINNET_CHAIN_IDS.includes(chainId);
}

/**
 * Get explorer URL for chain
 */
export function explorerUrl(chainId: number): string {
  const explorers: Record<number, string> = {
    11155111: 'https://sepolia.etherscan.io',
    84532: 'https://sepolia.basescan.org',
    421614: 'https://sepolia.arbiscan.io',
    11155420: 'https://sepolia-optimism.etherscan.io',
    420690: 'https://testnet-explorer.jejunetwork.org',
    97: 'https://testnet.bscscan.com',
    1: 'https://etherscan.io',
    8453: 'https://basescan.org',
    42161: 'https://arbiscan.io',
    10: 'https://optimistic.etherscan.io',
    420691: 'https://explorer.jejunetwork.org',
    56: 'https://bscscan.com',
  };
  return explorers[chainId] || '';
}
