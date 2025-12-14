import { defineConfig, devices } from '@playwright/test';

/**
 * Synpress configuration for wallet E2E tests
 * 
 * Includes tests for:
 * - Wallet connection flows
 * - Transaction signing
 * - Cross-chain transfers (EIL)
 * - Intent submission (OIF)
 * - Gas token selection
 * - Account abstraction features
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 120000,
  expect: {
    timeout: 30000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results-synpress.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4015',
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
  webServer: {
    command: 'bun run dev',
    url: process.env.BASE_URL || 'http://localhost:4015',
    reuseExistingServer: true,
    timeout: 120000,
  },
});

