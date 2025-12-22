/**
 * @jejunetwork/tests/playwright-only
 *
 * Playwright utilities that DON'T require synpress.
 * Use this for standard Playwright tests without wallet integration.
 */

// Constants
export * from './constants'
// Error detection
export * from './helpers/error-detection'
// Navigation helpers
export * from './helpers/navigation'
// Screenshot helpers
export * from './helpers/screenshots'
// Playwright config
export {
  type AppConfigOptions,
  createAppConfig,
  createPlaywrightConfig,
} from './playwright.config.base'

// Core utilities (non-synpress)
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
  waitForRpc,
  waitForService,
} from './utils'
