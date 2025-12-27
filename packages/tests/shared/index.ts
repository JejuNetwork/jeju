/**
 * @jejunetwork/tests - Shared E2E Test Utilities
 *
 * Comprehensive testing infrastructure for Jeju Network apps including:
 * - Wallet testing (Synpress/MetaMask + Dappwright)
 * - OAuth3 authentication helpers
 * - React Query test utilities
 * - Navigation and page helpers
 * - On-chain verification
 * - Test data constants (viewports, timeouts, selectors)
 *
 * @module @jejunetwork/tests
 */

// ============================================================================
// Core Playwright/Bun Exports
// ============================================================================

// Import expect from @playwright/test directly for Playwright tests
export { expect } from '@playwright/test'

// Bun test infrastructure
export {
  getStatus as getBunStatus,
  isReady as isBunReady,
  setup as bunSetup,
  teardown as bunTeardown,
} from './bun-global-setup'

export * from './constants'

// ============================================================================
// Infrastructure & Setup
// ============================================================================

// Dev startup
export { cleanup as devCleanup, ensureInfra } from './dev-startup'

// Global setup
export { default as globalSetup, setupTestEnvironment } from './global-setup'

// Test infrastructure
export { LockManager, withTestLock } from './lock-manager'

// Preflight checks
export { quickHealthCheck, runPreflightChecks, waitForChain } from './preflight'

// App warmup
export { discoverAppsForWarmup, quickWarmup, warmupApps } from './warmup'

// ============================================================================
// Synpress Wallet Testing (MetaMask)
// ============================================================================

export {
  approveTransaction,
  basicSetup,
  connectAndVerify,
  connectWallet,
  getWalletAddress,
  isAuthenticated,
  rejectTransaction,
  signMessage,
  switchNetwork,
  test,
  verifyAuth,
  verifyDisconnected,
  walletPassword,
} from './fixtures/synpress-wallet'

// ============================================================================
// Fixtures
// ============================================================================

// React Query test utilities
export {
  createQueryWrapper,
  createTestQueryClient,
  invalidateAndWait,
  QueryClient,
  QueryClientProvider,
  TestQueryProvider,
  waitForQueriesToSettle,
} from './fixtures/react-query'
// Dappwright wallet fixtures
export * from './fixtures/wallet'

// ============================================================================
// Helpers
// ============================================================================

// Contract interaction helpers
export * from './helpers/contracts'

// Error detection utilities
export * from './helpers/error-detection'

// Navigation and page helpers
export {
  cooldownBetweenTests,
  getCurrentRoute,
  hideNextDevOverlay,
  isAtRoute,
  navigateTo,
  navigateToLiquidity,
  navigateToMarket,
  navigateToPortfolio,
  navigateToRoute,
  navigateToSwap,
  waitForPageLoad,
  waitForRoute,
  waitForServerHealthy,
} from './helpers/navigation'

// OAuth3 authentication helpers
export {
  ensureLoggedIn,
  ensureLoggedOut,
  getDisplayedWalletAddress,
  isAuthenticated as isOAuth3Authenticated,
  loginWithWallet,
  logout,
  waitForAuth,
} from './helpers/oauth3-auth'

// On-chain verification helpers
export * from './helpers/on-chain'

// Screenshot utilities
export * from './helpers/screenshots'

// AI-powered visual verification
export {
  verifyPage,
  verifyElement,
  verifyPages,
  createAppVisualTest,
  type PageVerificationOptions,
  type VerificationResult,
} from './visual-verification'

// LLM utilities for test verification
export {
  llm,
  chat,
  complete,
  describeImage,
  verifyImage,
  isLLMConfigured,
  requireLLM,
  type LLMMessage,
  type LLMOptions,
  type LLMResponse,
  type ImageVerification,
} from './ai'

// Test data constants
export {
  BASE_SELECTORS,
  generateTestEmail,
  generateTestId,
  generateTestUsername,
  HTTP_STATUS,
  sleep,
  TEST_FORM_DATA,
  TEST_NUMBERS,
  TIMEOUTS,
  type TimeoutName,
  TRADING_TEST_DATA,
  VIEWPORTS,
  type Viewport,
  type ViewportName,
} from './helpers/test-data'

// ============================================================================
// Configuration
// ============================================================================

// Playwright config
export {
  type AppConfigOptions,
  createAppConfig,
  createPlaywrightConfig,
} from './playwright.config.base'
// Schemas - Zod validation for external data
export * from './schemas'
// Synpress config
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

// ============================================================================
// Shared Utilities & Constants
// ============================================================================

export {
  checkContractsDeployed,
  checkRpcHealth,
  checkServiceHealth,
  findJejuWorkspaceRoot,
  getChainId,
  getRpcUrl,
  getTestEnv,
  isRpcAvailable,
  isServiceAvailable,
  // Chain constants (canonical source)
  JEJU_CHAIN,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  // Wallet constants (canonical source)
  PASSWORD,
  SEED_PHRASE,
  TEST_ACCOUNTS,
  TEST_WALLET_ADDRESS,
  // Wait utilities
  waitForRpc,
  waitForService,
} from './utils'

// ============================================================================
// Live Infrastructure Testing (NO MOCKS)
// ============================================================================

export {
  // Infrastructure status
  getInfraStatus,
  getInfraConfig,
  printInfraStatus,
  // Infrastructure requirements
  requireInfra,
  hasInfra,
  type InfraRequirement,
  type InfraStatus,
  // Individual service checks
  checkCqlAvailable,
  checkChainAvailable,
  checkSolanaAvailable,
  checkIpfsAvailable,
  // Live clients for tests
  getLiveInfra,
  getLiveCqlClient,
  getLiveRedisClient,
  getChainConfig,
  CqlTestClient,
  RedisTestClient,
  type LiveInfra,
  // Test helpers
  skipWithoutInfra,
  describeWithInfra,
} from './live-infrastructure'

// ============================================================================
// Full App Crawler - Comprehensive E2E Coverage
// ============================================================================

export {
  type CoverageSummary,
  type CrawlConfig,
  type CrawlError,
  type CrawlResult,
  createAppCrawler,
  generateCrawlReport,
  type PageState,
  runFullAppCrawl,
} from '../e2e/full-app-crawler'
