/**
 * Chain Configuration for RPC Gateway
 * Defines all supported chains with RPC endpoints
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;
  fallbackRpcs: string[];
  explorerUrl: string;
  isTestnet: boolean;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

// Primary Jeju-hosted RPC URLs
const JEJU_RPC_BASE = process.env.JEJU_RPC_BASE || 'https://rpc.jeju.network';

export const CHAINS: Record<number, ChainConfig> = {
  // Jeju Networks
  420691: {
    chainId: 420691,
    name: 'Jeju',
    shortName: 'JEJU',
    rpcUrl: process.env.JEJU_RPC_URL || `${JEJU_RPC_BASE}/jeju`,
    fallbackRpcs: [],
    explorerUrl: 'https://explorer.jeju.network',
    isTestnet: false,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  420690: {
    chainId: 420690,
    name: 'Jeju Testnet',
    shortName: 'JEJU-TEST',
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL || `${JEJU_RPC_BASE}/jeju-testnet`,
    fallbackRpcs: [],
    explorerUrl: 'https://testnet-explorer.jeju.network',
    isTestnet: true,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },

  // Ethereum
  1: {
    chainId: 1,
    name: 'Ethereum',
    shortName: 'ETH',
    rpcUrl: process.env.ETHEREUM_RPC_URL || `${JEJU_RPC_BASE}/ethereum`,
    fallbackRpcs: [
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
    ],
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  11155111: {
    chainId: 11155111,
    name: 'Sepolia',
    shortName: 'SEP',
    rpcUrl: process.env.SEPOLIA_RPC_URL || `${JEJU_RPC_BASE}/sepolia`,
    fallbackRpcs: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc.sepolia.org',
    ],
    explorerUrl: 'https://sepolia.etherscan.io',
    isTestnet: true,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },

  // Base
  8453: {
    chainId: 8453,
    name: 'Base',
    shortName: 'BASE',
    rpcUrl: process.env.BASE_RPC_URL || `${JEJU_RPC_BASE}/base`,
    fallbackRpcs: [
      'https://mainnet.base.org',
      'https://base.llamarpc.com',
    ],
    explorerUrl: 'https://basescan.org',
    isTestnet: false,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  84532: {
    chainId: 84532,
    name: 'Base Sepolia',
    shortName: 'BASE-SEP',
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || `${JEJU_RPC_BASE}/base-sepolia`,
    fallbackRpcs: [
      'https://sepolia.base.org',
    ],
    explorerUrl: 'https://sepolia.basescan.org',
    isTestnet: true,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },

  // Arbitrum
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'ARB',
    rpcUrl: process.env.ARBITRUM_RPC_URL || `${JEJU_RPC_BASE}/arbitrum`,
    fallbackRpcs: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum.llamarpc.com',
    ],
    explorerUrl: 'https://arbiscan.io',
    isTestnet: false,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  421614: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'ARB-SEP',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || `${JEJU_RPC_BASE}/arbitrum-sepolia`,
    fallbackRpcs: [
      'https://sepolia-rollup.arbitrum.io/rpc',
    ],
    explorerUrl: 'https://sepolia.arbiscan.io',
    isTestnet: true,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },

  // Optimism
  10: {
    chainId: 10,
    name: 'Optimism',
    shortName: 'OP',
    rpcUrl: process.env.OPTIMISM_RPC_URL || `${JEJU_RPC_BASE}/optimism`,
    fallbackRpcs: [
      'https://mainnet.optimism.io',
      'https://optimism.llamarpc.com',
    ],
    explorerUrl: 'https://optimistic.etherscan.io',
    isTestnet: false,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  11155420: {
    chainId: 11155420,
    name: 'Optimism Sepolia',
    shortName: 'OP-SEP',
    rpcUrl: process.env.OPTIMISM_SEPOLIA_RPC_URL || `${JEJU_RPC_BASE}/optimism-sepolia`,
    fallbackRpcs: [
      'https://sepolia.optimism.io',
    ],
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    isTestnet: true,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },

  // Localnet
  1337: {
    chainId: 1337,
    name: 'Localnet',
    shortName: 'LOCAL',
    rpcUrl: process.env.LOCALNET_RPC_URL || 'http://localhost:9545',
    fallbackRpcs: [],
    explorerUrl: 'http://localhost:4000',
    isTestnet: true,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

export const SUPPORTED_CHAIN_IDS = Object.keys(CHAINS).map(Number);

export function getChain(chainId: number): ChainConfig {
  const chain = CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  return chain;
}

export function isChainSupported(chainId: number): boolean {
  return chainId in CHAINS;
}

export function getMainnetChains(): ChainConfig[] {
  return Object.values(CHAINS).filter(c => !c.isTestnet);
}

export function getTestnetChains(): ChainConfig[] {
  return Object.values(CHAINS).filter(c => c.isTestnet);
}
