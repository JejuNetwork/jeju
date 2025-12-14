/**
 * Base Playwright Configuration for All Network Apps
 * 
 * Apps should extend this config for consistency.
 * 
 * Usage in app:
 * ```typescript
 * import { createAppConfig } from '@jejunetwork/tests/playwright.config.base';
 * export default createAppConfig({ name: 'my-app', port: 4000 });
 * ```
 */

import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { join } from 'path';

export interface AppConfigOptions {
  name: string;
  port: number;
  testDir?: string;
  timeout?: number;
  retries?: number;
  workers?: number;
  baseURL?: string;
  webServer?: {
    command: string;
    timeout?: number;
  };
}

const DEFAULT_TIMEOUTS = {
  test: 120000,
  expect: 30000,
  action: 30000,
  navigation: 30000,
} as const;

export function createAppConfig(options: AppConfigOptions): PlaywrightTestConfig {
  const {
    name,
    port,
    testDir = './tests/e2e',
    timeout = DEFAULT_TIMEOUTS.test,
    retries = process.env.CI ? 2 : 0,
    workers = process.env.CI ? 1 : undefined,
    baseURL = `http://localhost:${port}`,
    webServer,
  } = options;

  return defineConfig({
    testDir,
    fullyParallel: !process.env.CI,
    forbidOnly: !!process.env.CI,
    retries,
    workers,
    timeout,

    expect: {
      timeout: DEFAULT_TIMEOUTS.expect,
    },

    reporter: [
      ['list'],
      ['html', { outputFolder: `playwright-report-${name}` }],
      ['json', { outputFile: `test-results-${name}.json` }],
    ],

    use: {
      baseURL,
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      actionTimeout: DEFAULT_TIMEOUTS.action,
      navigationTimeout: DEFAULT_TIMEOUTS.navigation,
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
  });
}

/**
 * Environment variables for chain connection
 */
export function getTestEnv(): Record<string, string> {
  return {
    L1_RPC_URL: process.env.L1_RPC_URL || 'http://127.0.0.1:8545',
    L2_RPC_URL: process.env.L2_RPC_URL || 'http://127.0.0.1:9545',
    JEJU_RPC_URL: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    CHAIN_ID: process.env.CHAIN_ID || '1337',
    INDEXER_GRAPHQL_URL: process.env.INDEXER_GRAPHQL_URL || 'http://127.0.0.1:4350/graphql',
    ORACLE_URL: process.env.ORACLE_URL || 'http://127.0.0.1:4301',
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899',
  };
}

/**
 * Test accounts (Hardhat/Anvil defaults)
 */
export const TEST_ACCOUNTS = {
  deployer: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const,
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const,
  },
  user1: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const,
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const,
  },
  user2: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const,
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const,
  },
  user3: {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as const,
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as const,
  },
  operator: {
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as const,
    privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' as const,
  },
} as const;

export const SEED_PHRASE = 'test test test test test test test test test test test junk';
export const PASSWORD = 'Tester@1234';

export default createAppConfig;
