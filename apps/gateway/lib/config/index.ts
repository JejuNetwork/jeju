/**
 * Gateway Frontend Configuration
 *
 * Uses @jejunetwork/config for all configuration.
 */

import {
  getChainId,
  getContractsConfig,
  getCurrentNetwork,
  getRpcUrl,
  getServicesConfig,
  getWsUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { type Address, getAddress } from 'viem'

// Network from config
export const NETWORK: NetworkType = getCurrentNetwork()

// Chain configuration from config
export const CHAIN_ID = getChainId(NETWORK)
export const RPC_URL = getRpcUrl(NETWORK)
export const WS_URL = getWsUrl(NETWORK)

// Service URLs from config
const services = getServicesConfig(NETWORK)

function requireServiceUrl(url: string | undefined, name: string): string {
  if (!url) throw new Error(`${name} URL not configured for network ${NETWORK}`)
  return url
}

export const OAUTH3_AGENT_URL = requireServiceUrl(
  services.oauth3?.api,
  'OAuth3',
)
export const INDEXER_URL = requireServiceUrl(
  services.indexer.graphql,
  'Indexer GraphQL',
)
export const INDEXER_REST_URL = requireServiceUrl(
  services.indexer.rest,
  'Indexer REST',
)
export const INDEXER_A2A_URL = requireServiceUrl(
  services.gateway.a2a,
  'Indexer A2A',
)
export const INDEXER_MCP_URL = requireServiceUrl(
  services.gateway.mcp,
  'Indexer MCP',
)
export const RPC_GATEWAY_URL = requireServiceUrl(
  services.rpcGateway,
  'RPC Gateway',
)
export const IPFS_API_URL = requireServiceUrl(services.storage.api, 'IPFS API')
export const IPFS_GATEWAY_URL = requireServiceUrl(
  services.storage.ipfsGateway,
  'IPFS Gateway',
)
export const OIF_AGGREGATOR_URL = requireServiceUrl(
  services.oif.aggregator,
  'OIF Aggregator',
)
export const LEADERBOARD_API_URL = requireServiceUrl(
  services.leaderboard.api,
  'Leaderboard',
)
export const EXPLORER_URL = requireServiceUrl(services.explorer, 'Explorer')

// Contract addresses from config
const contracts = getContractsConfig(NETWORK)

/** Helper to get address - throws if not configured */
function _requireAddr(value: string | undefined, name: string): Address {
  if (!value) throw new Error(`Contract address not configured: ${name}`)
  return getAddress(value)
}

// Suppress unused variable warning - kept for future use
void _requireAddr

/** Helper to get optional address - returns ZERO_ADDRESS if not configured */
function optionalAddr(value: string | undefined): Address {
  if (!value) return ZERO_ADDRESS
  return getAddress(value)
}

export const CONTRACTS = {
  // Tokens - some may not be deployed on all networks
  jeju: optionalAddr(contracts.tokens?.jeju),
  usdc: optionalAddr(contracts.tokens?.usdc),
  weth: getAddress('0x4200000000000000000000000000000000000006'),

  // Registry - some may not be deployed on all networks
  identityRegistry: optionalAddr(contracts.registry?.identity),
  tokenRegistry: optionalAddr(contracts.registry?.token),
  reputationRegistry: optionalAddr(contracts.registry?.reputation),
  validationRegistry: optionalAddr(contracts.registry?.validation),

  // Moderation (optional - may not be deployed on all networks)
  banManager: optionalAddr(contracts.moderation?.banManager),
  reportingSystem: optionalAddr(contracts.moderation?.reportingSystem),
  reputationLabelManager: optionalAddr(
    contracts.moderation?.reputationLabelManager,
  ),
  registryGovernance: optionalAddr(contracts.governance?.registryGovernance),

  // Bazaar (Prediction Markets) - optional
  predictionMarket: optionalAddr(contracts.bazaar?.predictionMarket),

  // Node Staking - optional (may not be deployed on all networks)
  nodeStakingManager: optionalAddr(contracts.nodeStaking?.manager),
  nodePerformanceOracle: optionalAddr(contracts.nodeStaking?.performanceOracle),
  rpcStaking: optionalAddr(contracts.rpc?.staking),

  // JNS - optional
  jnsRegistry: optionalAddr(contracts.jns?.registry),
  jnsResolver: optionalAddr(contracts.jns?.resolver),
  jnsRegistrar: optionalAddr(contracts.jns?.registrar),
  jnsReverseRegistrar: optionalAddr(contracts.jns?.reverseRegistrar),

  // Payments - optional
  paymasterFactory: optionalAddr(contracts.payments?.paymasterFactory),
  priceOracle: optionalAddr(contracts.payments?.priceOracle),
  entryPoint: getAddress('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'),
  x402Facilitator: optionalAddr(contracts.payments?.x402Facilitator),

  // Compute - optional
  computeRegistry: optionalAddr(contracts.compute?.registry),
  ledgerManager: optionalAddr(contracts.compute?.ledgerManager),
  inferenceServing: optionalAddr(contracts.compute?.inferenceServing),
  computeStaking: optionalAddr(contracts.compute?.staking),

  // OIF - optional
  solverRegistry: optionalAddr(contracts.oif?.solverRegistry),
  inputSettler: {
    jeju: optionalAddr(contracts.oif?.inputSettler),
    ethereum: ZERO_ADDRESS,
    sepolia: ZERO_ADDRESS,
    arbitrum: ZERO_ADDRESS,
    optimism: ZERO_ADDRESS,
  },

  // EIL - optional
  crossChainPaymaster: optionalAddr(contracts.eil?.crossChainPaymaster),

  // GitHub Reputation - optional
  githubReputationProvider: optionalAddr(
    contracts.registry?.githubReputationProvider,
  ),

  // Oracle Network - optional
  oracleNetworkConnector: optionalAddr(
    contracts.oracle?.oracleNetworkConnector,
  ),
} as const
