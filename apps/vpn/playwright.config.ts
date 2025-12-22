/**
 * Playwright E2E Configuration for VPN App
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60000,

  expect: {
    timeout: 15000,
  },

  reporter: [['list'], ['html', { outputFolder: 'playwright-report-vpn' }]],

  use: {
    baseURL: 'http://localhost:1421',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 15000,
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
    command: 'bun run dev:web',
    url: 'http://localhost:1421',
    reuseExistingServer: true,
    timeout: 60000,
  },
})
