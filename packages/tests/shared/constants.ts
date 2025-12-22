/**
 * Shared constants for network testing
 *
 * Port assignments imported from packages/config/ports.ts (single source of truth)
 * RPC URLs use 127.0.0.1 for consistency across the codebase
 */

// Import ports from central config
import {
  INFRA_PORTS as CONFIG_INFRA_PORTS,
  CORE_PORTS,
  getCoreAppUrl,
  getL1RpcUrl,
  getL2RpcUrl,
  getL2WsUrl,
} from '../../config/ports'
// Import canonical test accounts from utils (single source of truth)
import { SEED_PHRASE, TEST_ACCOUNTS } from './utils'

// ============================================================================
// Infrastructure Ports (re-exported for backward compatibility)
// ============================================================================

export const INFRA_PORTS = {
  l1Rpc: CONFIG_INFRA_PORTS.L1_RPC.get(),
  l2Rpc: CONFIG_INFRA_PORTS.L2_RPC.get(),
  l2Ws: CONFIG_INFRA_PORTS.L2_WS.get(),
  prometheus: CONFIG_INFRA_PORTS.PROMETHEUS.get(),
  grafana: CONFIG_INFRA_PORTS.GRAFANA.get(),
} as const

// ============================================================================
// Network Configuration
// ============================================================================

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
// Test Wallets (Anvil defaults) - Using canonical values from utils
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
// App Ports (derived from central config CORE_PORTS)
// ============================================================================

export const APP_PORTS = {
  gateway: CORE_PORTS.GATEWAY.get(),
  nodeExplorerApi: CORE_PORTS.NODE_EXPLORER_API.get(),
  nodeExplorerUi: CORE_PORTS.NODE_EXPLORER_UI.get(),
  documentation: CORE_PORTS.DOCUMENTATION.get(),
  predimarket: CORE_PORTS.PREDIMARKET.get(),
  bazaar: CORE_PORTS.BAZAAR.get(),
  compute: CORE_PORTS.COMPUTE.get(),
  computeNodeApi: CORE_PORTS.COMPUTE_NODE_API.get(),
  ipfs: CORE_PORTS.IPFS.get(),
  ipfsNode: CORE_PORTS.IPFS_NODE.get(),
  facilitator: CORE_PORTS.FACILITATOR.get(),
  // Indexer services (4350-4399 range)
  indexerGraphQL: CORE_PORTS.INDEXER_GRAPHQL.get(),
  indexerA2A: 4351, // Not in CORE_PORTS, keep hardcoded for now
  indexerRest: 4352,
  indexerMcp: 4353,
  indexerDatabase: CORE_PORTS.INDEXER_DATABASE.get(),
} as const

// ============================================================================
// App URLs (computed from centralized config)
// ============================================================================

const HOST = process.env.HOST || '127.0.0.1'

export const APP_URLS = {
  gateway: getCoreAppUrl('GATEWAY'),
  nodeExplorerApi: getCoreAppUrl('NODE_EXPLORER_API'),
  nodeExplorerUi: getCoreAppUrl('NODE_EXPLORER_UI'),
  documentation: getCoreAppUrl('DOCUMENTATION'),
  predimarket: getCoreAppUrl('PREDIMARKET'),
  bazaar: getCoreAppUrl('BAZAAR'),
  compute: getCoreAppUrl('COMPUTE'),
  computeNodeApi: getCoreAppUrl('COMPUTE_NODE_API'),
  ipfs: getCoreAppUrl('IPFS'),
  ipfsNode: getCoreAppUrl('IPFS_NODE'),
  facilitator: getCoreAppUrl('FACILITATOR'),
  // Indexer - use getCoreAppUrl for GraphQL, keep hardcoded for extras
  indexerGraphQL:
    process.env.INDEXER_GRAPHQL_URL ||
    `${getCoreAppUrl('INDEXER_GRAPHQL')}/graphql`,
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
