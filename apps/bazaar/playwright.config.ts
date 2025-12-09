import { defineConfig, devices } from '@playwright/test'

const BAZAAR_PORT = parseInt(process.env.BAZAAR_PORT || '4006')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  timeout: 60000,
  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: `http://localhost:${BAZAAR_PORT}`,
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

  webServer: {
    command: 'bun run dev',
    url: `http://localhost:${BAZAAR_PORT}`,
    reuseExistingServer: true,
    timeout: 120000,
  },
})
