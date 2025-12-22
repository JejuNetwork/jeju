/** @jejunetwork/tests - Shared E2E test utilities */

// Schemas - Zod validation for external data
export * from './schemas';

// Shared utilities - DRY consolidated code
export {
  // Constants (canonical source)
  SEED_PHRASE,
  PASSWORD,
  TEST_WALLET_ADDRESS,
  TEST_ACCOUNTS,
  JEJU_CHAIN,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  // Utilities
  findJejuWorkspaceRoot,
  checkRpcHealth,
  isRpcAvailable,
  checkContractsDeployed,
  checkServiceHealth,
  isServiceAvailable,
  waitForRpc,
  waitForService,
  getRpcUrl,
  getChainId,
  getTestEnv,
} from './utils';

// Synpress
export {
  test, expect, basicSetup, walletPassword,
  connectAndVerify, verifyAuth, isAuthenticated, verifyDisconnected,
  connectWallet, approveTransaction, signMessage, rejectTransaction,
  switchNetwork, getWalletAddress, verifyWalletConnected,
} from './fixtures/synpress-wallet';

export {
  createSynpressConfig, createWalletSetup, createSmokeTestConfig,
  SYNPRESS_CACHE_DIR, GLOBAL_SETUP_PATH, GLOBAL_TEARDOWN_PATH,
  type SynpressConfigOptions, type WalletSetupOptions, type WalletSetupResult,
} from './synpress.config.base';

// Playwright config
export {
  createAppConfig,
  createPlaywrightConfig,
  type AppConfigOptions,
} from './playwright.config.base';

// Test infrastructure
export { LockManager, withTestLock } from './lock-manager';
export { runPreflightChecks, quickHealthCheck, waitForChain } from './preflight';
export { warmupApps, quickWarmup, discoverAppsForWarmup } from './warmup';
export { default as globalSetup, setupTestEnvironment } from './global-setup';

// Bun test infrastructure
export {
  setup as bunSetup,
  teardown as bunTeardown,
  getStatus as getBunStatus,
  isReady as isBunReady,
} from './bun-global-setup';

// Dev startup
export { ensureInfra, cleanup as devCleanup } from './dev-startup';

// OAuth3 TEE test server (uses real DstackAuthAgent in simulated TEE mode)
export {
  startOAuth3TestServer,
  stopOAuth3TestServer,
  getOAuth3TestServerUrl,
  getOAuth3TestAgent,
  // Legacy aliases for backwards compatibility
  startMockOAuth3Server,
  stopMockOAuth3Server,
  getMockOAuth3Url,
  clearMockOAuth3State,
  type OAuth3TestServerConfig,
} from './mock-oauth3-server';

// Helpers
export * from './fixtures/wallet';
export * from './helpers/contracts';
export * from './helpers/screenshots';
export * from './helpers/navigation';
export * from './helpers/error-detection';
export * from './helpers/on-chain';
export * from './constants';
