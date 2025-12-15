/**
 * JEJU Token Deployment Configuration
 *
 * This file defines the deployment configuration for the JEJU token,
 * the native token of the Jeju Network. JEJU is deployed on Jeju's L2
 * as the home chain, with synthetic copies on other EVM chains and Solana.
 */

import type { ChainConfig } from '../types';
import {
  ethereumMainnet,
  sepolia,
  base,
  baseSepolia,
  arbitrum,
  arbitrumSepolia,
  optimism,
  polygon,
  solanaMainnet,
  solanaDevnet,
  jejuTestnet,
} from './chains';

// =============================================================================
// TOKEN CONSTANTS
// =============================================================================

export const JEJU_TOKEN_NAME = 'Jeju';
export const JEJU_TOKEN_SYMBOL = 'JEJU';
export const JEJU_TOKEN_DECIMALS = 18;
export const JEJU_MAX_SUPPLY = 10_000_000_000n; // 10 billion max
export const JEJU_INITIAL_SUPPLY = 1_000_000_000n; // 1 billion initial
export const JEJU_MAX_SUPPLY_WEI = JEJU_MAX_SUPPLY * 10n ** 18n;
export const JEJU_INITIAL_SUPPLY_WEI = JEJU_INITIAL_SUPPLY * 10n ** 18n;

// Faucet configuration (testnet only)
export const JEJU_FAUCET_AMOUNT = 100n * 10n ** 18n; // 100 JEJU per drip
export const JEJU_FAUCET_COOLDOWN = 24 * 60 * 60; // 24 hours

// =============================================================================
// DEPLOYMENT ADDRESSES
// =============================================================================

export interface JEJUDeploymentAddresses {
  token: string;
  banManager: string;
  feeConfig: string;
  xlpRewardPool: string;
  hyperlaneMailbox: string;
  hyperlaneIgp: string;
  warpRouter?: string;
}

export interface JEJUDeployment {
  chainId: number | string;
  chainName: string;
  isHomeChain: boolean;
  addresses: JEJUDeploymentAddresses | null;
  deployedAt?: number;
  deployTxHash?: string;
}

// =============================================================================
// LOCALNET CONFIGURATION
// =============================================================================

export const JEJU_LOCALNET_CONFIG = {
  homeChain: {
    chainId: 1337,
    chainType: 'evm' as const,
    name: 'Anvil Localnet',
    rpcUrl: 'http://localhost:8545',
    blockExplorerUrl: '',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    hyperlaneMailbox: '',
    hyperlaneIgp: '',
    isHomeChain: true,
    avgBlockTime: 2,
  },
  syntheticChains: [],

  // Default deployment addresses (populated by deploy script)
  addresses: {
    token: '0x0000000000000000000000000000000000000000',
    banManager: '0x0000000000000000000000000000000000000000',
    feeConfig: '0x0000000000000000000000000000000000000000',
    xlpRewardPool: '0x0000000000000000000000000000000000000000',
    hyperlaneMailbox: '0x0000000000000000000000000000000000000000',
    hyperlaneIgp: '0x0000000000000000000000000000000000000000',
  },
};

// =============================================================================
// TESTNET CONFIGURATION
// =============================================================================

export const JEJU_TESTNET_CONFIG = {
  homeChain: jejuTestnet,
  syntheticChains: [sepolia, baseSepolia, arbitrumSepolia, solanaDevnet],

  // Fee configuration (testnet can use lower fees)
  fees: {
    xlpRewardShareBps: 8000, // 80% to LPs
    protocolShareBps: 1000, // 10% to protocol
    burnShareBps: 1000, // 10% burned
    bridgeFeeMinBps: 5, // 0.05%
    bridgeFeeMaxBps: 100, // 1%
    zkProofDiscountBps: 2000, // 20% discount
  },

  // Initial distribution (testnet)
  distribution: {
    treasuryWallet: '', // Set before deployment
    liquidityWallet: '', // Set before deployment
    devFundWallet: '', // Set before deployment
  },
};

// =============================================================================
// MAINNET CONFIGURATION
// =============================================================================

// Note: JEJU mainnet deployment pending Jeju Network launch
export const JEJU_MAINNET_CONFIG = {
  // Home chain is Jeju L2 (mainnet)
  homeChain: {
    chainId: 420691, // Jeju Mainnet chain ID (TBD)
    chainType: 'evm' as const,
    name: 'Jeju Network',
    rpcUrl: process.env.JEJU_MAINNET_RPC_URL ?? 'https://rpc.jeju.network',
    blockExplorerUrl: 'https://explorer.jeju.network',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    hyperlaneMailbox: '', // Set after Hyperlane deployment
    hyperlaneIgp: '', // Set after Hyperlane deployment
    isHomeChain: true,
    avgBlockTime: 2,
  },
  syntheticChains: [ethereumMainnet, base, arbitrum, optimism, polygon, solanaMainnet],

  // Fee configuration (mainnet)
  fees: {
    xlpRewardShareBps: 8000, // 80% to LPs
    protocolShareBps: 1000, // 10% to protocol
    burnShareBps: 1000, // 10% burned
    bridgeFeeMinBps: 5, // 0.05%
    bridgeFeeMaxBps: 100, // 1%
    zkProofDiscountBps: 2000, // 20% discount
  },

  // Initial distribution (mainnet)
  distribution: {
    treasuryWallet: '', // Set before deployment
    liquidityWallet: '', // Set before deployment
    devFundWallet: '', // Set before deployment
  },
};

// =============================================================================
// DEPLOYMENT STATE TRACKING
// =============================================================================

export const JEJU_LOCALNET_DEPLOYMENTS: Map<number | string, JEJUDeployment> = new Map();
export const JEJU_TESTNET_DEPLOYMENTS: Map<number | string, JEJUDeployment> = new Map();
export const JEJU_MAINNET_DEPLOYMENTS: Map<number | string, JEJUDeployment> = new Map();

/**
 * Get deployment for a specific chain
 */
export function getJEJUDeployment(
  chainId: number | string,
  network: 'localnet' | 'testnet' | 'mainnet'
): JEJUDeployment | undefined {
  const deployments = network === 'mainnet'
    ? JEJU_MAINNET_DEPLOYMENTS
    : network === 'testnet'
    ? JEJU_TESTNET_DEPLOYMENTS
    : JEJU_LOCALNET_DEPLOYMENTS;
  return deployments.get(chainId);
}

/**
 * Check if a chain has been deployed
 */
export function isJEJUDeployed(
  chainId: number | string,
  network: 'localnet' | 'testnet' | 'mainnet'
): boolean {
  const deployment = getJEJUDeployment(chainId, network);
  return deployment?.addresses !== null;
}

/**
 * Get all deployed chain IDs
 */
export function getJEJUDeployedChains(
  network: 'localnet' | 'testnet' | 'mainnet'
): (number | string)[] {
  const deployments = network === 'mainnet'
    ? JEJU_MAINNET_DEPLOYMENTS
    : network === 'testnet'
    ? JEJU_TESTNET_DEPLOYMENTS
    : JEJU_LOCALNET_DEPLOYMENTS;
  return Array.from(deployments.entries())
    .filter(([, d]) => d.addresses !== null)
    .map(([chainId]) => chainId);
}

// =============================================================================
// DEPLOYMENT HELPERS
// =============================================================================

export function getJEJUDeploymentConfig(network: 'localnet' | 'testnet' | 'mainnet') {
  if (network === 'mainnet') return JEJU_MAINNET_CONFIG;
  if (network === 'testnet') return JEJU_TESTNET_CONFIG;
  return JEJU_LOCALNET_CONFIG;
}

export function getJEJUChainConfig(
  chainId: number | string,
  network: 'localnet' | 'testnet' | 'mainnet'
): ChainConfig | undefined {
  const config = getJEJUDeploymentConfig(network);

  if (config.homeChain.chainId === chainId) {
    return config.homeChain as ChainConfig;
  }

  return config.syntheticChains.find((c) => c.chainId === chainId);
}

// =============================================================================
// TOKEN METADATA
// =============================================================================

export const JEJU_TOKEN_METADATA = {
  name: JEJU_TOKEN_NAME,
  symbol: JEJU_TOKEN_SYMBOL,
  decimals: JEJU_TOKEN_DECIMALS,
  maxSupply: JEJU_MAX_SUPPLY_WEI,
  initialSupply: JEJU_INITIAL_SUPPLY_WEI,

  // Description
  description: 'The native token of the Jeju Network - an EVM chain for agents and humans.',

  // Social links
  website: 'https://jeju.network',
  docs: 'https://docs.jeju.network',
  github: 'https://github.com/jeju-network',
};
