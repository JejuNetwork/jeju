import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';
import { defineConfig } from '@playwright/test';

export const PASSWORD = 'Tester@1234';
export const SEED_PHRASE = 'test test test test test test test test test test test junk';

const DEMO_PORT = parseInt(process.env.OAUTH3_DEMO_PORT || '3000');
const AUTH_PORT = parseInt(process.env.OAUTH3_AUTH_PORT || '4200');
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '420691');
const RPC_URL = process.env.JEJU_RPC_URL || 'http://localhost:9545';

export const basicSetup = defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);

  await metamask.importWallet(SEED_PHRASE);

  await metamask.addNetwork({
    name: 'Jeju Local',
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    symbol: 'ETH',
  });

  await metamask.switchNetwork('Jeju Local');
});

export default defineConfig({
  testDir: './tests/synpress',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 120000,
  use: {
    baseURL: `http://localhost:${DEMO_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
  webServer: [
    {
      command: 'bun run dev:ui',
      port: DEMO_PORT,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'bun run dev:auth',
      port: AUTH_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
