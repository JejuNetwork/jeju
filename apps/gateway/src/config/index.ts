import type { Address } from 'viem';
import { ZERO_ADDRESS } from '../lib/contracts';

// Build-time network selection
export const NETWORK = (import.meta.env.VITE_NETWORK || 'localnet') as 'localnet' | 'testnet' | 'mainnet';

// Chain configuration
export const CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID || getDefaultChainId());
export const RPC_URL = import.meta.env.VITE_RPC_URL || import.meta.env.VITE_JEJU_RPC_URL || getDefaultRpcUrl();
export const WS_URL = import.meta.env.VITE_WS_URL || getDefaultWsUrl();

// External services
export const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || getDefaultIndexerUrl();
export const INDEXER_REST_URL = import.meta.env.VITE_INDEXER_REST_URL || getDefaultIndexerRestUrl();
export const INDEXER_A2A_URL = import.meta.env.VITE_INDEXER_A2A_URL || getDefaultIndexerA2AUrl();
export const INDEXER_MCP_URL = import.meta.env.VITE_INDEXER_MCP_URL || getDefaultIndexerMCPUrl();
export const RPC_GATEWAY_URL = import.meta.env.VITE_RPC_GATEWAY_URL || getDefaultRpcGatewayUrl();
export const IPFS_API_URL = import.meta.env.VITE_JEJU_IPFS_API || getDefaultIpfsApiUrl();
export const IPFS_GATEWAY_URL = import.meta.env.VITE_JEJU_IPFS_GATEWAY || getDefaultIpfsGatewayUrl();
export const OIF_AGGREGATOR_URL = import.meta.env.VITE_OIF_AGGREGATOR_URL || getDefaultOifAggregatorUrl();
export const LEADERBOARD_API_URL = import.meta.env.VITE_LEADERBOARD_API_URL || getDefaultLeaderboardUrl();
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || getDefaultExplorerUrl();

// Contract addresses - with VITE_ override support
const ZERO = ZERO_ADDRESS;

export const CONTRACTS = {
  // Tokens
  jeju: (import.meta.env.VITE_JEJU_TOKEN_ADDRESS || ZERO) as Address,
  elizaOS: (import.meta.env.VITE_ELIZAOS_TOKEN_ADDRESS || ZERO) as Address,
  usdc: (import.meta.env.VITE_USDC_ADDRESS || ZERO) as Address,
  weth: '0x4200000000000000000000000000000000000006' as Address,
  
  // Registry
  identityRegistry: (import.meta.env.VITE_IDENTITY_REGISTRY_ADDRESS || ZERO) as Address,
  tokenRegistry: (import.meta.env.VITE_TOKEN_REGISTRY_ADDRESS || ZERO) as Address,
  reputationRegistry: (import.meta.env.VITE_REPUTATION_REGISTRY_ADDRESS || ZERO) as Address,
  validationRegistry: (import.meta.env.VITE_VALIDATION_REGISTRY_ADDRESS || ZERO) as Address,
  
  // Moderation
  banManager: (import.meta.env.VITE_BAN_MANAGER_ADDRESS || ZERO) as Address,
  moderationMarketplace: (import.meta.env.VITE_MODERATION_MARKETPLACE_ADDRESS || ZERO) as Address,
  reportingSystem: (import.meta.env.VITE_REPORTING_SYSTEM_ADDRESS || ZERO) as Address,
  reputationLabelManager: (import.meta.env.VITE_REPUTATION_LABEL_MANAGER_ADDRESS || ZERO) as Address,
  predimarket: (import.meta.env.VITE_PREDIMARKET_ADDRESS || ZERO) as Address,
  registryGovernance: (import.meta.env.VITE_REGISTRY_GOVERNANCE_ADDRESS || ZERO) as Address,
  
  // Node Staking
  nodeStakingManager: (import.meta.env.VITE_NODE_STAKING_MANAGER_ADDRESS || ZERO) as Address,
  nodePerformanceOracle: (import.meta.env.VITE_NODE_PERFORMANCE_ORACLE_ADDRESS || ZERO) as Address,
  rpcStaking: (import.meta.env.VITE_RPC_STAKING_ADDRESS || ZERO) as Address,
  
  // JNS
  jnsRegistry: (import.meta.env.VITE_JNS_REGISTRY || ZERO) as Address,
  jnsResolver: (import.meta.env.VITE_JNS_RESOLVER || ZERO) as Address,
  jnsRegistrar: (import.meta.env.VITE_JNS_REGISTRAR || ZERO) as Address,
  jnsReverseRegistrar: (import.meta.env.VITE_JNS_REVERSE_REGISTRAR || ZERO) as Address,
  
  // Payments
  paymasterFactory: (import.meta.env.VITE_PAYMASTER_FACTORY_ADDRESS || ZERO) as Address,
  priceOracle: (import.meta.env.VITE_PRICE_ORACLE_ADDRESS || ZERO) as Address,
  entryPoint: (import.meta.env.VITE_ENTRY_POINT_ADDRESS || '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789') as Address,
  x402Facilitator: (import.meta.env.VITE_X402_FACILITATOR_ADDRESS || ZERO) as Address,
  
  // DeFi (Uniswap v4)
  poolManager: (import.meta.env.VITE_POOL_MANAGER_ADDRESS || ZERO) as Address,
  swapRouter: (import.meta.env.VITE_SWAP_ROUTER_ADDRESS || ZERO) as Address,
  positionManager: (import.meta.env.VITE_POSITION_MANAGER_ADDRESS || ZERO) as Address,
  quoterV4: (import.meta.env.VITE_QUOTER_V4_ADDRESS || ZERO) as Address,
  stateView: (import.meta.env.VITE_STATE_VIEW_ADDRESS || ZERO) as Address,
  
  // Compute
  computeRegistry: (import.meta.env.VITE_COMPUTE_REGISTRY_ADDRESS || ZERO) as Address,
  ledgerManager: (import.meta.env.VITE_LEDGER_MANAGER_ADDRESS || ZERO) as Address,
  inferenceServing: (import.meta.env.VITE_INFERENCE_SERVING_ADDRESS || ZERO) as Address,
  computeStaking: (import.meta.env.VITE_COMPUTE_STAKING_ADDRESS || ZERO) as Address,
  
  // Storage
  fileStorageManager: (import.meta.env.VITE_FILE_STORAGE_MANAGER_ADDRESS || ZERO) as Address,
  
  // Governance
  governor: (import.meta.env.VITE_GOVERNOR_ADDRESS || ZERO) as Address,
  futarchyGovernor: (import.meta.env.VITE_FUTARCHY_GOVERNOR_ADDRESS || ZERO) as Address,
  
  // OIF
  solverRegistry: (import.meta.env.VITE_OIF_SOLVER_REGISTRY || ZERO) as Address,
  inputSettler: {
    jeju: (import.meta.env.VITE_OIF_INPUT_SETTLER_JEJU || ZERO) as Address,
    ethereum: (import.meta.env.VITE_OIF_INPUT_SETTLER_ETHEREUM || ZERO) as Address,
    sepolia: (import.meta.env.VITE_OIF_INPUT_SETTLER_SEPOLIA || ZERO) as Address,
    arbitrum: (import.meta.env.VITE_OIF_INPUT_SETTLER_ARBITRUM || ZERO) as Address,
    optimism: (import.meta.env.VITE_OIF_INPUT_SETTLER_OPTIMISM || ZERO) as Address,
  },
  
  // EIL
  crossChainPaymaster: (import.meta.env.VITE_CROSS_CHAIN_PAYMASTER_ADDRESS || ZERO) as Address,
  
  // GitHub Reputation
  githubReputationProvider: (import.meta.env.VITE_GITHUB_REPUTATION_PROVIDER_ADDRESS || ZERO) as Address,
} as const;

// API keys (only ones that are actually public/client-safe)
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

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
    default: return 'http://127.0.0.1:9545';
  }
}

function getDefaultWsUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'wss://ws.jeju.network';
    case 'testnet': return 'wss://testnet-ws.jeju.network';
    default: return 'ws://127.0.0.1:9546';
  }
}

function getDefaultIndexerUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://indexer.jeju.network/graphql';
    case 'testnet': return 'https://testnet-indexer.jeju.network/graphql';
    default: return 'http://127.0.0.1:4350/graphql';
  }
}

function getDefaultIndexerRestUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://indexer.jeju.network/api';
    case 'testnet': return 'https://testnet-indexer.jeju.network/api';
    default: return 'http://127.0.0.1:4352/api';
  }
}

function getDefaultIndexerA2AUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://indexer.jeju.network/a2a';
    case 'testnet': return 'https://testnet-indexer.jeju.network/a2a';
    default: return 'http://127.0.0.1:4351/api/a2a';
  }
}

function getDefaultIndexerMCPUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://indexer.jeju.network/mcp';
    case 'testnet': return 'https://testnet-indexer.jeju.network/mcp';
    default: return 'http://127.0.0.1:4353';
  }
}

function getDefaultRpcGatewayUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://rpc-gateway.jeju.network';
    case 'testnet': return 'https://testnet-rpc-gateway.jeju.network';
    default: return 'http://127.0.0.1:4004';
  }
}

function getDefaultIpfsApiUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://storage.jeju.network';
    case 'testnet': return 'https://testnet-storage.jeju.network';
    default: return 'http://127.0.0.1:3100';
  }
}

function getDefaultIpfsGatewayUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://ipfs.jeju.network';
    case 'testnet': return 'https://testnet-ipfs.jeju.network';
    default: return 'http://127.0.0.1:3100';
  }
}

function getDefaultOifAggregatorUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://oif.jeju.network/api';
    case 'testnet': return 'https://testnet-oif.jeju.network/api';
    default: return 'http://127.0.0.1:4010/api';
  }
}

function getDefaultLeaderboardUrl(): string {
  switch (NETWORK) {
    case 'mainnet': 
    case 'testnet': return 'https://leaderboard.jeju.network';
    default: return 'http://127.0.0.1:4005';
  }
}

function getDefaultExplorerUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://explorer.jeju.network';
    case 'testnet': return 'https://testnet-explorer.jeju.network';
    default: return 'http://127.0.0.1:4000';
  }
}
