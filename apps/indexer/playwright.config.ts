/**
 * Indexer Playwright Configuration
 */
import { getTestConfig } from '@jejunetwork/config/test-config'
import { defineConfig, devices } from '@playwright/test'

const config = getTestConfig('indexer')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Console-only reporters - no HTML reports
  reporter: [['list'], ['line']],
  timeout: 120000,

  use: {
    baseURL: config.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the local Indexer frontend dev server (PORT=4355).
  // When testing against remote (testnet/mainnet), no webserver is started.
  webServer: config.skipWebServer
    ? undefined
    : {
        command: 'bun run dev',
        url: config.baseURL,
        reuseExistingServer: true,
        timeout: 180000,
      },
})
