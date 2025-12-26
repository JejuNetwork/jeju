import { defineConfig, devices } from '@playwright/test'

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '4013', 10)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60000,

  use: {
    baseURL: `http://localhost:${GATEWAY_PORT}`,
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
    command: 'bun run dev',
    url: `http://localhost:${GATEWAY_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})

