import { CORE_PORTS, INFRA_PORTS } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { type Address, getAddress, isAddress } from 'viem'

/** Parse a VITE env var as an Address with fallback */
function parseViteAddress(
  envVar: string | undefined,
  fallback: Address = ZERO_ADDRESS,
): Address {
  if (!envVar) return fallback
  return isAddress(envVar) ? getAddress(envVar) : fallback
}

// Build-time network selection
export const NETWORK = (import.meta.env.VITE_NETWORK || 'localnet') as
  | 'localnet'
  | 'testnet'
  | 'mainnet'

// Chain configuration
export const CHAIN_ID = parseInt(
  import.meta.env.VITE_CHAIN_ID || getDefaultChainId(),
  10,
)
export const RPC_URL =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_JEJU_RPC_URL ||
  getDefaultRpcUrl()
export const WS_URL = import.meta.env.VITE_WS_URL || getDefaultWsUrl()

// External services
export const OAUTH3_AGENT_URL =
  import.meta.env.VITE_OAUTH3_AGENT_URL || getDefaultOAuth3AgentUrl()
export const INDEXER_URL =
  import.meta.env.VITE_INDEXER_URL || getDefaultIndexerUrl()
export const INDEXER_REST_URL =
  import.meta.env.VITE_INDEXER_REST_URL || getDefaultIndexerRestUrl()
export const INDEXER_A2A_URL =
  import.meta.env.VITE_INDEXER_A2A_URL || getDefaultIndexerA2AUrl()
export const INDEXER_MCP_URL =
  import.meta.env.VITE_INDEXER_MCP_URL || getDefaultIndexerMCPUrl()
export const RPC_GATEWAY_URL =
  import.meta.env.VITE_RPC_GATEWAY_URL || getDefaultRpcGatewayUrl()
export const IPFS_API_URL =
  import.meta.env.VITE_JEJU_IPFS_API || getDefaultIpfsApiUrl()
export const IPFS_GATEWAY_URL =
  import.meta.env.VITE_JEJU_IPFS_GATEWAY || getDefaultIpfsGatewayUrl()
export const OIF_AGGREGATOR_URL =
  import.meta.env.VITE_OIF_AGGREGATOR_URL || getDefaultOifAggregatorUrl()
export const LEADERBOARD_API_URL =
  import.meta.env.VITE_LEADERBOARD_API_URL || getDefaultLeaderboardUrl()
export const EXPLORER_URL =
  import.meta.env.VITE_EXPLORER_URL || getDefaultExplorerUrl()

// Contract addresses - with VITE_ override support
export const CONTRACTS = {
  // Tokens
  jeju: parseViteAddress(import.meta.env.VITE_JEJU_TOKEN_ADDRESS),
  usdc: parseViteAddress(import.meta.env.VITE_USDC_ADDRESS),
  weth: getAddress('0x4200000000000000000000000000000000000006'),

  // Registry
  identityRegistry: parseViteAddress(
    import.meta.env.VITE_IDENTITY_REGISTRY_ADDRESS,
  ),
  tokenRegistry: parseViteAddress(import.meta.env.VITE_TOKEN_REGISTRY_ADDRESS),
  reputationRegistry: parseViteAddress(
    import.meta.env.VITE_REPUTATION_REGISTRY_ADDRESS,
  ),
  validationRegistry: parseViteAddress(
    import.meta.env.VITE_VALIDATION_REGISTRY_ADDRESS,
  ),

  // Moderation
  banManager: parseViteAddress(import.meta.env.VITE_BAN_MANAGER_ADDRESS),
  moderationMarketplace: parseViteAddress(
    import.meta.env.VITE_MODERATION_MARKETPLACE_ADDRESS,
  ),
  reportingSystem: parseViteAddress(
    import.meta.env.VITE_REPORTING_SYSTEM_ADDRESS,
  ),
  reputationLabelManager: parseViteAddress(
    import.meta.env.VITE_REPUTATION_LABEL_MANAGER_ADDRESS,
  ),
  predimarket: parseViteAddress(import.meta.env.VITE_PREDIMARKET_ADDRESS),
  registryGovernance: parseViteAddress(
    import.meta.env.VITE_REGISTRY_GOVERNANCE_ADDRESS,
  ),

  // Node Staking
  nodeStakingManager: parseViteAddress(
    import.meta.env.VITE_NODE_STAKING_MANAGER_ADDRESS,
  ),
  nodePerformanceOracle: parseViteAddress(
    import.meta.env.VITE_NODE_PERFORMANCE_ORACLE_ADDRESS,
  ),
  rpcStaking: parseViteAddress(import.meta.env.VITE_RPC_STAKING_ADDRESS),

  // JNS
  jnsRegistry: parseViteAddress(import.meta.env.VITE_JNS_REGISTRY),
  jnsResolver: parseViteAddress(import.meta.env.VITE_JNS_RESOLVER),
  jnsRegistrar: parseViteAddress(import.meta.env.VITE_JNS_REGISTRAR),
  jnsReverseRegistrar: parseViteAddress(
    import.meta.env.VITE_JNS_REVERSE_REGISTRAR,
  ),

  // Payments
  paymasterFactory: parseViteAddress(
    import.meta.env.VITE_PAYMASTER_FACTORY_ADDRESS,
  ),
  priceOracle: parseViteAddress(import.meta.env.VITE_PRICE_ORACLE_ADDRESS),
  entryPoint: parseViteAddress(
    import.meta.env.VITE_ENTRY_POINT_ADDRESS,
    getAddress('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'),
  ),
  x402Facilitator: parseViteAddress(
    import.meta.env.VITE_X402_FACILITATOR_ADDRESS,
  ),

  // DeFi (Uniswap v4)
  poolManager: parseViteAddress(import.meta.env.VITE_POOL_MANAGER_ADDRESS),
  swapRouter: parseViteAddress(import.meta.env.VITE_SWAP_ROUTER_ADDRESS),
  positionManager: parseViteAddress(
    import.meta.env.VITE_POSITION_MANAGER_ADDRESS,
  ),
  quoterV4: parseViteAddress(import.meta.env.VITE_QUOTER_V4_ADDRESS),
  stateView: parseViteAddress(import.meta.env.VITE_STATE_VIEW_ADDRESS),

  // Compute
  computeRegistry: parseViteAddress(
    import.meta.env.VITE_COMPUTE_REGISTRY_ADDRESS,
  ),
  ledgerManager: parseViteAddress(import.meta.env.VITE_LEDGER_MANAGER_ADDRESS),
  inferenceServing: parseViteAddress(
    import.meta.env.VITE_INFERENCE_SERVING_ADDRESS,
  ),
  computeStaking: parseViteAddress(
    import.meta.env.VITE_COMPUTE_STAKING_ADDRESS,
  ),

  // Storage
  fileStorageManager: parseViteAddress(
    import.meta.env.VITE_FILE_STORAGE_MANAGER_ADDRESS,
  ),

  // Governance
  governor: parseViteAddress(import.meta.env.VITE_GOVERNOR_ADDRESS),
  futarchyGovernor: parseViteAddress(
    import.meta.env.VITE_FUTARCHY_GOVERNOR_ADDRESS,
  ),

  // OIF
  solverRegistry: parseViteAddress(import.meta.env.VITE_OIF_SOLVER_REGISTRY),
  inputSettler: {
    jeju: parseViteAddress(import.meta.env.VITE_OIF_INPUT_SETTLER_JEJU),
    ethereum: parseViteAddress(import.meta.env.VITE_OIF_INPUT_SETTLER_ETHEREUM),
    sepolia: parseViteAddress(import.meta.env.VITE_OIF_INPUT_SETTLER_SEPOLIA),
    arbitrum: parseViteAddress(import.meta.env.VITE_OIF_INPUT_SETTLER_ARBITRUM),
    optimism: parseViteAddress(import.meta.env.VITE_OIF_INPUT_SETTLER_OPTIMISM),
  },

  // EIL
  crossChainPaymaster: parseViteAddress(
    import.meta.env.VITE_CROSS_CHAIN_PAYMASTER_ADDRESS,
  ),

  // GitHub Reputation
  githubReputationProvider: parseViteAddress(
    import.meta.env.VITE_GITHUB_REPUTATION_PROVIDER_ADDRESS,
  ),

  // Oracle Network
  oracleNetworkConnector: parseViteAddress(
    import.meta.env.VITE_ORACLE_NETWORK_CONNECTOR_ADDRESS,
  ),
} as const

// API keys (only ones that are actually public/client-safe)
export const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID'

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
      return `http://127.0.0.1:${INFRA_PORTS.L2_RPC.DEFAULT}`
  }
}

function getDefaultWsUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'wss://ws.jejunetwork.org'
    case 'testnet':
      return 'wss://testnet-ws.jejunetwork.org'
    default:
      return `ws://127.0.0.1:${INFRA_PORTS.L2_WS.DEFAULT}`
  }
}

function getDefaultIndexerUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://indexer.jejunetwork.org/graphql'
    case 'testnet':
      return 'https://testnet-indexer.jejunetwork.org/graphql'
    default:
      return `http://127.0.0.1:${CORE_PORTS.INDEXER_GRAPHQL.DEFAULT}/graphql`
  }
}

function getDefaultIndexerRestUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://indexer.jejunetwork.org/api'
    case 'testnet':
      return 'https://testnet-indexer.jejunetwork.org/api'
    default:
      return `http://127.0.0.1:${CORE_PORTS.INDEXER_REST.DEFAULT}/api`
  }
}

function getDefaultIndexerA2AUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://indexer.jejunetwork.org/a2a'
    case 'testnet':
      return 'https://testnet-indexer.jejunetwork.org/a2a'
    default:
      return `http://127.0.0.1:${CORE_PORTS.INDEXER_A2A.DEFAULT}/api/a2a`
  }
}

function getDefaultIndexerMCPUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://indexer.jejunetwork.org/mcp'
    case 'testnet':
      return 'https://testnet-indexer.jejunetwork.org/mcp'
    default:
      return `http://127.0.0.1:${CORE_PORTS.INDEXER_MCP.DEFAULT}`
  }
}

function getDefaultRpcGatewayUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://rpc-gateway.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-rpc-gateway.jejunetwork.org'
    default:
      return `http://127.0.0.1:${CORE_PORTS.RPC_GATEWAY.DEFAULT}`
  }
}

function getDefaultIpfsApiUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://storage.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-storage.jejunetwork.org'
    default:
      return `http://127.0.0.1:${CORE_PORTS.IPFS.DEFAULT}`
  }
}

function getDefaultIpfsGatewayUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://ipfs.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-ipfs.jejunetwork.org'
    default:
      return `http://127.0.0.1:${CORE_PORTS.IPFS.DEFAULT}`
  }
}

function getDefaultOifAggregatorUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://oif.jejunetwork.org/api'
    case 'testnet':
      return 'https://testnet-oif.jejunetwork.org/api'
    default:
      return `http://127.0.0.1:${CORE_PORTS.OIF_AGGREGATOR.DEFAULT}/api`
  }
}

function getDefaultLeaderboardUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
    case 'testnet':
      return 'https://leaderboard.jejunetwork.org'
    default:
      return `http://127.0.0.1:${CORE_PORTS.LEADERBOARD_API.DEFAULT}`
  }
}

function getDefaultExplorerUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://explorer.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-explorer.jejunetwork.org'
    default:
      return `http://127.0.0.1:${CORE_PORTS.EXPLORER.DEFAULT}`
  }
}

function getDefaultOAuth3AgentUrl(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'https://auth.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-auth.jejunetwork.org'
    default:
      return `http://127.0.0.1:${CORE_PORTS.OAUTH3_API.DEFAULT}`
  }
}
