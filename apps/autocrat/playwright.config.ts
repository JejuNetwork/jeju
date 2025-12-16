import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/synpress',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 60000,
  use: {
    baseURL: process.env.COUNCIL_URL ?? 'http://localhost:8010',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Reuse existing server
  webServer: {
    command: 'bun run src/index.ts',
    url: 'http://localhost:8010/health',
    reuseExistingServer: true,
    timeout: 30000,
  },
})
