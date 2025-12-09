/**
 * Shared constants for Jeju testing
 */

// Network configuration
export const JEJU_LOCALNET = {
  chainId: 1337,
  name: 'Jeju Localnet',
  rpcUrl: 'http://localhost:9545',
};

// Test wallet (Hardhat/Anvil default)
export const DEFAULT_TEST_WALLET = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  seed: 'test test test test test test test test test test test junk',
};

// App ports
export const APP_PORTS = {
  gateway: 4001,
  documentation: 3002,
  bazaar: 4006,
  compute: 4007,
  storage: 4100,
  intents: 4010,
  intentsViewer: 4011,
  indexer: 4351,
};

// App URLs
export const APP_URLS = {
  gateway: `http://localhost:${APP_PORTS.gateway}`,
  documentation: `http://localhost:${APP_PORTS.documentation}`,
  bazaar: `http://localhost:${APP_PORTS.bazaar}`,
  compute: `http://localhost:${APP_PORTS.compute}`,
  storage: `http://localhost:${APP_PORTS.storage}`,
  intents: `http://localhost:${APP_PORTS.intents}`,
  intentsViewer: `http://localhost:${APP_PORTS.intentsViewer}`,
  indexer: `http://localhost:${APP_PORTS.indexer}`,
};

// Test timeouts
export const TIMEOUTS = {
  transaction: 60000, // 60s for transaction confirmation
  pageLoad: 15000, // 15s for page load
  wallet: 10000, // 10s for wallet operations
  bridge: 120000, // 2min for bridge operations
};
