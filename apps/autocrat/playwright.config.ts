/**
 * Playwright Configuration for Autocrat E2E Tests
 *
 * Runs standard Playwright tests (no wallet required)
 * For wallet tests, use synpress.config.ts
 */

import { defineConfig, devices } from '@playwright/test'

const AUTOCRAT_PORT = parseInt(process.env.PORT || '3010', 10)
const BASE_URL = `http://localhost:${AUTOCRAT_PORT}`

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
