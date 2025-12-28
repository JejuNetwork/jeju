/**
 * Gateway Playwright Configuration
 */
import { defineConfig, devices } from '@playwright/test'

// Dev server runs on 4014, not GATEWAY port (4013)
const PORT = Number(process.env.GATEWAY_PORT) || 4014

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
    baseURL: `http://localhost:${PORT}`,
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
  // Set SKIP_WEBSERVER=1 if app is already running
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command: 'bun run start',
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 180000,
      },
})
