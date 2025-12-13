/** @jejunetwork/tests - Shared E2E test utilities */

// Synpress
export {
  test, expect, basicSetup, walletPassword,
  connectAndVerify, verifyAuth, isAuthenticated, verifyDisconnected,
  connectWallet, approveTransaction, signMessage, rejectTransaction,
  switchNetwork, getWalletAddress, verifyWalletConnected,
} from './fixtures/synpress-wallet';

export {
  createJejuSynpressConfig, createJejuWalletSetup, createSmokeTestConfig,
  SEED_PHRASE, PASSWORD, TEST_WALLET_ADDRESS,
  JEJU_CHAIN_ID, JEJU_RPC_URL, SYNPRESS_CACHE_DIR,
  GLOBAL_SETUP_PATH, GLOBAL_TEARDOWN_PATH,
} from './synpress.config.base';

// Test infrastructure
export { LockManager, withTestLock, type LockMetadata, type LockManagerOptions } from './lock-manager';
export { runPreflightChecks, quickHealthCheck, waitForChain, type PreflightConfig, type PreflightResult, type PreflightCheck } from './preflight';
export { warmupApps, quickWarmup, discoverAppsForWarmup, type AppConfig, type WarmupOptions, type WarmupResult, type AppWarmupResult } from './warmup';
export { default as globalSetup, globalTeardown, setupTestEnvironment } from './global-setup';

// Helpers
export * from './fixtures/wallet';
export * from './helpers/contracts';
export * from './helpers/screenshots';
export * from './helpers/navigation';
export * from './helpers/error-detection';
export * from './helpers/on-chain';
export * from './constants';
