import { defineConfig, devices } from '@playwright/test'

const port = process.env.DOCUMENTATION_PORT ?? '4004'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: `http://localhost:${port}/jeju`,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: `bun run dev`,
    port: Number(port),
    reuseExistingServer: true,
    timeout: 120000,
  },
})
