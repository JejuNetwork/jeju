/**
 * Base Synpress Configuration for Wallet E2E Tests
 *
 * SINGLE SOURCE OF TRUTH for all Synpress/wallet testing.
 * All apps should use this config to ensure consistency.
 *
 * Usage in app synpress.config.ts:
 * ```typescript
 * import { createSynpressConfig, createWalletSetup, PASSWORD } from '@jejunetwork/tests';
 * export default createSynpressConfig({ appName: 'gateway', port: 4001 });
 * export const basicSetup = createWalletSetup();
 * export { PASSWORD };
 * ```
 *
 * Usage in wallet-setup/basic.setup.ts:
 * ```typescript
 * import { defineWalletSetup } from '@synthetixio/synpress';
 * import { MetaMask } from '@synthetixio/synpress/playwright';
 * import { PASSWORD, SEED_PHRASE, JEJU_CHAIN } from '@jejunetwork/tests';
 *
 * export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
 *   const metamask = new MetaMask(context, walletPage, PASSWORD);
 *   await metamask.importWallet(SEED_PHRASE);
 *   await metamask.addNetwork(JEJU_CHAIN);
 *   await metamask.switchNetwork(JEJU_CHAIN.name);
 * });
 * ```
 *
 * CLI Usage:
 * ```bash
 * # Run all e2e tests
 * jeju test e2e
 *
 * # Run e2e tests for specific app
 * jeju test e2e --app gateway
 *
 * # Run smoke tests only
 * jeju test e2e --smoke
 *
 * # Build wallet cache (run once)
 * jeju test e2e --build-cache
 *
 * # CI mode (headless)
 * jeju test e2e --headless
 * ```
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test'

// Import canonical constants from utils
import {
  findJejuWorkspaceRoot,
  JEJU_CHAIN,
  PASSWORD,
  SEED_PHRASE,
  TEST_ACCOUNTS,
  TEST_WALLET_ADDRESS,
} from './utils'

// ES module compatibility - get __dirname equivalent
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Synpress cache directory - uses env var or finds monorepo root */
export const SYNPRESS_CACHE_DIR =
  process.env.SYNPRESS_CACHE_DIR ??
  join(findJejuWorkspaceRoot(), '.jeju', '.synpress-cache')

/** Global setup path */
export const GLOBAL_SETUP_PATH = join(__dirname, 'global-setup.ts')

/** Global teardown path */
export const GLOBAL_TEARDOWN_PATH = join(__dirname, 'global-teardown.ts')

// CONFIG OPTIONS

export interface SynpressConfigOptions {
  appName: string
  port: number
  testDir?: string
  timeout?: number
  baseURL?: string
  overrides?: Partial<PlaywrightTestConfig>
  webServer?: {
    command: string
    timeout?: number
  }
}

export interface SmokeTestConfigOptions {
  appName?: string
  port?: number
  testDir?: string
  testMatch?: string | string[]
  timeout?: number
}

// CONFIG FACTORIES

/**
 * Create Synpress-compatible Playwright config for wallet E2E tests
 */
export function createSynpressConfig(
  options: SynpressConfigOptions,
): PlaywrightTestConfig {
  const {
    appName,
    port,
    testDir = './tests/synpress',
    timeout = 300000,
    baseURL = `http://localhost:${port}`,
    webServer,
    overrides = {},
  } = options

  return defineConfig({
    testDir,
    fullyParallel: false, // Synpress requires sequential execution
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Synpress requires single worker for MetaMask
    timeout,
    globalTimeout: 1800000, // 30 min global timeout

    expect: {
      timeout: 30000,
    },

    // Console-only reporters - no HTML reports
    reporter: [['list'], ['line']],

    use: {
      baseURL,
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      actionTimeout: 30000,
      navigationTimeout: 30000,
    },

    projects: [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1280, height: 720 },
        },
      },
    ],

    webServer: webServer
      ? {
          command: webServer.command,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: webServer.timeout || 120000,
        }
      : undefined,

    ...overrides,
  })
}

/**
 * Create a minimal smoke test config (no webServer required)
 */
export function createSmokeTestConfig(
  options: SmokeTestConfigOptions = {},
): PlaywrightTestConfig {
  const {
    appName = 'smoke',
    port = 0,
    testDir = '.',
    testMatch,
    timeout = 120000,
  } = options

  return createSynpressConfig({
    appName,
    port,
    testDir,
    timeout,
    overrides: {
      retries: 0,
      ...(testMatch && { testMatch }),
    },
  })
}

// WALLET SETUP

export interface WalletSetupOptions {
  seedPhrase?: string
  password?: string
  addNetwork?: boolean
  switchToNetwork?: boolean
}

export interface WalletSetupResult {
  seedPhrase: string
  walletPassword: string
  addNetwork: boolean
  switchToNetwork: boolean
  chain: typeof JEJU_CHAIN
  testAccounts: typeof TEST_ACCOUNTS
  testWalletAddress: string
}

/**
 * Create wallet setup configuration for Synpress tests.
 * Returns a configuration object that can be used with defineWalletSetup.
 *
 * Example wallet-setup/basic.setup.ts:
 * ```typescript
 * import { defineWalletSetup } from '@synthetixio/synpress';
 * import { MetaMask } from '@synthetixio/synpress/playwright';
 * import { PASSWORD, SEED_PHRASE, JEJU_CHAIN } from '@jejunetwork/tests';
 *
 * export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
 *   const metamask = new MetaMask(context, walletPage, PASSWORD);
 *   await metamask.importWallet(SEED_PHRASE);
 *   await metamask.addNetwork(JEJU_CHAIN);
 *   await metamask.switchNetwork(JEJU_CHAIN.name);
 * });
 *
 * export { PASSWORD };
 * ```
 */
export function createWalletSetup(
  options: WalletSetupOptions = {},
): WalletSetupResult {
  const {
    seedPhrase = SEED_PHRASE,
    password = PASSWORD,
    addNetwork = true,
    switchToNetwork = true,
  } = options

  return {
    seedPhrase,
    walletPassword: password,
    addNetwork,
    switchToNetwork,
    chain: JEJU_CHAIN,
    testAccounts: TEST_ACCOUNTS,
    testWalletAddress: TEST_WALLET_ADDRESS,
  }
}

// EXPORTS

export default createSynpressConfig
