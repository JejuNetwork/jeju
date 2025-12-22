import { defineConfig, devices } from '@playwright/test';

// ============================================================================
// WALLET SETUP - Define inline to avoid ESM/CommonJS issues
// ============================================================================

export const SEED_PHRASE = 'test test test test test test test test test test test junk';
export const PASSWORD = 'Tester@1234';

const JEJU_CHAIN = {
  chainId: 1337,
  chainIdHex: '0x539',
  name: 'Jeju Localnet',
  rpcUrl: 'http://127.0.0.1:9545',
  symbol: 'ETH',
  blockExplorerUrl: '',
};

export const basicSetup = {
  seedPhrase: SEED_PHRASE,
  walletPassword: PASSWORD,
  addNetwork: true,
  switchToNetwork: true,
  chain: JEJU_CHAIN,
  testWalletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};

// ============================================================================
// PLAYWRIGHT CONFIG
// ============================================================================

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '4001');

export default defineConfig({
  testDir: './tests/e2e-synpress',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 180000,
  globalTimeout: 1800000,

  expect: { timeout: 30000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'synpress-report-gateway' }],
    ['json', { outputFile: 'synpress-results-gateway.json' }],
  ],

  use: {
    baseURL: `http://localhost:${GATEWAY_PORT}`,
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
});

