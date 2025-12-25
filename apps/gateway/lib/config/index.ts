/**
 * Gateway Frontend Configuration
 *
 * Uses @jejunetwork/config for defaults, with PUBLIC_ env overrides for browser builds.
 * All public env vars use PUBLIC_ prefix (not VITE_).
 */

import {
  CORE_PORTS,
  getChainId as getConfigChainId,
  getContractsConfig,
  getCurrentNetwork,
  getRpcUrl as getConfigRpcUrl,
  getServicesConfig,
  getWsUrl as getConfigWsUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { type Address, getAddress, isAddress } from 'viem'

/** Get env var from import.meta.env (browser) */
function getEnv(key: string): string | undefined {
  if (typeof import.meta?.env === 'object') {
    return import.meta.env[key as keyof ImportMetaEnv] as string | undefined
  }
  return undefined
}

/** Parse a PUBLIC_ env var as an Address with fallback */
function parsePublicAddress(
  envKey: string,
  fallback: Address = ZERO_ADDRESS,
): Address {
  const value = getEnv(envKey)
  if (!value) return fallback
  return isAddress(value) ? getAddress(value) : fallback
}

// Build-time network selection from PUBLIC_NETWORK or config
export const NETWORK: NetworkType = (() => {
  const envNetwork = getEnv('PUBLIC_NETWORK')
  if (
    envNetwork === 'localnet' ||
    envNetwork === 'testnet' ||
    envNetwork === 'mainnet'
  ) {
    return envNetwork
  }
  return getCurrentNetwork()
})()

// Chain configuration - prefer PUBLIC_ env, fall back to config
export const CHAIN_ID = parseInt(
  getEnv('PUBLIC_CHAIN_ID') || String(getConfigChainId(NETWORK)),
  10,
)

export const RPC_URL =
  getEnv('PUBLIC_RPC_URL') || getEnv('PUBLIC_JEJU_RPC_URL') || getConfigRpcUrl(NETWORK)

export const WS_URL = getEnv('PUBLIC_WS_URL') || getConfigWsUrl(NETWORK)

// Service URLs - prefer PUBLIC_ env, fall back to config
const services = getServicesConfig(NETWORK)

export const OAUTH3_AGENT_URL =
  getEnv('PUBLIC_OAUTH3_AGENT_URL') || services.oauth3?.api || getDefaultOAuth3Url()

export const INDEXER_URL =
  getEnv('PUBLIC_INDEXER_URL') || services.indexer?.graphql || getDefaultIndexerUrl()

export const INDEXER_REST_URL =
  getEnv('PUBLIC_INDEXER_REST_URL') || services.indexer?.rest || getDefaultIndexerRestUrl()

export const INDEXER_A2A_URL =
  getEnv('PUBLIC_INDEXER_A2A_URL') || services.gateway?.a2a || getDefaultIndexerA2AUrl()

export const INDEXER_MCP_URL =
  getEnv('PUBLIC_INDEXER_MCP_URL') || services.gateway?.mcp || getDefaultIndexerMCPUrl()

export const RPC_GATEWAY_URL =
  getEnv('PUBLIC_RPC_GATEWAY_URL') ||
  services.rpcGateway ||
  getDefaultRpcGatewayUrl()

export const IPFS_API_URL =
  getEnv('PUBLIC_IPFS_API') || services.storage?.api || getDefaultIpfsApiUrl()

export const IPFS_GATEWAY_URL =
  getEnv('PUBLIC_IPFS_GATEWAY') || services.storage?.ipfsGateway || getDefaultIpfsGatewayUrl()

export const OIF_AGGREGATOR_URL =
  getEnv('PUBLIC_OIF_AGGREGATOR_URL') || services.oif?.aggregator || getDefaultOifAggregatorUrl()

export const LEADERBOARD_API_URL =
  getEnv('PUBLIC_LEADERBOARD_API_URL') || services.leaderboard?.api || getDefaultLeaderboardUrl()

export const EXPLORER_URL =
  getEnv('PUBLIC_EXPLORER_URL') ||
  services.explorer ||
  getDefaultExplorerUrl()

// Contract addresses - prefer PUBLIC_ env, fall back to config
const contracts = getContractsConfig(NETWORK)

export const CONTRACTS = {
  // Tokens
  jeju: parsePublicAddress('PUBLIC_JEJU_TOKEN_ADDRESS', contracts.tokens?.jeju as Address),
  usdc: parsePublicAddress('PUBLIC_USDC_ADDRESS', contracts.tokens?.usdc as Address),
  weth: getAddress('0x4200000000000000000000000000000000000006'),

  // Registry
  identityRegistry: parsePublicAddress(
    'PUBLIC_IDENTITY_REGISTRY_ADDRESS',
    contracts.registry?.identity as Address,
  ),
  tokenRegistry: parsePublicAddress(
    'PUBLIC_TOKEN_REGISTRY_ADDRESS',
    contracts.registry?.token as Address,
  ),
  reputationRegistry: parsePublicAddress(
    'PUBLIC_REPUTATION_REGISTRY_ADDRESS',
    contracts.registry?.reputation as Address,
  ),
  validationRegistry: parsePublicAddress(
    'PUBLIC_VALIDATION_REGISTRY_ADDRESS',
    contracts.registry?.validation as Address,
  ),

  // Moderation
  banManager: parsePublicAddress(
    'PUBLIC_BAN_MANAGER_ADDRESS',
    contracts.moderation?.banManager as Address,
  ),
  moderationMarketplace: parsePublicAddress(
    'PUBLIC_MODERATION_MARKETPLACE_ADDRESS',
    contracts.moderation?.moderationMarketplace as Address,
  ),
  reportingSystem: parsePublicAddress(
    'PUBLIC_REPORTING_SYSTEM_ADDRESS',
    contracts.moderation?.reportingSystem as Address,
  ),
  reputationLabelManager: parsePublicAddress(
    'PUBLIC_REPUTATION_LABEL_MANAGER_ADDRESS',
    contracts.moderation?.reputationLabelManager as Address,
  ),
  predimarket: parsePublicAddress('PUBLIC_PREDIMARKET_ADDRESS', contracts.moderation?.predimarket as Address),
  registryGovernance: parsePublicAddress(
    'PUBLIC_REGISTRY_GOVERNANCE_ADDRESS',
    contracts.governance?.registryGovernance as Address,
  ),

  // Node Staking
  nodeStakingManager: parsePublicAddress(
    'PUBLIC_NODE_STAKING_MANAGER_ADDRESS',
    contracts.nodeStaking?.manager as Address,
  ),
  nodePerformanceOracle: parsePublicAddress(
    'PUBLIC_NODE_PERFORMANCE_ORACLE_ADDRESS',
    contracts.nodeStaking?.performanceOracle as Address,
  ),
  rpcStaking: parsePublicAddress(
    'PUBLIC_RPC_STAKING_ADDRESS',
    contracts.rpc?.staking as Address,
  ),

  // JNS
  jnsRegistry: parsePublicAddress(
    'PUBLIC_JNS_REGISTRY',
    contracts.jns?.registry as Address,
  ),
  jnsResolver: parsePublicAddress(
    'PUBLIC_JNS_RESOLVER',
    contracts.jns?.resolver as Address,
  ),
  jnsRegistrar: parsePublicAddress(
    'PUBLIC_JNS_REGISTRAR',
    contracts.jns?.registrar as Address,
  ),
  jnsReverseRegistrar: parsePublicAddress(
    'PUBLIC_JNS_REVERSE_REGISTRAR',
    contracts.jns?.reverseRegistrar as Address,
  ),

  // Payments
  paymasterFactory: parsePublicAddress(
    'PUBLIC_PAYMASTER_FACTORY_ADDRESS',
    contracts.payments?.paymasterFactory as Address,
  ),
  priceOracle: parsePublicAddress(
    'PUBLIC_PRICE_ORACLE_ADDRESS',
    contracts.payments?.priceOracle as Address,
  ),
  entryPoint: parsePublicAddress(
    'PUBLIC_ENTRY_POINT_ADDRESS',
    getAddress('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'),
  ),
  x402Facilitator: parsePublicAddress(
    'PUBLIC_X402_FACILITATOR_ADDRESS',
    contracts.payments?.x402Facilitator as Address,
  ),

  // DeFi (Uniswap v4)
  poolManager: parsePublicAddress(
    'PUBLIC_POOL_MANAGER_ADDRESS',
    contracts.defi?.poolManager as Address,
  ),
  swapRouter: parsePublicAddress(
    'PUBLIC_SWAP_ROUTER_ADDRESS',
    contracts.defi?.swapRouter as Address,
  ),
  positionManager: parsePublicAddress(
    'PUBLIC_POSITION_MANAGER_ADDRESS',
    contracts.defi?.positionManager as Address,
  ),
  quoterV4: parsePublicAddress(
    'PUBLIC_QUOTER_V4_ADDRESS',
    contracts.defi?.quoterV4 as Address,
  ),
  stateView: parsePublicAddress(
    'PUBLIC_STATE_VIEW_ADDRESS',
    contracts.defi?.stateView as Address,
  ),

  // Compute
  computeRegistry: parsePublicAddress(
    'PUBLIC_COMPUTE_REGISTRY_ADDRESS',
    contracts.compute?.registry as Address,
  ),
  ledgerManager: parsePublicAddress(
    'PUBLIC_LEDGER_MANAGER_ADDRESS',
    contracts.compute?.ledgerManager as Address,
  ),
  inferenceServing: parsePublicAddress(
    'PUBLIC_INFERENCE_SERVING_ADDRESS',
    contracts.compute?.inferenceServing as Address,
  ),
  computeStaking: parsePublicAddress(
    'PUBLIC_COMPUTE_STAKING_ADDRESS',
    contracts.compute?.staking as Address,
  ),

  // Governance
  governor: parsePublicAddress(
    'PUBLIC_GOVERNOR_ADDRESS',
    contracts.governance?.governor as Address,
  ),
  futarchyGovernor: parsePublicAddress(
    'PUBLIC_FUTARCHY_GOVERNOR_ADDRESS',
    contracts.governance?.futarchyGovernor as Address,
  ),

  // OIF
  solverRegistry: parsePublicAddress(
    'PUBLIC_OIF_SOLVER_REGISTRY',
    contracts.oif?.solverRegistry as Address,
  ),
  inputSettler: {
    jeju: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_JEJU', contracts.oif?.inputSettler as Address),
    ethereum: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_ETHEREUM'),
    sepolia: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_SEPOLIA'),
    arbitrum: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_ARBITRUM'),
    optimism: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_OPTIMISM'),
  },

  // EIL
  crossChainPaymaster: parsePublicAddress(
    'PUBLIC_CROSS_CHAIN_PAYMASTER_ADDRESS',
    contracts.eil?.crossChainPaymaster as Address,
  ),

  // GitHub Reputation (using registry category)
  githubReputationProvider: parsePublicAddress(
    'PUBLIC_GITHUB_REPUTATION_PROVIDER_ADDRESS',
    contracts.registry?.githubReputationProvider as Address,
  ),

  // Oracle Network
  oracleNetworkConnector: parsePublicAddress(
    'PUBLIC_ORACLE_NETWORK_CONNECTOR_ADDRESS',
    contracts.oracle?.oracleNetworkConnector as Address,
  ),
} as const

// WalletConnect project ID
export const WALLETCONNECT_PROJECT_ID =
  getEnv('PUBLIC_WALLETCONNECT_PROJECT_ID') || 'YOUR_PROJECT_ID'

// Default URL helpers for localnet fallbacks
function getDefaultOAuth3Url(): string {
  if (NETWORK === 'mainnet') return 'https://auth.jejunetwork.org'
  if (NETWORK === 'testnet') return 'https://testnet-auth.jejunetwork.org'
  return `http://127.0.0.1:${CORE_PORTS.OAUTH3_API.DEFAULT}`
}

function getDefaultIndexerUrl(): string {
  if (NETWORK === 'mainnet') return 'https://indexer.jejunetwork.org/graphql'
  if (NETWORK === 'testnet') return 'https://testnet-indexer.jejunetwork.org/graphql'
  return `http://127.0.0.1:${CORE_PORTS.INDEXER_GRAPHQL.DEFAULT}/graphql`
}

function getDefaultIndexerRestUrl(): string {
  if (NETWORK === 'mainnet') return 'https://indexer.jejunetwork.org/api'
  if (NETWORK === 'testnet') return 'https://testnet-indexer.jejunetwork.org/api'
  return `http://127.0.0.1:${CORE_PORTS.INDEXER_REST.DEFAULT}/api`
}

function getDefaultIndexerA2AUrl(): string {
  if (NETWORK === 'mainnet') return 'https://indexer.jejunetwork.org/a2a'
  if (NETWORK === 'testnet') return 'https://testnet-indexer.jejunetwork.org/a2a'
  return `http://127.0.0.1:${CORE_PORTS.INDEXER_A2A.DEFAULT}/api/a2a`
}

function getDefaultIndexerMCPUrl(): string {
  if (NETWORK === 'mainnet') return 'https://indexer.jejunetwork.org/mcp'
  if (NETWORK === 'testnet') return 'https://testnet-indexer.jejunetwork.org/mcp'
  return `http://127.0.0.1:${CORE_PORTS.INDEXER_MCP.DEFAULT}`
}

function getDefaultRpcGatewayUrl(): string {
  if (NETWORK === 'mainnet') return 'https://rpc-gateway.jejunetwork.org'
  if (NETWORK === 'testnet') return 'https://testnet-rpc-gateway.jejunetwork.org'
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
