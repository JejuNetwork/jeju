import { defineConfig, devices } from '@playwright/test'

const isE2E = process.env.E2E === 'true'
const baseURL = process.env.BASE_URL || 'http://localhost:4031'

export default defineConfig({
  testDir: './tests',
  // E2E tests need more time
  timeout: isE2E ? 60000 : 30000,
  fullyParallel: !isE2E, // Run e2e tests serially for stability
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: isE2E ? 1 : process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Only start web server for regular tests, not e2e (e2e has own setup)
  webServer:
    !isE2E && !process.env.BASE_URL
      ? {
          command: 'bun run dev',
          url: 'http://localhost:4031',
          reuseExistingServer: !process.env.CI,
          timeout: 60000,
        }
      : undefined,
})
