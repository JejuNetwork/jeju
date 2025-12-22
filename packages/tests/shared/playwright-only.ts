/**
 * @jejunetwork/tests/playwright-only
 *
 * Playwright utilities that DON'T require synpress.
 * Use this for standard Playwright tests without wallet integration.
 */

// Screenshot helpers
export * from './helpers/screenshots';

// Navigation helpers
export * from './helpers/navigation';

// Error detection
export * from './helpers/error-detection';

// Playwright config
export { createAppConfig, createPlaywrightConfig, type AppConfigOptions } from './playwright.config.base';

// Constants
export * from './constants';

// Core utilities (non-synpress)
export {
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

