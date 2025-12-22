import { createPlaywrightConfig } from '@jejunetwork/tests/playwright-only';
import { devices } from '@playwright/test';

const WALLET_PORT = parseInt(process.env.WALLET_PORT || '4015');

export default createPlaywrightConfig({
  name: 'wallet',
  port: WALLET_PORT,
  testDir: './tests/e2e',
  webServer: {
    command: 'bun run dev',
  },
  overrides: {
    timeout: 60000,
    expect: {
      timeout: 15000,
    },
    projects: [
      // Live E2E - requires network localnet running
      {
        name: 'live',
        testDir: './tests/e2e/live',
        use: {
          ...devices['Desktop Chrome'],
          headless: true,
        },
      },
      // MetaMask - requires Synpress + headed browser
      {
        name: 'metamask',
        testDir: './tests/e2e/metamask',
        use: {
          ...devices['Desktop Chrome'],
          headless: false,
        },
      },
      // Jeju Extension - requires extension build
      {
        name: 'jeju-extension',
        testDir: './tests/e2e/jeju-extension',
        use: {
          ...devices['Desktop Chrome'],
          headless: false,
        },
      },
    ],
  },
});
