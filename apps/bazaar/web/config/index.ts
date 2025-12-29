/**
 * Bazaar App Configuration
 *
 * Uses @jejunetwork/config for all configuration.
 */

import {
  getApiKey,
  getChainId,
  getContractsConfig,
  getCurrentNetwork,
  getOAuth3Url,
  getRpcUrl,
  getServicesConfig,
  type NetworkType,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

// Network from config
export const NETWORK: NetworkType = getCurrentNetwork()
export const NETWORK_NAME = 'Jeju'

// Chain configuration from config
export const CHAIN_ID = getChainId(NETWORK)
export const RPC_URL = getRpcUrl(NETWORK)

// Service URLs from config
const services = getServicesConfig(NETWORK)

export const INDEXER_URL = services.indexer.graphql || ''
export const EXPLORER_URL = services.explorer || ''
export const OIF_AGGREGATOR_URL = services.oif.aggregator || ''
export const OAUTH3_AGENT_URL = getOAuth3Url(NETWORK)

// Contract addresses from config
const contracts = getContractsConfig(NETWORK)

/** Helper to get address or zero address */
function addr(value: string | undefined): Address {
  return (value as Address) || ZERO_ADDRESS
}

export const CONTRACTS = {
  // Tokens
  jeju: addr(contracts.tokens.jeju),

  // Registry
  identityRegistry: addr(contracts.registry.identity),

  // Moderation
  banManager: addr(contracts.moderation.banManager),
  moderationMarketplace: addr(contracts.moderation.moderationMarketplace),
  reportingSystem: addr(contracts.moderation.reportingSystem),
  reputationLabelManager: addr(contracts.moderation.reputationLabelManager),
  labelManager: addr(contracts.moderation.labelManager),

  // JNS
  jnsRegistrar: addr(contracts.jns.registrar),
  bazaar: addr(contracts.commerce?.marketplace),

  // NFT Marketplace
  nftMarketplace: addr(contracts.commerce?.nftMarketplace),

  // Prediction Markets (part of Bazaar)
  predictionMarket: addr(contracts.bazaar?.predictionMarket),

  // Perpetuals
  perpetualMarket: addr(contracts.perps?.market),
  marginManager: addr(contracts.perps?.marginManager),
  insuranceFund: addr(contracts.perps?.insuranceFund),
  liquidationEngine: addr(contracts.perps?.liquidationEngine),

  // Oracle Network
  oracleStakingManager: addr(contracts.oracle?.stakingManager),
  priceFeedAggregator: addr(contracts.oracle?.priceFeedAggregator),
} as const

// WalletConnect Project ID from config
export const WALLETCONNECT_PROJECT_ID = getApiKey('walletconnect') || ''

// Direct exports for prediction market contracts (with env var fallback for local dev)
export const PREDICTION_MARKET_ADDRESS: Address =
  (process.env.PREDICTION_MARKET_ADDRESS as Address) ||
  CONTRACTS.predictionMarket ||
  ZERO_ADDRESS

export const PREDICTION_ORACLE_ADDRESS: Address =
  (process.env.PREDICTION_ORACLE_ADDRESS as Address) || ZERO_ADDRESS

// Direct exports for perpetual market contracts (with env var fallback for local dev)
export const PERPETUAL_MARKET_ADDRESS: Address =
  (process.env.PERPETUAL_MARKET_ADDRESS as Address) ||
  CONTRACTS.perpetualMarket ||
  ZERO_ADDRESS

export const MARGIN_MANAGER_ADDRESS: Address =
  (process.env.MARGIN_MANAGER_ADDRESS as Address) ||
  CONTRACTS.marginManager ||
  ZERO_ADDRESS

export const getL2RpcUrl = () => RPC_URL
