/**
 * Bazaar App Configuration
 *
 * Config-first architecture:
 * - Defaults based on network
 * - PUBLIC_* env vars override at build time
 *
 * Note: This file centralizes env var access and provides type-safe defaults.
 * Import from here instead of using process.env.PUBLIC_* directly.
 */
import type { Address } from 'viem'

// Build-time network selection
export const NETWORK = (process.env.PUBLIC_NETWORK || 'localnet') as
  | 'localnet'
  | 'testnet'
  | 'mainnet'
export const NETWORK_NAME = process.env.PUBLIC_NETWORK_NAME || 'Jeju'

// Chain configuration
export const CHAIN_ID = parseInt(
  process.env.PUBLIC_CHAIN_ID || getDefaultChainId(),
  10,
)
export const RPC_URL =
  process.env.PUBLIC_JEJU_RPC_URL ||
  process.env.PUBLIC_RPC_URL ||
  getDefaultRpcUrl()

// External services
export const INDEXER_URL =
  process.env.PUBLIC_INDEXER_URL || getDefaultIndexerUrl()
export const EXPLORER_URL =
  process.env.PUBLIC_EXPLORER_URL || getDefaultExplorerUrl()
export const IPFS_API_URL =
  process.env.PUBLIC_JEJU_IPFS_API || getDefaultIpfsApiUrl()
export const IPFS_GATEWAY_URL =
  process.env.PUBLIC_JEJU_IPFS_GATEWAY || getDefaultIpfsGatewayUrl()
export const OIF_AGGREGATOR_URL =
  process.env.PUBLIC_OIF_AGGREGATOR_URL || getDefaultOifAggregatorUrl()

// Contract addresses - with PUBLIC_ override support
const ZERO = '0x0000000000000000000000000000000000000000' as const

export const CONTRACTS = {
  // Tokens
  jeju: (process.env.PUBLIC_JEJU_TOKEN_ADDRESS || ZERO) as Address,

  // Registry
  identityRegistry: (process.env.PUBLIC_IDENTITY_REGISTRY_ADDRESS ||
    ZERO) as Address,

  // Moderation
  banManager: (process.env.PUBLIC_BAN_MANAGER_ADDRESS || ZERO) as Address,
  moderationMarketplace: (process.env.PUBLIC_MODERATION_MARKETPLACE_ADDRESS ||
    ZERO) as Address,
  reportingSystem: (process.env.PUBLIC_REPORTING_SYSTEM_ADDRESS ||
    ZERO) as Address,
  reputationLabelManager: (process.env
    .PUBLIC_REPUTATION_LABEL_MANAGER_ADDRESS || ZERO) as Address,
  labelManager: (process.env.PUBLIC_LABEL_MANAGER_ADDRESS || ZERO) as Address,

  // JNS
  jnsRegistrar: (process.env.PUBLIC_JNS_REGISTRAR || ZERO) as Address,
  bazaar: (process.env.PUBLIC_BAZAAR || ZERO) as Address,

  // NFT Marketplace
  nftMarketplace: (process.env.PUBLIC_NFT_MARKETPLACE_ADDRESS ||
    ZERO) as Address,

  // Payments
  predimarket: (process.env.PUBLIC_PREDIMARKET_ADDRESS || ZERO) as Address,

  // Perpetuals
  perpetualMarket: (process.env.PUBLIC_PERPETUAL_MARKET_ADDRESS ||
    ZERO) as Address,
  marginManager: (process.env.PUBLIC_MARGIN_MANAGER_ADDRESS || ZERO) as Address,
  insuranceFund: (process.env.PUBLIC_INSURANCE_FUND_ADDRESS || ZERO) as Address,
  liquidationEngine: (process.env.PUBLIC_LIQUIDATION_ENGINE_ADDRESS ||
    ZERO) as Address,

  // Oracle Network
  oracleStakingManager: (process.env.PUBLIC_ORACLE_STAKING_MANAGER_ADDRESS ||
    ZERO) as Address,
  priceFeedAggregator: (process.env.PUBLIC_PRICE_FEED_AGGREGATOR_ADDRESS ||
    ZERO) as Address,
} as const

// API keys (only ones that are actually public/client-safe)
// WalletConnect Project ID - required for WalletConnect functionality
function getWalletConnectProjectId(): string {
  const projectId = process.env.PUBLIC_WALLETCONNECT_PROJECT_ID
  // Allow empty in development, but return empty string to disable WalletConnect
  if (!projectId || projectId === 'YOUR_PROJECT_ID') {
    return ''
  }
  return projectId
}
export const WALLETCONNECT_PROJECT_ID = getWalletConnectProjectId()
export const ALCHEMY_API_KEY = process.env.PUBLIC_ALCHEMY_API_KEY
export const HELIUS_API_KEY = process.env.PUBLIC_HELIUS_API_KEY

// Solana configuration
export const SOLANA_RPC_URL =
  process.env.PUBLIC_SOLANA_RPC_URL || getSolanaRpcUrl()
export const SOLANA_CHAIN_ID =
  process.env.PUBLIC_SOLANA_CHAIN_ID === 'mainnet' ? 101 : 102
export const SOLANA_AGENT_REGISTRY =
  'HvF3JqhahcX7JfhbDRYYCJ7S3f6nJdrqu5yi9shyTREp'

function getSolanaRpcUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://api.mainnet-beta.solana.com'
    case 'testnet':
      return 'https://api.devnet.solana.com'
    default:
      return 'http://localhost:8899'
  }
}

// Payment recipient for bazaar transactions
export const BAZAAR_PAYMENT_RECIPIENT = (process.env
  .PUBLIC_BAZAAR_PAYMENT_RECIPIENT || ZERO) as Address

// ============================================================================
// Default value getters (based on network)
// ============================================================================

function getDefaultChainId(): string {
  switch (NETWORK) {
    case 'mainnet':
      return '420691'
    case 'testnet':
      return '420690'
    default:
      return '1337'
  }
}

function getDefaultRpcUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://rpc.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-rpc.jejunetwork.org'
    default:
      return 'http://localhost:6546'
  }
}

function getDefaultIndexerUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://indexer.jejunetwork.org/graphql'
    case 'testnet':
      return 'https://testnet-indexer.jejunetwork.org/graphql'
    default:
      return 'http://localhost:4350/graphql'
  }
}

function getDefaultIpfsApiUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://storage.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-storage.jejunetwork.org'
    default:
      return 'http://localhost:3100'
  }
}

function getDefaultIpfsGatewayUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://ipfs.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-ipfs.jejunetwork.org'
    default:
      return 'http://localhost:3100'
  }
}

function getDefaultExplorerUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://explorer.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-explorer.jejunetwork.org'
    default:
      return 'http://localhost:4000'
  }
}

function getDefaultOifAggregatorUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://oif.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-oif.jejunetwork.org'
    default:
      return 'http://localhost:4030/oif'
  }
}
