import { defineConfig, devices } from '@playwright/test';
import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337');
const JEJU_RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545';

export interface JejuSynpressConfig {
  appName: string;
  port: number;
  testDir: string;
  overrides?: Record<string, unknown>;
}

export function createJejuSynpressConfig(config: JejuSynpressConfig) {
  const { appName, port, testDir, overrides = {} } = config;

  return defineConfig({
    testDir,
    fullyParallel: false,
    workers: 1,
    retries: 0,

    reporter: [
      ['list'],
      ['json', { outputFile: `test-results/synpress-${appName}.json` }],
    ],

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
}

const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'Tester@1234';

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

export { SEED_PHRASE, PASSWORD };
