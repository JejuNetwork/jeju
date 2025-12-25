/**
 * Gateway Frontend Configuration
 *
 * Uses @jejunetwork/config for all configuration.
 */

import {
  CORE_PORTS,
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

export const OAUTH3_AGENT_URL = services.oauth3?.api || getDefaultOAuth3Url()
export const INDEXER_URL = services.indexer?.graphql || getDefaultIndexerUrl()
export const INDEXER_REST_URL =
  services.indexer?.rest || getDefaultIndexerRestUrl()
export const INDEXER_A2A_URL =
  services.gateway?.a2a || getDefaultIndexerA2AUrl()
export const INDEXER_MCP_URL =
  services.gateway?.mcp || getDefaultIndexerMCPUrl()
export const RPC_GATEWAY_URL = services.rpcGateway || getDefaultRpcGatewayUrl()
export const IPFS_API_URL = services.storage?.api || getDefaultIpfsApiUrl()
export const IPFS_GATEWAY_URL =
  services.storage?.ipfsGateway || getDefaultIpfsGatewayUrl()
export const OIF_AGGREGATOR_URL =
  services.oif?.aggregator || getDefaultOifAggregatorUrl()
export const LEADERBOARD_API_URL =
  services.leaderboard?.api || getDefaultLeaderboardUrl()
export const EXPLORER_URL = services.explorer || getDefaultExplorerUrl()

// Contract addresses from config
const contracts = getContractsConfig(NETWORK)

/** Helper to get address or zero address */
function addr(value: string | undefined): Address {
  return (value as Address) || ZERO_ADDRESS
}

export const CONTRACTS = {
  // Tokens
  jeju: addr(contracts.tokens?.jeju),
  usdc: addr(contracts.tokens?.usdc),
  weth: getAddress('0x4200000000000000000000000000000000000006'),

  // Registry
  identityRegistry: addr(contracts.registry?.identity),
  tokenRegistry: addr(contracts.registry?.token),
  reputationRegistry: addr(contracts.registry?.reputation),
  validationRegistry: addr(contracts.registry?.validation),

  // Moderation
  banManager: addr(contracts.moderation?.banManager),
  moderationMarketplace: addr(contracts.moderation?.moderationMarketplace),
  reportingSystem: addr(contracts.moderation?.reportingSystem),
  reputationLabelManager: addr(contracts.moderation?.reputationLabelManager),
  registryGovernance: addr(contracts.governance?.registryGovernance),

  // Bazaar (Prediction Markets)
  predictionMarket: addr(contracts.bazaar?.predictionMarket),

  // Node Staking
  nodeStakingManager: addr(contracts.nodeStaking?.manager),
  nodePerformanceOracle: addr(contracts.nodeStaking?.performanceOracle),
  rpcStaking: addr(contracts.rpc?.staking),

  // JNS
  jnsRegistry: addr(contracts.jns?.registry),
  jnsResolver: addr(contracts.jns?.resolver),
  jnsRegistrar: addr(contracts.jns?.registrar),
  jnsReverseRegistrar: addr(contracts.jns?.reverseRegistrar),

  // Payments
  paymasterFactory: addr(contracts.payments?.paymasterFactory),
  priceOracle: addr(contracts.payments?.priceOracle),
  entryPoint: getAddress('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'),
  x402Facilitator: addr(contracts.payments?.x402Facilitator),

  // DeFi (Uniswap v4)
  poolManager: addr(contracts.defi?.poolManager),
  swapRouter: addr(contracts.defi?.swapRouter),
  positionManager: addr(contracts.defi?.positionManager),
  quoterV4: addr(contracts.defi?.quoterV4),
  stateView: addr(contracts.defi?.stateView),

  // Compute
  computeRegistry: addr(contracts.compute?.registry),
  ledgerManager: addr(contracts.compute?.ledgerManager),
  inferenceServing: addr(contracts.compute?.inferenceServing),
  computeStaking: addr(contracts.compute?.staking),

  // Governance
  governor: addr(contracts.governance?.governor),
  futarchyGovernor: addr(contracts.governance?.futarchyGovernor),

  // OIF
  solverRegistry: addr(contracts.oif?.solverRegistry),
  inputSettler: {
    jeju: addr(contracts.oif?.inputSettler),
    ethereum: ZERO_ADDRESS,
    sepolia: ZERO_ADDRESS,
    arbitrum: ZERO_ADDRESS,
    optimism: ZERO_ADDRESS,
  },

  // EIL
  crossChainPaymaster: addr(contracts.eil?.crossChainPaymaster),

  // GitHub Reputation
  githubReputationProvider: addr(contracts.registry?.githubReputationProvider),

  // Oracle Network
  oracleNetworkConnector: addr(contracts.oracle?.oracleNetworkConnector),
} as const

// WalletConnect project ID - placeholder for production
export const WALLETCONNECT_PROJECT_ID = 'YOUR_PROJECT_ID'

// Default URL helpers for localnet fallbacks
function getDefaultOAuth3Url(): string {
  if (NETWORK === 'mainnet') return 'https://auth.jejunetwork.org'
  if (NETWORK === 'testnet') return 'https://testnet-auth.jejunetwork.org'
  return `http://127.0.0.1:${CORE_PORTS.OAUTH3_API.DEFAULT}`
}

function getDefaultIndexerUrl(): string {
  if (NETWORK === 'mainnet') return 'https://indexer.jejunetwork.org/graphql'
  if (NETWORK === 'testnet')
    return 'https://testnet-indexer.jejunetwork.org/graphql'
  return `http://127.0.0.1:${CORE_PORTS.INDEXER_GRAPHQL.DEFAULT}/graphql`
}

function getDefaultIndexerRestUrl(): string {
  if (NETWORK === 'mainnet') return 'https://indexer.jejunetwork.org/api'
  if (NETWORK === 'testnet')
    return 'https://testnet-indexer.jejunetwork.org/api'
  return `http://127.0.0.1:${CORE_PORTS.INDEXER_REST.DEFAULT}/api`
}

function getDefaultIndexerA2AUrl(): string {
  if (NETWORK === 'mainnet') return 'https://indexer.jejunetwork.org/a2a'
  if (NETWORK === 'testnet')
    return 'https://testnet-indexer.jejunetwork.org/a2a'
  return `http://127.0.0.1:${CORE_PORTS.INDEXER_A2A.DEFAULT}/api/a2a`
}

function getDefaultIndexerMCPUrl(): string {
  if (NETWORK === 'mainnet') return 'https://indexer.jejunetwork.org/mcp'
  if (NETWORK === 'testnet')
    return 'https://testnet-indexer.jejunetwork.org/mcp'
  return `http://127.0.0.1:${CORE_PORTS.INDEXER_MCP.DEFAULT}`
}

function getDefaultRpcGatewayUrl(): string {
  if (NETWORK === 'mainnet') return 'https://rpc-gateway.jejunetwork.org'
  if (NETWORK === 'testnet')
    return 'https://testnet-rpc-gateway.jejunetwork.org'
  return `http://127.0.0.1:${CORE_PORTS.RPC_GATEWAY.DEFAULT}`
}

function getDefaultIpfsApiUrl(): string {
  if (NETWORK === 'mainnet') return 'https://storage.jejunetwork.org'
  if (NETWORK === 'testnet') return 'https://testnet-storage.jejunetwork.org'
  return `http://127.0.0.1:${CORE_PORTS.IPFS.DEFAULT}`
}

function getDefaultIpfsGatewayUrl(): string {
  if (NETWORK === 'mainnet') return 'https://ipfs.jejunetwork.org'
  if (NETWORK === 'testnet') return 'https://testnet-ipfs.jejunetwork.org'
  return `http://127.0.0.1:${CORE_PORTS.IPFS.DEFAULT}`
}

function getDefaultOifAggregatorUrl(): string {
  if (NETWORK === 'mainnet') return 'https://oif.jejunetwork.org/api'
  if (NETWORK === 'testnet') return 'https://testnet-oif.jejunetwork.org/api'
  return `http://127.0.0.1:${CORE_PORTS.OIF_AGGREGATOR.DEFAULT}/api`
}

function getDefaultLeaderboardUrl(): string {
  if (NETWORK === 'mainnet' || NETWORK === 'testnet') {
    return 'https://leaderboard.jejunetwork.org'
  }
  return `http://127.0.0.1:${CORE_PORTS.LEADERBOARD_API.DEFAULT}`
}

function getDefaultExplorerUrl(): string {
  if (NETWORK === 'mainnet') return 'https://explorer.jejunetwork.org'
  if (NETWORK === 'testnet') return 'https://testnet-explorer.jejunetwork.org'
  return `http://127.0.0.1:${CORE_PORTS.EXPLORER.DEFAULT}`
}
