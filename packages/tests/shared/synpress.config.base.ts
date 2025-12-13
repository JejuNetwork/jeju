import { defineConfig, devices } from '@playwright/test';
import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';
import { join } from 'path';

// Jeju network configuration
const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337');
const JEJU_RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545';

// Wallet credentials - Hardhat/Anvil test account #0
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

// Expected test wallet address (Hardhat/Anvil account #0)
const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Cache directory for all apps
const SYNPRESS_CACHE_DIR = process.env.SYNPRESS_CACHE_DIR || join(process.cwd(), '../../.jeju', '.synpress-cache');

// Path to shared global setup/teardown
const GLOBAL_SETUP_PATH = join(__dirname, 'global-setup.ts');
const GLOBAL_TEARDOWN_PATH = join(__dirname, 'global-teardown.ts');

export interface JejuSynpressConfig {
  appName: string;
  port: number;
  testDir: string;
  /** Enable global setup (lock + preflight + warmup) */
  useGlobalSetup?: boolean;
  /** Skip specific setup steps via environment */
  skipPreflight?: boolean;
  skipWarmup?: boolean;
  skipLock?: boolean;
  overrides?: Partial<ReturnType<typeof defineConfig>>;
}

/**
 * Creates a Playwright config with Synpress for wallet testing
 *
 * Features:
 * - Test locking to prevent concurrent runs
 * - Pre-flight chain validation
 * - App warmup for faster tests
 * - Consistent timeouts and reporters
 *
 * @example
 * ```typescript
 * // synpress.config.ts
 * import { createJejuSynpressConfig, createJejuWalletSetup } from '@jejunetwork/tests/synpress.config.base';
 *
 * export default createJejuSynpressConfig({
 *   appName: 'bazaar',
 *   port: 4006,
 *   testDir: './tests/wallet',
 *   useGlobalSetup: true, // Enable lock + preflight
 * });
 *
 * export const basicSetup = createJejuWalletSetup();
 * ```
 */
export function createJejuSynpressConfig(config: JejuSynpressConfig) {
  const {
    appName,
    port,
    testDir,
    useGlobalSetup = false,
    overrides = {},
  } = config;

  // Set environment variables for global setup
  if (config.skipPreflight) process.env.SKIP_PREFLIGHT = 'true';
  if (config.skipWarmup) process.env.SKIP_WARMUP = 'true';
  if (config.skipLock) process.env.SKIP_TEST_LOCK = 'true';

  const baseConfig = defineConfig({
    testDir,
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,

    // Global setup/teardown for test locking and preflight
    ...(useGlobalSetup && {
      globalSetup: GLOBAL_SETUP_PATH,
      globalTeardown: GLOBAL_TEARDOWN_PATH,
    }),

    reporter: [
      ['list'],
      ['json', { outputFile: `test-results/synpress-${appName}.json` }],
      ['html', { outputFolder: `test-results/html-${appName}`, open: 'never' }],
    ],

    // Generous timeout for wallet operations
    timeout: 120000,

    expect: {
      timeout: 15000,
    },

    use: {
      baseURL: `http://localhost:${port}`,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      viewport: { width: 1280, height: 720 },
      // Action timeout for clicks, fills, etc.
      actionTimeout: 15000,
      // Navigation timeout
      navigationTimeout: 30000,
    },

    projects: [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
    ],

    webServer: {
      command: 'bun run dev',
      url: `http://localhost:${port}`,
      reuseExistingServer: true,
      timeout: 120000,
    },

    ...overrides,
  });

  return baseConfig;
}

/**
 * Creates the Jeju wallet setup for Synpress
 * Uses shared cache directory across all apps
 *
 * The wallet is configured with:
 * - Hardhat/Anvil test account #0 (well-known seed phrase)
 * - Jeju Local network added and selected
 * - Ready for dApp connections
 */
export function createJejuWalletSetup() {
  return defineWalletSetup(PASSWORD, async (context, walletPage) => {
    const metamask = new MetaMask(context, walletPage, PASSWORD);

    // Import Hardhat/Anvil test account #0 using seed phrase
    await metamask.importWallet(SEED_PHRASE);

    // Add Jeju network
    await metamask.addNetwork({
      name: 'Jeju Local',
      rpcUrl: JEJU_RPC_URL,
      chainId: JEJU_CHAIN_ID,
      symbol: 'ETH',
    });

    // Switch to Jeju network
    await metamask.switchNetwork('Jeju Local');
  });
}

/**
 * Create a minimal config for smoke tests
 * Faster setup with minimal features
 */
export function createSmokeTestConfig(config: { port: number; testDir: string }) {
  return defineConfig({
    testDir: config.testDir,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 60000,
    expect: { timeout: 10000 },
    use: {
      baseURL: `http://localhost:${config.port}`,
      trace: 'off',
      screenshot: 'off',
      video: 'off',
    },
    projects: [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
    ],
  });
}

export {
  SEED_PHRASE,
  PASSWORD,
  TEST_WALLET_ADDRESS,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  SYNPRESS_CACHE_DIR,
  GLOBAL_SETUP_PATH,
  GLOBAL_TEARDOWN_PATH,
};
