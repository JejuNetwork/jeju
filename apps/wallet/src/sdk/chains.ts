/**
 * @fileoverview Chain configuration for network Wallet
 * Supports Ethereum L1, major L2s, and prepares for Solana
 */

import type { Address } from 'viem';
import type { ChainConfig, SolanaConfig } from './types';
import { getLocalnetChain, getTestnetChain, getNetworkName, getBrandingRpcUrl } from '../config/branding';

const networkName = getNetworkName();

// ============================================================================
// EVM Chain Configurations
// ============================================================================

export const chains: Record<number, ChainConfig> = {
  // Ethereum Mainnet
  1: {
    id: 1,
    name: 'Ethereum',
    network: 'mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://eth.llamarpc.com'] },
      jeju: { http: ['https://rpc.jeju.network/eth'] },
    },
    blockExplorers: {
      default: { name: 'Etherscan', url: 'https://etherscan.io' },
    },
    eilSupported: true,
    oifSupported: true,
  },

  // Base
  8453: {
    id: 8453,
    name: 'Base',
    network: 'base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://mainnet.base.org'] },
      jeju: { http: ['https://rpc.jeju.network/base'] },
    },
    blockExplorers: {
      default: { name: 'BaseScan', url: 'https://basescan.org' },
    },
    eilSupported: true,
    oifSupported: true,
  },

  // Arbitrum One
  42161: {
    id: 42161,
    name: 'Arbitrum One',
    network: 'arbitrum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://arb1.arbitrum.io/rpc'] },
      jeju: { http: ['https://rpc.jeju.network/arbitrum'] },
    },
    blockExplorers: {
      default: { name: 'Arbiscan', url: 'https://arbiscan.io' },
    },
    eilSupported: true,
    oifSupported: true,
  },

  // Optimism
  10: {
    id: 10,
    name: 'Optimism',
    network: 'optimism',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://mainnet.optimism.io'] },
      jeju: { http: ['https://rpc.jeju.network/optimism'] },
    },
    blockExplorers: {
      default: { name: 'Optimism Explorer', url: 'https://optimistic.etherscan.io' },
    },
    eilSupported: true,
    oifSupported: true,
  },

  // Polygon
  137: {
    id: 137,
    name: 'Polygon',
    network: 'polygon',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://polygon-rpc.com'] },
      jeju: { http: ['https://rpc.jeju.network/polygon'] },
    },
    blockExplorers: {
      default: { name: 'PolygonScan', url: 'https://polygonscan.com' },
    },
    eilSupported: true,
    oifSupported: true,
  },

  // Scroll
  534352: {
    id: 534352,
    name: 'Scroll',
    network: 'scroll',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://rpc.scroll.io'] },
      jeju: { http: ['https://rpc.jeju.network/scroll'] },
    },
    blockExplorers: {
      default: { name: 'Scrollscan', url: 'https://scrollscan.com' },
    },
    eilSupported: true,
    oifSupported: true,
  },

  // zkSync Era
  324: {
    id: 324,
    name: 'zkSync Era',
    network: 'zksync',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://mainnet.era.zksync.io'] },
      jeju: { http: ['https://rpc.jeju.network/zksync'] },
    },
    blockExplorers: {
      default: { name: 'zkSync Explorer', url: 'https://explorer.zksync.io' },
    },
    eilSupported: true,
    oifSupported: true,
  },

  // Base Sepolia (Testnet)
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    network: 'base-sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://sepolia.base.org'] },
      jeju: { http: ['https://rpc.jeju.network/base-sepolia'] },
    },
    blockExplorers: {
      default: { name: 'BaseScan Sepolia', url: 'https://sepolia.basescan.org' },
    },
    testnet: true,
    eilSupported: true,
    oifSupported: true,
  },

  // Network Localnet
  1337: {
    id: 1337,
    name: `${networkName} Localnet`,
    network: 'localnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: ['http://localhost:8545'] },
      jeju: { http: ['http://localhost:8545'] },
    },
    blockExplorers: {
      default: { name: 'Local', url: 'http://localhost:8545' },
    },
    testnet: true,
    eilSupported: true,
    oifSupported: true,
  },

  // Network L2 (future)
  420691: {
    id: 420691,
    name: `${networkName} L2`,
    network: 'jeju-l2',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [getBrandingRpcUrl(420691)] },
      jeju: { http: ['https://l2.jeju.network/rpc'] },
    },
    blockExplorers: {
      default: { name: 'Network Explorer', url: 'https://explorer.jeju.network' },
    },
    eilSupported: true,
    oifSupported: true,
  },
};

// ============================================================================
// Solana Configurations
// ============================================================================

export const solanaConfigs: Record<string, SolanaConfig> = {
  'mainnet-beta': {
    name: 'Solana Mainnet',
    cluster: 'mainnet-beta',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    wsUrl: 'wss://api.mainnet-beta.solana.com',
  },
  devnet: {
    name: 'Solana Devnet',
    cluster: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    wsUrl: 'wss://api.devnet.solana.com',
  },
  testnet: {
    name: 'Solana Testnet',
    cluster: 'testnet',
    rpcUrl: 'https://api.testnet.solana.com',
    wsUrl: 'wss://api.testnet.solana.com',
  },
};

// ============================================================================
// Chain Utilities
// ============================================================================

export function getChain(chainId: number): ChainConfig | undefined {
  return chains[chainId];
}

export function isEILSupported(chainId: number): boolean {
  return chains[chainId]?.eilSupported ?? false;
}

export function isOIFSupported(chainId: number): boolean {
  return chains[chainId]?.oifSupported ?? false;
}

export function getMainnetChains(): ChainConfig[] {
  return Object.values(chains).filter((c) => !c.testnet);
}

export function getTestnetChains(): ChainConfig[] {
  return Object.values(chains).filter((c) => c.testnet);
}

export function getNetworkRpcUrl(chainId: number): string | undefined {
  const chain = chains[chainId];
  return chain?.rpcUrls.jeju?.http[0] ?? chain?.rpcUrls.default.http[0];
}

// ============================================================================
// Contract Addresses by Chain
// ============================================================================

export interface ChainContracts {
  // Core ERC-4337
  entryPoint?: Address;
  // Cross-chain (EIL + OIF)
  crossChainPaymaster?: Address;
  inputSettler?: Address;
  outputSettler?: Address;
  solverRegistry?: Address;
  simpleOracle?: Address;
  // Infrastructure
  priceOracle?: Address;
  tokenRegistry?: Address;
  identityRegistry?: Address;
  // DeFi
  xlpV2Factory?: Address;
  xlpV3Factory?: Address;
  swapRouter?: Address;
  positionManager?: Address;
  liquidityAggregator?: Address;
  // Perps
  perpetualMarket?: Address;
  marginManager?: Address;
  insuranceFund?: Address;
  liquidationEngine?: Address;
  // Launchpad
  tokenLaunchpad?: Address;
  bondingCurve?: Address;
  // Marketplace
  bazaar?: Address;
  // Names
  jnsRegistry?: Address;
  jnsRegistrar?: Address;
  jnsResolver?: Address;
  jnsReverseRegistrar?: Address;
  // Tokens
  usdc?: Address;
  weth?: Address;
  jeju?: Address;
}

/**
 * Contract addresses by chain.
 * Populated from packages/contracts/deployments/addresses.json
 */
export const chainContracts: Record<number, ChainContracts> = {
  // Base Sepolia Testnet - DEPLOYED
  84532: {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
    // OIF contracts - DEPLOYED
    inputSettler: '0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75' as Address,
    outputSettler: '0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5' as Address,
    solverRegistry: '0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de' as Address,
    simpleOracle: '0xE30218678a940d1553b285B0eB5C5364BBF70ed9' as Address,
    // Identity - DEPLOYED
    identityRegistry: '0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd' as Address,
    // Tokens - DEPLOYED
    usdc: '0x953F6516E5d2864cE7f13186B45dE418EA665EB2' as Address,
  },
  // Localnet - requires local deployment
  1337: {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
  },
  // Network L2 Testnet
  420690: {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
  },
  // Network L2 Mainnet
  420691: {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
  },
  // Base Mainnet
  8453: {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
  },
  // Ethereum Mainnet
  1: {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  },
  // Arbitrum
  42161: {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
  },
  // Optimism
  10: {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as Address,
  },
};

export function getChainContracts(chainId: number): ChainContracts {
  return chainContracts[chainId] ?? {};
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CHAINS = [1, 8453, 42161, 10, 137] as const;
export const DEFAULT_TESTNETS = [84532, 1337] as const;

export const POPULAR_TOKENS: Record<number, Address[]> = {
  1: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address, // USDT
    '0x6B175474E89094C44Da98b954EescdeCB5F6c6bB' as Address, // DAI
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
  ],
  8453: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, // USDC
    '0x4200000000000000000000000000000000000006' as Address, // WETH
  ],
  42161: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address, // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address, // USDT
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address, // WETH
  ],
};

