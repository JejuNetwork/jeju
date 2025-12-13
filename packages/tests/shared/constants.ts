/**
 * Shared constants for Jeju testing
 * 
 * Port assignments aligned with packages/config/ports.ts
 * RPC URLs use 127.0.0.1 for consistency across the codebase
 */

// ============================================================================
// Infrastructure Ports
// ============================================================================

export const INFRA_PORTS = {
  l1Rpc: 8545,
  l2Rpc: 9545,
  l2Ws: 9546,
  prometheus: 9090,
  grafana: 4010,
} as const;

// ============================================================================
// Network Configuration
// ============================================================================

export const JEJU_LOCALNET = {
  chainId: 1337,
  name: 'Jeju Localnet',
  rpcUrl: process.env.JEJU_RPC_URL || process.env.L2_RPC_URL || `http://127.0.0.1:${process.env.L2_RPC_PORT || INFRA_PORTS.l2Rpc}`,
  wsUrl: process.env.L2_WS_URL || `ws://127.0.0.1:${process.env.L2_WS_PORT || INFRA_PORTS.l2Ws}`,
} as const;

export const L1_LOCALNET = {
  chainId: 1337,
  name: 'L1 Localnet',
  rpcUrl: process.env.L1_RPC_URL || `http://127.0.0.1:${process.env.L1_RPC_PORT || INFRA_PORTS.l1Rpc}`,
} as const;

// ============================================================================
// Test Wallets (Hardhat/Anvil defaults)
// ============================================================================

export const DEFAULT_TEST_WALLET = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  seed: 'test test test test test test test test test test test junk',
} as const;

export const TEST_WALLETS = {
  deployer: DEFAULT_TEST_WALLET,
  user1: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  user2: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
} as const;

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
} as const;

// ============================================================================
// App URLs
// ============================================================================

const HOST = process.env.HOST || '127.0.0.1';

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
  indexerGraphQL: process.env.INDEXER_GRAPHQL_URL || `http://${HOST}:${process.env.INDEXER_GRAPHQL_PORT || APP_PORTS.indexerGraphQL}/graphql`,
  indexerA2A: `http://${HOST}:${APP_PORTS.indexerA2A}`,
  indexerRest: `http://${HOST}:${APP_PORTS.indexerRest}`,
  indexerMcp: `http://${HOST}:${APP_PORTS.indexerMcp}`,
} as const;

// ============================================================================
// Test Timeouts
// ============================================================================

export const TIMEOUTS = {
  transaction: 60000,   // 60s for transaction confirmation
  pageLoad: 15000,      // 15s for page load
  wallet: 10000,        // 10s for wallet operations
  bridge: 120000,       // 2min for bridge operations
  rpcResponse: 1000,    // 1s for RPC response
  indexerSync: 30000,   // 30s for indexer to sync
  blockProduction: 5000, // 5s for block to be produced
} as const;

// ============================================================================
// OP-Stack Predeploy Addresses
// ============================================================================

export const OP_PREDEPLOYS = {
  L2StandardBridge: '0x4200000000000000000000000000000000000010',
  L2CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
  WETH: '0x4200000000000000000000000000000000000006',
  GasPriceOracle: '0x420000000000000000000000000000000000000F',
  L1Block: '0x4200000000000000000000000000000000000015',
} as const;
