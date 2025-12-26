/**
 * Documentation Playwright Configuration
 */
import { CORE_PORTS } from '@jejunetwork/config/ports'
import { defineConfig, devices } from '@playwright/test'

const PORT = CORE_PORTS.DOCUMENTATION.get()

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 120000,

  use: {
    baseURL: `http://localhost:${PORT}/jeju`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.SKIP_WEBSERVER ? undefined : {
    command: 'bun run dev',
    url: `http://localhost:${PORT}/jeju`,
    reuseExistingServer: true,
    timeout: 120000,
  },
})
