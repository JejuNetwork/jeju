/**
 * Gateway Frontend Configuration
 *
 * Uses @jejunetwork/config for defaults, with PUBLIC_ env overrides for browser builds.
 * All public env vars use PUBLIC_ prefix (not VITE_).
 */

import {
  CORE_PORTS,
  getChainId as getConfigChainId,
  getRpcUrl as getConfigRpcUrl,
  getWsUrl as getConfigWsUrl,
  getContractsConfig,
  getCurrentNetwork,
  getServicesConfig,
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
  getEnv('PUBLIC_RPC_URL') ||
  getEnv('PUBLIC_JEJU_RPC_URL') ||
  getConfigRpcUrl(NETWORK)

export const WS_URL = getEnv('PUBLIC_WS_URL') || getConfigWsUrl(NETWORK)

// Service URLs - prefer PUBLIC_ env, fall back to config
const services = getServicesConfig(NETWORK)

export const OAUTH3_AGENT_URL =
  getEnv('PUBLIC_OAUTH3_AGENT_URL') ||
  services.oauth3?.api ||
  getDefaultOAuth3Url()

export const INDEXER_URL =
  getEnv('PUBLIC_INDEXER_URL') ||
  services.indexer?.graphql ||
  getDefaultIndexerUrl()

export const INDEXER_REST_URL =
  getEnv('PUBLIC_INDEXER_REST_URL') ||
  services.indexer?.rest ||
  getDefaultIndexerRestUrl()

export const INDEXER_A2A_URL =
  getEnv('PUBLIC_INDEXER_A2A_URL') ||
  services.indexer?.a2a ||
  getDefaultIndexerA2AUrl()

export const INDEXER_MCP_URL =
  getEnv('PUBLIC_INDEXER_MCP_URL') ||
  services.indexer?.mcp ||
  getDefaultIndexerMCPUrl()

export const RPC_GATEWAY_URL =
  getEnv('PUBLIC_RPC_GATEWAY_URL') ||
  services.rpcGateway?.api ||
  getDefaultRpcGatewayUrl()

export const IPFS_API_URL =
  getEnv('PUBLIC_IPFS_API') || services.storage?.api || getDefaultIpfsApiUrl()

export const IPFS_GATEWAY_URL =
  getEnv('PUBLIC_IPFS_GATEWAY') ||
  services.storage?.ipfsGateway ||
  getDefaultIpfsGatewayUrl()

export const OIF_AGGREGATOR_URL =
  getEnv('PUBLIC_OIF_AGGREGATOR_URL') ||
  services.oif?.aggregator ||
  getDefaultOifAggregatorUrl()

export const LEADERBOARD_API_URL =
  getEnv('PUBLIC_LEADERBOARD_API_URL') ||
  services.leaderboard?.api ||
  getDefaultLeaderboardUrl()

export const EXPLORER_URL =
  getEnv('PUBLIC_EXPLORER_URL') ||
  services.explorer?.url ||
  getDefaultExplorerUrl()

// Contract addresses - prefer PUBLIC_ env, fall back to config
const contracts = getContractsConfig(NETWORK)

export const CONTRACTS = {
  // Tokens
  jeju: parsePublicAddress(
    'PUBLIC_JEJU_TOKEN_ADDRESS',
    contracts.tokens?.JEJU as Address,
  ),
  usdc: parsePublicAddress(
    'PUBLIC_USDC_ADDRESS',
    contracts.tokens?.USDC as Address,
  ),
  weth: getAddress('0x4200000000000000000000000000000000000006'),

  // Registry
  identityRegistry: parsePublicAddress(
    'PUBLIC_IDENTITY_REGISTRY_ADDRESS',
    contracts.registry?.IdentityRegistry as Address,
  ),
  tokenRegistry: parsePublicAddress(
    'PUBLIC_TOKEN_REGISTRY_ADDRESS',
    contracts.registry?.TokenRegistry as Address,
  ),
  reputationRegistry: parsePublicAddress(
    'PUBLIC_REPUTATION_REGISTRY_ADDRESS',
    contracts.registry?.ReputationRegistry as Address,
  ),
  validationRegistry: parsePublicAddress(
    'PUBLIC_VALIDATION_REGISTRY_ADDRESS',
    contracts.registry?.ValidationRegistry as Address,
  ),

  // Moderation
  banManager: parsePublicAddress(
    'PUBLIC_BAN_MANAGER_ADDRESS',
    contracts.moderation?.BanManager as Address,
  ),
  moderationMarketplace: parsePublicAddress(
    'PUBLIC_MODERATION_MARKETPLACE_ADDRESS',
    contracts.moderation?.ModerationMarketplace as Address,
  ),
  reportingSystem: parsePublicAddress(
    'PUBLIC_REPORTING_SYSTEM_ADDRESS',
    contracts.moderation?.ReportingSystem as Address,
  ),
  reputationLabelManager: parsePublicAddress(
    'PUBLIC_REPUTATION_LABEL_MANAGER_ADDRESS',
    contracts.moderation?.ReputationLabelManager as Address,
  ),
  predimarket: parsePublicAddress('PUBLIC_PREDIMARKET_ADDRESS'),
  registryGovernance: parsePublicAddress(
    'PUBLIC_REGISTRY_GOVERNANCE_ADDRESS',
    contracts.registry?.RegistryGovernance as Address,
  ),

  // Node Staking
  nodeStakingManager: parsePublicAddress(
    'PUBLIC_NODE_STAKING_MANAGER_ADDRESS',
    contracts.nodeStaking?.NodeStakingManager as Address,
  ),
  nodePerformanceOracle: parsePublicAddress(
    'PUBLIC_NODE_PERFORMANCE_ORACLE_ADDRESS',
    contracts.nodeStaking?.NodePerformanceOracle as Address,
  ),
  rpcStaking: parsePublicAddress(
    'PUBLIC_RPC_STAKING_ADDRESS',
    contracts.nodeStaking?.RPCStaking as Address,
  ),

  // JNS
  jnsRegistry: parsePublicAddress(
    'PUBLIC_JNS_REGISTRY',
    contracts.jns?.JNSRegistry as Address,
  ),
  jnsResolver: parsePublicAddress(
    'PUBLIC_JNS_RESOLVER',
    contracts.jns?.PublicResolver as Address,
  ),
  jnsRegistrar: parsePublicAddress(
    'PUBLIC_JNS_REGISTRAR',
    contracts.jns?.JNSRegistrar as Address,
  ),
  jnsReverseRegistrar: parsePublicAddress(
    'PUBLIC_JNS_REVERSE_REGISTRAR',
    contracts.jns?.ReverseRegistrar as Address,
  ),

  // Payments
  paymasterFactory: parsePublicAddress(
    'PUBLIC_PAYMASTER_FACTORY_ADDRESS',
    contracts.payments?.PaymasterFactory as Address,
  ),
  priceOracle: parsePublicAddress(
    'PUBLIC_PRICE_ORACLE_ADDRESS',
    contracts.payments?.PriceOracle as Address,
  ),
  entryPoint: parsePublicAddress(
    'PUBLIC_ENTRY_POINT_ADDRESS',
    (contracts.payments?.EntryPoint as Address) ||
      getAddress('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'),
  ),
  x402Facilitator: parsePublicAddress(
    'PUBLIC_X402_FACILITATOR_ADDRESS',
    contracts.payments?.X402Facilitator as Address,
  ),

  // DeFi (Uniswap v4)
  poolManager: parsePublicAddress(
    'PUBLIC_POOL_MANAGER_ADDRESS',
    contracts.defi?.PoolManager as Address,
  ),
  swapRouter: parsePublicAddress(
    'PUBLIC_SWAP_ROUTER_ADDRESS',
    contracts.defi?.SwapRouter as Address,
  ),
  positionManager: parsePublicAddress(
    'PUBLIC_POSITION_MANAGER_ADDRESS',
    contracts.defi?.PositionManager as Address,
  ),
  quoterV4: parsePublicAddress(
    'PUBLIC_QUOTER_V4_ADDRESS',
    contracts.defi?.QuoterV4 as Address,
  ),
  stateView: parsePublicAddress(
    'PUBLIC_STATE_VIEW_ADDRESS',
    contracts.defi?.StateView as Address,
  ),

  // Compute
  computeRegistry: parsePublicAddress(
    'PUBLIC_COMPUTE_REGISTRY_ADDRESS',
    contracts.compute?.ComputeRegistry as Address,
  ),
  ledgerManager: parsePublicAddress(
    'PUBLIC_LEDGER_MANAGER_ADDRESS',
    contracts.compute?.LedgerManager as Address,
  ),
  inferenceServing: parsePublicAddress(
    'PUBLIC_INFERENCE_SERVING_ADDRESS',
    contracts.compute?.InferenceServing as Address,
  ),
  computeStaking: parsePublicAddress(
    'PUBLIC_COMPUTE_STAKING_ADDRESS',
    contracts.compute?.ComputeStaking as Address,
  ),

  // Storage
  fileStorageManager: parsePublicAddress(
    'PUBLIC_FILE_STORAGE_MANAGER_ADDRESS',
    contracts.storage?.FileStorageManager as Address,
  ),

  // Governance
  governor: parsePublicAddress(
    'PUBLIC_GOVERNOR_ADDRESS',
    contracts.governance?.Governor as Address,
  ),
  futarchyGovernor: parsePublicAddress(
    'PUBLIC_FUTARCHY_GOVERNOR_ADDRESS',
    contracts.governance?.FutarchyGovernor as Address,
  ),

  // OIF
  solverRegistry: parsePublicAddress('PUBLIC_OIF_SOLVER_REGISTRY'),
  inputSettler: {
    jeju: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_JEJU'),
    ethereum: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_ETHEREUM'),
    sepolia: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_SEPOLIA'),
    arbitrum: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_ARBITRUM'),
    optimism: parsePublicAddress('PUBLIC_OIF_INPUT_SETTLER_OPTIMISM'),
  },

  // EIL
  crossChainPaymaster: parsePublicAddress(
    'PUBLIC_CROSS_CHAIN_PAYMASTER_ADDRESS',
  ),

  // GitHub Reputation
  githubReputationProvider: parsePublicAddress(
    'PUBLIC_GITHUB_REPUTATION_PROVIDER_ADDRESS',
  ),

  // Oracle Network
  oracleNetworkConnector: parsePublicAddress(
    'PUBLIC_ORACLE_NETWORK_CONNECTOR_ADDRESS',
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
