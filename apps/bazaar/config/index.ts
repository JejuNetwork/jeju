/**
 * Bazaar App Configuration
 * 
 * Config-first architecture:
 * - Defaults based on network
 * - NEXT_PUBLIC_* env vars override at build time
 * 
 * Note: This file centralizes env var access and provides type-safe defaults.
 * Import from here instead of using process.env.NEXT_PUBLIC_* directly.
 */
import type { Address } from 'viem';

// Build-time network selection
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || 'localnet') as 'localnet' | 'testnet' | 'mainnet';

// Chain configuration
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || getDefaultChainId());
export const RPC_URL = process.env.NEXT_PUBLIC_JEJU_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || getDefaultRpcUrl();

// External services
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || getDefaultIndexerUrl();
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || getDefaultExplorerUrl();
export const IPFS_API_URL = process.env.NEXT_PUBLIC_JEJU_IPFS_API || getDefaultIpfsApiUrl();
export const IPFS_GATEWAY_URL = process.env.NEXT_PUBLIC_JEJU_IPFS_GATEWAY || getDefaultIpfsGatewayUrl();
export const OIF_AGGREGATOR_URL = process.env.NEXT_PUBLIC_OIF_AGGREGATOR_URL || getDefaultOifAggregatorUrl();

// Contract addresses - with NEXT_PUBLIC_ override support
const ZERO = '0x0000000000000000000000000000000000000000' as const;

export const CONTRACTS = {
  // Tokens
  jeju: (process.env.NEXT_PUBLIC_JEJU_TOKEN_ADDRESS || ZERO) as Address,
  elizaOS: (process.env.NEXT_PUBLIC_ELIZA_OS_ADDRESS || ZERO) as Address,
  
  // Registry
  identityRegistry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS || ZERO) as Address,
  
  // Moderation
  banManager: (process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS || ZERO) as Address,
  moderationMarketplace: (process.env.NEXT_PUBLIC_MODERATION_MARKETPLACE_ADDRESS || ZERO) as Address,
  reportingSystem: (process.env.NEXT_PUBLIC_REPORTING_SYSTEM_ADDRESS || ZERO) as Address,
  reputationLabelManager: (process.env.NEXT_PUBLIC_REPUTATION_LABEL_MANAGER_ADDRESS || ZERO) as Address,
  labelManager: (process.env.NEXT_PUBLIC_LABEL_MANAGER_ADDRESS || ZERO) as Address,
  
  // JNS
  jnsRegistrar: (process.env.NEXT_PUBLIC_JNS_REGISTRAR || ZERO) as Address,
  bazaar: (process.env.NEXT_PUBLIC_BAZAAR || ZERO) as Address,
  
  // NFT Marketplace
  nftMarketplace: (process.env.NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS || ZERO) as Address,
  
  // Payments
  predimarket: (process.env.NEXT_PUBLIC_PREDIMARKET_ADDRESS || ZERO) as Address,
  
  // Perpetuals
  perpetualMarket: (process.env.NEXT_PUBLIC_PERPETUAL_MARKET_ADDRESS || ZERO) as Address,
  marginManager: (process.env.NEXT_PUBLIC_MARGIN_MANAGER_ADDRESS || ZERO) as Address,
  insuranceFund: (process.env.NEXT_PUBLIC_INSURANCE_FUND_ADDRESS || ZERO) as Address,
  liquidationEngine: (process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE_ADDRESS || ZERO) as Address,
  
  // Oracle Network
  oracleStakingManager: (process.env.NEXT_PUBLIC_ORACLE_STAKING_MANAGER_ADDRESS || ZERO) as Address,
  priceFeedAggregator: (process.env.NEXT_PUBLIC_PRICE_FEED_AGGREGATOR_ADDRESS || ZERO) as Address,
} as const;

// API keys (only ones that are actually public/client-safe)
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';
export const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
export const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY;

// Payment recipient for bazaar transactions
export const BAZAAR_PAYMENT_RECIPIENT = (process.env.NEXT_PUBLIC_BAZAAR_PAYMENT_RECIPIENT || ZERO) as Address;

// ============================================================================
// Default value getters (based on network)
// ============================================================================

function getDefaultChainId(): string {
  switch (NETWORK) {
    case 'mainnet': return '420691';
    case 'testnet': return '420690';
    default: return '1337';
  }
}

function getDefaultRpcUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://rpc.jeju.network';
    case 'testnet': return 'https://testnet-rpc.jeju.network';
    default: return 'http://localhost:9545';
  }
}

function getDefaultIndexerUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://indexer.jeju.network/graphql';
    case 'testnet': return 'https://testnet-indexer.jeju.network/graphql';
    default: return 'http://localhost:4350/graphql';
  }
}

function getDefaultIpfsApiUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://storage.jeju.network';
    case 'testnet': return 'https://testnet-storage.jeju.network';
    default: return 'http://localhost:3100';
  }
}

function getDefaultIpfsGatewayUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://ipfs.jeju.network';
    case 'testnet': return 'https://testnet-ipfs.jeju.network';
    default: return 'http://localhost:3100';
  }
}

function getDefaultExplorerUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://explorer.jeju.network';
    case 'testnet': return 'https://testnet-explorer.jeju.network';
    default: return 'http://localhost:4000';
  }
}

function getDefaultOifAggregatorUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://oif.jeju.network';
    case 'testnet': return 'https://testnet-oif.jeju.network';
    default: return 'http://localhost:4010';
  }
}
