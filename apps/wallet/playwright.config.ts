/**
 * Playwright Configuration for Wallet E2E Tests
 *
 * Three test projects:
 * - live: Tests against real dev server + localnet (headless)
 * - metamask: Synpress tests with MetaMask integration (headed)
 * - jeju-extension: Tests the Jeju wallet extension (headed)
 */

import { defineConfig, devices } from '@playwright/test'

const WALLET_PORT = parseInt(process.env.WALLET_PORT || '4015', 10)
const BASE_URL = `http://localhost:${WALLET_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: !process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60000,

  expect: {
    timeout: 15000,
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-wallet' }],
    ['json', { outputFile: 'test-results-wallet.json' }],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'live',
      testDir: './tests/e2e/live',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'metamask',
      testDir: './tests/e2e/metamask',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'jeju-extension',
      testDir: './tests/e2e/jeju-extension',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
