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
import { isHexString } from '@jejunetwork/types'
import type { Address } from 'viem'

// Type-safe address parsing from env vars
const ZERO: Address = '0x0000000000000000000000000000000000000000'

function parseEnvAddress(value: string | undefined): Address {
  if (!value || !isHexString(value)) {
    return ZERO
  }
  return value
}

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
export const OAUTH3_AGENT_URL =
  process.env.PUBLIC_OAUTH3_AGENT_URL || getDefaultOAuth3AgentUrl()

// Contract addresses - with PUBLIC_ override support
export const CONTRACTS = {
  // Tokens
  jeju: parseEnvAddress(process.env.PUBLIC_JEJU_TOKEN_ADDRESS),

  // Registry
  identityRegistry: parseEnvAddress(
    process.env.PUBLIC_IDENTITY_REGISTRY_ADDRESS,
  ),

  // Moderation
  banManager: parseEnvAddress(process.env.PUBLIC_BAN_MANAGER_ADDRESS),
  moderationMarketplace: parseEnvAddress(
    process.env.PUBLIC_MODERATION_MARKETPLACE_ADDRESS,
  ),
  reportingSystem: parseEnvAddress(process.env.PUBLIC_REPORTING_SYSTEM_ADDRESS),
  reputationLabelManager: parseEnvAddress(
    process.env.PUBLIC_REPUTATION_LABEL_MANAGER_ADDRESS,
  ),
  labelManager: parseEnvAddress(process.env.PUBLIC_LABEL_MANAGER_ADDRESS),

  // JNS
  jnsRegistrar: parseEnvAddress(process.env.PUBLIC_JNS_REGISTRAR),
  bazaar: parseEnvAddress(process.env.PUBLIC_BAZAAR),

  // NFT Marketplace
  nftMarketplace: parseEnvAddress(process.env.PUBLIC_NFT_MARKETPLACE_ADDRESS),

  // Payments
  predimarket: parseEnvAddress(process.env.PUBLIC_PREDIMARKET_ADDRESS),

  // Perpetuals
  perpetualMarket: parseEnvAddress(process.env.PUBLIC_PERPETUAL_MARKET_ADDRESS),
  marginManager: parseEnvAddress(process.env.PUBLIC_MARGIN_MANAGER_ADDRESS),
  insuranceFund: parseEnvAddress(process.env.PUBLIC_INSURANCE_FUND_ADDRESS),
  liquidationEngine: parseEnvAddress(
    process.env.PUBLIC_LIQUIDATION_ENGINE_ADDRESS,
  ),

  // Oracle Network
  oracleStakingManager: parseEnvAddress(
    process.env.PUBLIC_ORACLE_STAKING_MANAGER_ADDRESS,
  ),
  priceFeedAggregator: parseEnvAddress(
    process.env.PUBLIC_PRICE_FEED_AGGREGATOR_ADDRESS,
  ),
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
export const BAZAAR_PAYMENT_RECIPIENT = parseEnvAddress(
  process.env.PUBLIC_BAZAAR_PAYMENT_RECIPIENT,
)

// Default value getters (based on network)

function getDefaultChainId(): string {
  switch (NETWORK) {
    case 'mainnet':
      return '420691'
    case 'testnet':
      return '420690'
    default:
      return '31337'
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

function getDefaultOAuth3AgentUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://auth.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-auth.jejunetwork.org'
    default:
      return 'http://localhost:4200'
  }
}
