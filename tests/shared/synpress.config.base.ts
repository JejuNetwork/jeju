import { defineConfig, devices } from '@playwright/test';
import { defineWalletSetup } from '@synthetixio/synpress';
import type { MetaMask } from '@synthetixio/synpress/playwright';

const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337');
const JEJU_RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545';

export interface JejuSynpressConfig {
  appName: string;
  port: number;
  testDir: string;
  overrides?: any;
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

export function createJejuWalletSetup() {
  const password = 'Test1234!';
  
  return defineWalletSetup(password, async (context, walletPage) => {
    const wallet = walletPage as MetaMask;

    // Import Hardhat/Anvil test account #0
    await wallet.importWallet({
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      password,
    });

    // Add Jeju network
    await wallet.addNetwork({
      name: 'Jeju Local',
      rpcUrl: JEJU_RPC_URL,
      chainId: JEJU_CHAIN_ID,
      symbol: 'ETH',
    });

    // Switch to Jeju network
    await wallet.switchNetwork('Jeju Local');
  });
}
