/**
 * Playwright-only exports for E2E testing
 *
 * This file provides exports that work with Playwright's ESM loader
 * without pulling in @jejunetwork/config or @jejunetwork/contracts
 * (which use JSON imports that require type assertions not yet
 * supported by Playwright's Node ESM loader).
 *
 * Usage:
 * ```typescript
 * import { assertNoPageErrors, captureScreenshot } from '@jejunetwork/tests/playwright-only'
 * ```
 */

// Synpress config exports
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
} from './shared/synpress.config.base'

// Playwright config exports
export {
  type AppConfigOptions,
  createAppConfig,
  createPlaywrightConfig,
} from './shared/playwright.config.base'

// Test utilities that don't use @jejunetwork/config
export {
  findJejuWorkspaceRoot,
  JEJU_CHAIN,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  PASSWORD,
  SEED_PHRASE,
  TEST_ACCOUNTS,
  TEST_WALLET_ADDRESS,
} from './shared/utils'

// Error detection helpers
export {
  assertNoPageErrors,
  detectPageErrors,
} from './shared/helpers/error-detection'

// Screenshot helpers
export {
  captureScreenshot,
  captureScreenshots,
  captureUserFlow,
  getScreenshotPath,
} from './shared/helpers/screenshots'

// Navigation helpers
export {
  cooldownBetweenTests,
  getCurrentRoute,
  hideNextDevOverlay,
  isAtRoute,
  navigateTo,
  navigateToRoute,
  waitForPageLoad,
  waitForRoute,
  waitForServerHealthy,
} from './shared/helpers/navigation'

// Constants
export * from './shared/constants'

