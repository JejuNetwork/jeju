/**
 * Dws Playwright Configuration
 *
 * DWS runs on two ports:
 * - 4030: API server (backend routes)
 * - 4031: Frontend (React SPA)
 *
 * E2E tests target the frontend on 4031
 */
import { defineConfig, devices } from '@playwright/test'

const FRONTEND_PORT = 4031

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 120000,

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Pass API keys to test environment
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Use 'bun run dev' to start both frontend (4031) and API (4030)
  // Set SKIP_WEBSERVER=1 if app is already running
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command: 'bun run dev',
        url: `http://localhost:4031`,
        reuseExistingServer: true,
        timeout: 180000,
      },
})
