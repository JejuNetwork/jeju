import { defineConfig, devices } from '@playwright/test';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';

export default defineConfig({
  testDir: '.',
  testMatch: '*.synpress.ts',
  fullyParallel: false, // MetaMask tests should run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for wallet tests
  reporter: [['list'], ['html', { outputFolder: '../../playwright-report/synpress' }]],
  timeout: 120000, // 2 minutes per test
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: false, // MetaMask requires headed mode
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'cd ../.. && bun run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});

