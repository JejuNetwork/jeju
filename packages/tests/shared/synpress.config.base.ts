/**
 * Base Synpress Configuration for Wallet E2E Tests
 * 
 * Apps should extend this config for MetaMask/wallet testing.
 * 
 * Usage in app:
 * ```typescript
 * import { createSynpressConfig, createWalletSetup } from '@jejunetwork/tests/synpress.config.base';
 * export default createSynpressConfig({ name: 'my-app', port: 4000 });
 * export const basicSetup = createWalletSetup();
 * ```
 */

import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { TEST_ACCOUNTS, SEED_PHRASE, PASSWORD } from './playwright.config.base';

export { TEST_ACCOUNTS, SEED_PHRASE, PASSWORD };

export interface SynpressConfigOptions {
  name: string;
  port: number;
  testDir?: string;
  timeout?: number;
  baseURL?: string;
  webServer?: {
    command: string;
    timeout?: number;
  };
}

/**
 * network localnet chain configuration for MetaMask
 */
export const JEJU_CHAIN = {
  chainId: 1337,
  chainIdHex: '0x539',
  name: 'Network Localnet',
  rpcUrl: 'http://127.0.0.1:9545',
  symbol: 'ETH',
  blockExplorerUrl: '',
} as const;

/**
 * Create Synpress-compatible Playwright config
 */
export function createSynpressConfig(options: SynpressConfigOptions): PlaywrightTestConfig {
  const {
    name,
    port,
    testDir = './tests/wallet',
    timeout = 300000,
    baseURL = `http://localhost:${port}`,
    webServer,
  } = options;

  return defineConfig({
    testDir,
    fullyParallel: false, // Synpress requires sequential
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Synpress requires single worker
    timeout,

    expect: {
      timeout: 30000,
    },

    reporter: [
      ['list'],
      ['html', { outputFolder: `synpress-report-${name}` }],
      ['json', { outputFile: `synpress-results-${name}.json` }],
    ],

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
          reuseExistingServer: true,
          timeout: webServer.timeout || 120000,
        }
      : undefined,
  });
}

/**
 * Wallet setup configuration for Synpress
 */
export interface WalletSetupOptions {
  seedPhrase?: string;
  password?: string;
  addNetworkChain?: boolean;
}

/**
 * Create wallet setup for Synpress
 * 
 * Usage with @synthetixio/synpress:
 * ```typescript
 * import { defineWalletSetup } from '@synthetixio/synpress';
 * import { MetaMask } from '@synthetixio/synpress/playwright';
 * import { createWalletSetup, PASSWORD, JEJU_CHAIN } from '@jejunetwork/tests/synpress.config.base';
 * 
 * export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
 *   const metamask = new MetaMask(context, walletPage, PASSWORD);
 *   await metamask.importWallet(SEED_PHRASE);
 *   await metamask.addNetwork(JEJU_CHAIN);
 * });
 * ```
 */
export function createWalletSetup(options: WalletSetupOptions = {}) {
  const {
    seedPhrase = SEED_PHRASE,
    password = PASSWORD,
    addNetworkChain = true,
  } = options;

  return {
    seedPhrase,
    walletPassword: password,
    addNetworkChain,
    jejuChain: JEJU_CHAIN,
    testAccounts: TEST_ACCOUNTS,
  };
}

/**
 * Helper to connect MetaMask and verify connection
 */
export async function connectAndVerify(
  page: { locator: (selector: string) => { click: () => Promise<void>; getAttribute: (attr: string) => Promise<string | null> } },
  metamask: { connectToDapp: () => Promise<void> }
): Promise<string> {
  await page.locator('[data-testid="connect-wallet"]').click();
  await metamask.connectToDapp();
  
  const address = await page.locator('[data-testid="wallet-address"]').getAttribute('data-address');
  if (!address) {
    throw new Error('Failed to get connected wallet address');
  }
  
  return address;
}

export default createSynpressConfig;
