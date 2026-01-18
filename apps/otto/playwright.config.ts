/**
 * Otto Playwright Configuration
 */
import { getTestConfig } from '@jejunetwork/config/test-config'
import { defineConfig, devices } from '@playwright/test'

const config = getTestConfig('otto')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  timeout: 30000,

  use: {
    baseURL: config.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the Otto server before tests
  // When testing against remote (testnet/mainnet), no webserver is started
  webServer: config.skipWebServer
    ? undefined
    : {
        command: 'bun run dev',
        url: `${config.baseURL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
})
