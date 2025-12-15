/**
 * BBLN Token Deployment Configuration
 *
 * This file defines the deployment configuration for the BBLN token
 * across all supported chains, including home chain (Ethereum/Sepolia)
 * and synthetic copies on other EVM chains and Solana.
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
  avalanche,
  bsc,
  solanaMainnet,
  solanaDevnet,
  jejuTestnet,
} from './chains';
import {
  TOKEN_NAME,
  TOKEN_SYMBOL,
  TOKEN_DECIMALS,
  TOTAL_SUPPLY_WEI,
  BABYLON_LABS_TOKENS,
  PUBLIC_SALE_TOKENS,
  AIRDROP_TOKENS,
  LIQUIDITY_TOKENS,
  TREASURY_TOKENS,
  tokensToWei,
} from './tokenomics';

// =============================================================================
// DEPLOYMENT ADDRESSES (populated after deployment)
// =============================================================================

export interface BBLNDeploymentAddresses {
  // Core token contracts
  token: string;
  presale: string;

  // Allocation wallets
  babylonLabsWallet: string;
  treasuryWallet: string;
  liquidityWallet: string;
  airdropContract: string;

  // Infrastructure
  feeConfig: string;
  banManager: string;
  xlpRewardPool: string;

  // Cross-chain
  hyperlaneMailbox: string;
  hyperlaneIgp: string;
  warpRouter?: string;
}

export interface BBLNDeployment {
  chainId: number | string;
  chainName: string;
  isHomeChain: boolean;
  addresses: BBLNDeploymentAddresses | null;
  deployedAt?: number;
  deployTxHash?: string;
}

// =============================================================================
// TESTNET CONFIGURATION
// =============================================================================

export const BBLN_TESTNET_CONFIG = {
  homeChain: sepolia,
  syntheticChains: [baseSepolia, arbitrumSepolia, jejuTestnet, solanaDevnet],

  // Presale configuration (testnet values)
  presale: {
    totalTokensForSale: tokensToWei(PUBLIC_SALE_TOKENS), // 100M BBLN
    startPrice: BigInt('100000000000000'), // 0.0001 ETH per BBLN
    reservePrice: BigInt('10000000000000'), // 0.00001 ETH per BBLN
    priceDecayRate: BigInt('1000000000'), // Price decay per block
    earlyBirdDuration: 24 * 60 * 60, // 24 hours
    publicDuration: 7 * 24 * 60 * 60, // 7 days
    minBidAmount: BigInt('10000000000000000'), // 0.01 ETH
    maxBidAmount: BigInt('100000000000000000000'), // 100 ETH
  },

  // Initial distribution addresses (testnet)
  distribution: {
    babylonLabsWallet: '', // Set before deployment
    treasuryWallet: '', // Set before deployment
    liquidityWallet: '', // Set before deployment
    airdropContract: '', // Set before deployment
  },
};

// =============================================================================
// MAINNET CONFIGURATION
// =============================================================================

export const BBLN_MAINNET_CONFIG = {
  homeChain: ethereumMainnet,
  syntheticChains: [base, arbitrum, optimism, polygon, avalanche, bsc, solanaMainnet],

  // Presale configuration (mainnet values)
  presale: {
    totalTokensForSale: tokensToWei(PUBLIC_SALE_TOKENS), // 100M BBLN
    startPrice: BigInt('1000000000000000'), // 0.001 ETH per BBLN ($3 at $3000 ETH)
    reservePrice: BigInt('100000000000000'), // 0.0001 ETH per BBLN ($0.30)
    priceDecayRate: BigInt('100000000'), // Price decay per block
    earlyBirdDuration: 48 * 60 * 60, // 48 hours
    publicDuration: 14 * 24 * 60 * 60, // 14 days
    minBidAmount: BigInt('100000000000000000'), // 0.1 ETH
    maxBidAmount: BigInt('1000000000000000000000'), // 1000 ETH
  },

  // Initial distribution addresses (mainnet)
  distribution: {
    babylonLabsWallet: '', // Set before deployment
    treasuryWallet: '', // Set before deployment
    liquidityWallet: '', // Set before deployment
    airdropContract: '', // Set before deployment
  },
};

// =============================================================================
// HYPERLANE DOMAIN IDS
// =============================================================================

export const HYPERLANE_DOMAINS = {
  // Mainnet domains
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
  solana: 1399811149, // Solana's Hyperlane domain ID

  // Testnet domains
  sepolia: 11155111,
  baseSepolia: 84532,
  arbitrumSepolia: 421614,
  jejuTestnet: 420690,
  solanaDevnet: 1399811150,
} as const;

// =============================================================================
// FEE CONFIGURATION
// =============================================================================

export const BBLN_FEE_CONFIG = {
  // XLP reward distribution (80% of bridge fees to LPs)
  xlpRewardShareBps: 8000,

  // Protocol treasury share (10% of bridge fees)
  protocolShareBps: 1000,

  // Deflationary burn (10% of bridge fees)
  burnShareBps: 1000,

  // No transfer fee on normal transfers
  transferFeeBps: 0,

  // Bridge fee bounds
  bridgeFeeMinBps: 5, // 0.05% minimum
  bridgeFeeMaxBps: 100, // 1% maximum

  // XLP minimum stake requirement
  xlpMinStakeBps: 1000, // 10% of transfer amount

  // ZK proof discount
  zkProofDiscountBps: 2000, // 20% discount for ZK-verified transfers
};

// =============================================================================
// WARP ROUTE CONFIGURATION
// =============================================================================

export interface WarpRouteConfig {
  homeChainDomain: number;
  homeChainToken: string;
  routes: Array<{
    domain: number;
    chainName: string;
    routerAddress: string;
    tokenAddress: string;
    isNative: boolean;
  }>;
}

export function generateWarpRouteConfig(
  homeToken: string,
  deployments: Map<number | string, BBLNDeployment>
): WarpRouteConfig {
  const routes = [];

  for (const [chainId, deployment] of deployments) {
    if (deployment.isHomeChain || !deployment.addresses?.warpRouter) continue;

    routes.push({
      domain: typeof chainId === 'number' ? chainId : HYPERLANE_DOMAINS[chainId as keyof typeof HYPERLANE_DOMAINS],
      chainName: deployment.chainName,
      routerAddress: deployment.addresses.warpRouter,
      tokenAddress: deployment.addresses.token,
      isNative: false,
    });
  }

  return {
    homeChainDomain: HYPERLANE_DOMAINS.ethereum, // or sepolia for testnet
    homeChainToken: homeToken,
    routes,
  };
}

// =============================================================================
// DEPLOYMENT STATE TRACKING
// =============================================================================

export const BBLN_TESTNET_DEPLOYMENTS: Map<number | string, BBLNDeployment> = new Map();
export const BBLN_MAINNET_DEPLOYMENTS: Map<number | string, BBLNDeployment> = new Map();

/**
 * Get deployment for a specific chain
 */
export function getDeployment(
  chainId: number | string,
  isMainnet: boolean
): BBLNDeployment | undefined {
  const deployments = isMainnet ? BBLN_MAINNET_DEPLOYMENTS : BBLN_TESTNET_DEPLOYMENTS;
  return deployments.get(chainId);
}

/**
 * Check if a chain has been deployed
 */
export function isDeployed(chainId: number | string, isMainnet: boolean): boolean {
  const deployment = getDeployment(chainId, isMainnet);
  return deployment?.addresses !== null;
}

/**
 * Get all deployed chain IDs
 */
export function getDeployedChains(isMainnet: boolean): (number | string)[] {
  const deployments = isMainnet ? BBLN_MAINNET_DEPLOYMENTS : BBLN_TESTNET_DEPLOYMENTS;
  return Array.from(deployments.entries())
    .filter(([, d]) => d.addresses !== null)
    .map(([chainId]) => chainId);
}

// =============================================================================
// DEPLOYMENT HELPERS
// =============================================================================

export interface DeploymentParams {
  deployer: string;
  network: 'testnet' | 'mainnet';
  chainId: number | string;
  feeConfig?: string;
  banManager?: string;
}

export function getDeploymentConfig(network: 'testnet' | 'mainnet') {
  return network === 'mainnet' ? BBLN_MAINNET_CONFIG : BBLN_TESTNET_CONFIG;
}

export function getChainConfigForDeployment(
  chainId: number | string,
  network: 'testnet' | 'mainnet'
): ChainConfig | undefined {
  const config = getDeploymentConfig(network);

  if (config.homeChain.chainId === chainId) {
    return config.homeChain;
  }

  return config.syntheticChains.find((c) => c.chainId === chainId);
}

// =============================================================================
// TOKEN METADATA
// =============================================================================

export const BBLN_TOKEN_METADATA = {
  name: TOKEN_NAME,
  symbol: TOKEN_SYMBOL,
  decimals: TOKEN_DECIMALS,
  totalSupply: TOTAL_SUPPLY_WEI,

  // Allocation amounts in wei
  allocations: {
    babylonLabs: tokensToWei(BABYLON_LABS_TOKENS),
    publicSale: tokensToWei(PUBLIC_SALE_TOKENS),
    airdrop: tokensToWei(AIRDROP_TOKENS),
    liquidity: tokensToWei(LIQUIDITY_TOKENS),
    treasury: tokensToWei(TREASURY_TOKENS),
  },

  // Token URI for metadata
  tokenURI: 'ipfs://Qm...', // To be set after IPFS upload

  // Social links
  website: 'https://babylon.network',
  twitter: 'https://twitter.com/babylonnetwork',
  discord: 'https://discord.gg/babylon',
  docs: 'https://docs.babylon.network',
};
