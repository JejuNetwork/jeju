import {
  getApiKey,
  getContractsConfig,
  getOAuth3Url,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

// Re-export network constants from network.ts to avoid circular deps
export {
  CHAIN_ID,
  EXPLORER_URL,
  INDEXER_URL,
  NETWORK,
  NETWORK_NAME,
  OIF_AGGREGATOR_URL,
  RPC_URL,
} from './network'

import { NETWORK, RPC_URL } from './network'

// OAuth3 URL
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
