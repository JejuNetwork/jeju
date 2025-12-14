/**
 * Base Synpress configuration for Jeju apps
 * 
 * Usage in app synpress.config.ts:
 * 
 * ```typescript
 * import { createSynpressConfig } from '@jejunetwork/tests/synpress.config.base';
 * export default createSynpressConfig({
 *   appPort: 4006,
 *   appName: 'bazaar',
 * });
 * ```
 */

import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';

export interface SynpressConfigOptions {
  /** Port the app runs on */
  appPort: number;
  /** App name for test naming */
  appName: string;
  /** Test directory (default: ./tests) */
  testDir?: string;
  /** Test match pattern (default: **\/*.wallet.test.ts) */
  testMatch?: string;
  /** Timeout in ms (default: 120000) */
  timeout?: number;
  /** Base URL override */
  baseURL?: string;
  /** Number of retries (default: 0 for local, 2 for CI) */
  retries?: number;
  /** Number of workers (default: 1) */
  workers?: number;
}

export const JEJU_WALLET_CONFIG = {
  seed: 'test test test test test test test test test test test junk',
  password: 'Tester@1234',
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

export const JEJU_NETWORK_CONFIG = {
  networkName: 'Jeju Local',
  rpcUrl: process.env.JEJU_RPC_URL || process.env.L2_RPC_URL || 'http://localhost:9545',
  chainId: parseInt(process.env.CHAIN_ID || '1337'),
  symbol: 'ETH',
};

export function createSynpressConfig(options: SynpressConfigOptions) {
  const {
    appPort,
    appName,
    testDir = './tests',
    testMatch = '**/*.wallet.test.ts',
    timeout = 120000,
    baseURL = `http://localhost:${appPort}`,
    retries = process.env.CI ? 2 : 0,
    workers = 1,
  } = options;

  // Synpress cache directory
  const synpressCacheDir = process.env.SYNPRESS_CACHE_DIR || join(process.cwd(), '../../.jeju/.synpress-cache');

  return defineConfig({
    testDir,
    testMatch,
    timeout,
    
    // Synpress requires headful mode
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries,
    workers,
    
    reporter: process.env.CI ? [
      ['list'],
      ['json', { outputFile: `test-results-synpress.json` }],
    ] : [['list']],

    use: {
      baseURL,
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      
      // Synpress specific
      headless: false,
      viewport: { width: 1280, height: 720 },
    },

    projects: [
      {
        name: `${appName}-wallet`,
        testMatch,
        use: {
          ...devices['Desktop Chrome'],
        },
      },
    ],

    // Global setup for wallet
    globalSetup: require.resolve('./global-setup'),
    globalTeardown: require.resolve('./global-teardown'),

    // Output
    outputDir: './test-results',
    
    // Environment
    metadata: {
      appName,
      appPort,
      network: 'localnet',
      walletAddress: JEJU_WALLET_CONFIG.address,
    },
  });
}

export default createSynpressConfig;
