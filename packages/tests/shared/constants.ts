/**
 * Shared constants for network testing
 *
 * Port assignments aligned with packages/config/ports.ts
 * RPC URLs use 127.0.0.1 for consistency across the codebase
 */

// Import canonical test accounts from utils (single source of truth)
import { SEED_PHRASE, TEST_ACCOUNTS, TEST_WALLET_ADDRESS } from './utils'

// Re-export for backwards compatibility
export { TEST_ACCOUNTS, SEED_PHRASE, TEST_WALLET_ADDRESS }

// ============================================================================
// Infrastructure Ports
// ============================================================================

export const INFRA_PORTS = {
  l1Rpc: 6545,
  l2Rpc: 6546,
  l2Ws: 6547,
  prometheus: 9090,
  grafana: 4010,
} as const

// ============================================================================
// Network Configuration
// ============================================================================

function getL2RpcUrl(): string {
  const envUrl = process.env.JEJU_RPC_URL ?? process.env.L2_RPC_URL
  if (envUrl) return envUrl
  const port = process.env.L2_RPC_PORT ?? String(INFRA_PORTS.l2Rpc)
  return `http://127.0.0.1:${port}`
}

function getL2WsUrl(): string {
  const envUrl = process.env.L2_WS_URL
  if (envUrl) return envUrl
  const port = process.env.L2_WS_PORT ?? String(INFRA_PORTS.l2Ws)
  return `ws://127.0.0.1:${port}`
}

function getL1RpcUrl(): string {
  const envUrl = process.env.L1_RPC_URL
  if (envUrl) return envUrl
  const port = process.env.L1_RPC_PORT ?? String(INFRA_PORTS.l1Rpc)
  return `http://127.0.0.1:${port}`
}

export const JEJU_LOCALNET = {
  chainId: 1337,
  name: 'Localnet',
  rpcUrl: getL2RpcUrl(),
  wsUrl: getL2WsUrl(),
} as const

export const L1_LOCALNET = {
  chainId: 1337,
  name: 'L1 Localnet',
  rpcUrl: getL1RpcUrl(),
} as const

// ============================================================================
// Test Wallets (Anvil defaults) - Re-exported from utils for backwards compat
// ============================================================================

export const DEFAULT_TEST_WALLET = {
  address: TEST_ACCOUNTS.deployer.address,
  privateKey: TEST_ACCOUNTS.deployer.privateKey,
  seed: SEED_PHRASE,
} as const

export const TEST_WALLETS = {
  deployer: DEFAULT_TEST_WALLET,
  user1: TEST_ACCOUNTS.user1,
  user2: TEST_ACCOUNTS.user2,
} as const

// ============================================================================
// App Ports (aligned with packages/config/ports.ts)
// ============================================================================

export const APP_PORTS = {
  gateway: 4001,
  nodeExplorerApi: 4002,
  nodeExplorerUi: 4003,
  documentation: 4004,
  predimarket: 4005,
  bazaar: 4006,
  compute: 4007,
  computeNodeApi: 4008,
  ipfs: 3100,
  ipfsNode: 4100,
  facilitator: 3402,
  // Indexer services (4350-4399 range)
  indexerGraphQL: 4350,
  indexerA2A: 4351,
  indexerRest: 4352,
  indexerMcp: 4353,
  indexerDatabase: 23798,
} as const

// ============================================================================
// App URLs
// ============================================================================

const HOST = process.env.HOST || '127.0.0.1'

export const APP_URLS = {
  gateway: `http://${HOST}:${APP_PORTS.gateway}`,
  nodeExplorerApi: `http://${HOST}:${APP_PORTS.nodeExplorerApi}`,
  nodeExplorerUi: `http://${HOST}:${APP_PORTS.nodeExplorerUi}`,
  documentation: `http://${HOST}:${APP_PORTS.documentation}`,
  predimarket: `http://${HOST}:${APP_PORTS.predimarket}`,
  bazaar: `http://${HOST}:${APP_PORTS.bazaar}`,
  compute: `http://${HOST}:${APP_PORTS.compute}`,
  computeNodeApi: `http://${HOST}:${APP_PORTS.computeNodeApi}`,
  ipfs: `http://${HOST}:${APP_PORTS.ipfs}`,
  ipfsNode: `http://${HOST}:${APP_PORTS.ipfsNode}`,
  facilitator: `http://${HOST}:${APP_PORTS.facilitator}`,
  // Indexer
  indexerGraphQL:
    process.env.INDEXER_GRAPHQL_URL ||
    `http://${HOST}:${process.env.INDEXER_GRAPHQL_PORT || APP_PORTS.indexerGraphQL}/graphql`,
  indexerA2A: `http://${HOST}:${APP_PORTS.indexerA2A}`,
  indexerRest: `http://${HOST}:${APP_PORTS.indexerRest}`,
  indexerMcp: `http://${HOST}:${APP_PORTS.indexerMcp}`,
} as const

// ============================================================================
// Test Timeouts
// ============================================================================

export const TIMEOUTS = {
  transaction: 60000, // 60s for transaction confirmation
  pageLoad: 15000, // 15s for page load
  wallet: 10000, // 10s for wallet operations
  bridge: 120000, // 2min for bridge operations
  rpcResponse: 1000, // 1s for RPC response
  indexerSync: 30000, // 30s for indexer to sync
  blockProduction: 5000, // 5s for block to be produced
} as const

// ============================================================================
// OP-Stack Predeploy Addresses
// ============================================================================

export const OP_PREDEPLOYS = {
  L2StandardBridge: '0x4200000000000000000000000000000000000010',
  L2CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
  WETH: '0x4200000000000000000000000000000000000006',
  GasPriceOracle: '0x420000000000000000000000000000000000000F',
  L1Block: '0x4200000000000000000000000000000000000015',
} as const
