/**
 * Factory Playwright Configuration
 */
import { getTestConfig } from '@jejunetwork/config/test-config'
import { defineConfig, devices } from '@playwright/test'

const config = getTestConfig('factory')

export default defineConfig({
  testDir: './tests/e2e',
  // Ignore files that use bun:test (should be unit tests, not e2e)
  testIgnore: ['**/releases.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: config.network !== 'localnet' ? 1 : process.env.CI ? 1 : undefined,
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

  // Use 'bun run start' for production-like testing against DWS infrastructure
  // When testing against remote (testnet/mainnet), no webserver is started
  webServer: config.skipWebServer
    ? undefined
    : {
        command: 'bun run start',
        url: config.baseURL,
        reuseExistingServer: true,
        timeout: 180000,
      },
})
