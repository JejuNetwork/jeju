import { defineConfig, devices } from '@playwright/test'

const BAZAAR_PORT = parseInt(process.env.BAZAAR_PORT || '4006', 10)
const baseURL = `http://localhost:${BAZAAR_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: !process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 120000,

  expect: {
    timeout: 30000,
  },

  reporter: [['dot'], ['html', { outputFolder: 'playwright-report' }]],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
})
