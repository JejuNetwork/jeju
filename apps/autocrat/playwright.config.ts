/**
 * Playwright Configuration for Autocrat E2E Tests
 *
 * Runs standard Playwright tests (no wallet required)
 * For wallet tests, use synpress.config.ts
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { defineConfig, devices } from '@playwright/test'

const BASE_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev:web',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
})
