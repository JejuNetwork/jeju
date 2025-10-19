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
  predimarket: 4005,
  bazaar: 4006,
  gateway: 5173,
  ehorse: 5700,
  leaderboard: 3000,
  documentation: 4004,
};

// App URLs
export const APP_URLS = {
  predimarket: `http://localhost:${APP_PORTS.predimarket}`,
  bazaar: `http://localhost:${APP_PORTS.bazaar}`,
  gateway: `http://localhost:${APP_PORTS.gateway}`,
  ehorse: `http://localhost:${APP_PORTS.ehorse}`,
};

// Test timeouts
export const TIMEOUTS = {
  transaction: 60000, // 60s for transaction confirmation
  pageLoad: 15000, // 15s for page load
  wallet: 10000, // 10s for wallet operations
  bridge: 120000, // 2min for bridge operations
};
