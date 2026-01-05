import { getTestConfig } from '@jejunetwork/config/test-config'
import { defineConfig, devices } from '@playwright/test'

const config = getTestConfig('dws')

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

  // Pass API keys and network config to test environment
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    JEJU_NETWORK: config.network,
    API_URL: config.apiURL,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Use 'bun run dev' to start both frontend (4031) and API (4030)
  // When testing against remote (testnet/mainnet), no webserver is started
  webServer: config.skipWebServer
    ? undefined
    : {
        command: 'bun run dev',
        url: config.baseURL,
        reuseExistingServer: true,
        timeout: 180000,
      },
})
