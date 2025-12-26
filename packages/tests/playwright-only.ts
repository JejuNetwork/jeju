/**
 * Playwright-only exports for synpress configs
 *
 * This file provides exports that work with Playwright's ESM loader
 * without pulling in @jejunetwork/config (which uses JSON imports
 * that require type assertions not yet supported by Playwright).
 *
 * Use this for synpress.config.ts files:
 * ```typescript
 * import { createSynpressConfig, createWalletSetup } from '@jejunetwork/tests/playwright-only'
 * ```
 */

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

export {
  type AppConfigOptions,
  createAppConfig,
  createPlaywrightConfig,
} from './shared/playwright.config.base'

// Re-export test utilities that don't use @jejunetwork/config
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

