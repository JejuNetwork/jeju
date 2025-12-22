/** @jejunetwork/tests - Shared E2E test utilities */

// Bun test infrastructure
export {
  getStatus as getBunStatus,
  isReady as isBunReady,
  setup as bunSetup,
  teardown as bunTeardown,
} from './bun-global-setup'
export * from './constants'
// Dev startup
export { cleanup as devCleanup, ensureInfra } from './dev-startup'
// Synpress
export {
  approveTransaction,
  basicSetup,
  connectAndVerify,
  connectWallet,
  expect,
  getWalletAddress,
  isAuthenticated,
  rejectTransaction,
  signMessage,
  switchNetwork,
  test,
  verifyAuth,
  verifyDisconnected,
  verifyWalletConnected,
  walletPassword,
} from './fixtures/synpress-wallet'
// Helpers
export * from './fixtures/wallet'
export { default as globalSetup, setupTestEnvironment } from './global-setup'
export * from './helpers/contracts'
export * from './helpers/error-detection'
export * from './helpers/navigation'
export * from './helpers/on-chain'
export * from './helpers/screenshots'
// Test infrastructure
export { LockManager, withTestLock } from './lock-manager'
// Playwright config
export {
  type AppConfigOptions,
  createAppConfig,
  createPlaywrightConfig,
} from './playwright.config.base'
export { quickHealthCheck, runPreflightChecks, waitForChain } from './preflight'
// Schemas - Zod validation for external data
export * from './schemas'
export {
  createSmokeTestConfig,
  createSynpressConfig,
  createWalletSetup,
  GLOBAL_SETUP_PATH,
  GLOBAL_TEARDOWN_PATH,
  SYNPRESS_CACHE_DIR,
  type SynpressConfigOptions,
  type WalletSetupOptions,
  type WalletSetupResult,
} from './synpress.config.base'
// Shared utilities
export {
  checkContractsDeployed,
  checkRpcHealth,
  checkServiceHealth,
  // Utilities
  findJejuWorkspaceRoot,
  getChainId,
  getRpcUrl,
  getTestEnv,
  isRpcAvailable,
  isServiceAvailable,
  JEJU_CHAIN,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  PASSWORD,
  // Constants (canonical source)
  SEED_PHRASE,
  TEST_ACCOUNTS,
  TEST_WALLET_ADDRESS,
  waitForRpc,
  waitForService,
} from './utils'
export { discoverAppsForWarmup, quickWarmup, warmupApps } from './warmup'
