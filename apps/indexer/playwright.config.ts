import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  use: {
    baseURL: process.env.A2A_URL || 'http://localhost:4351',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'api',
      testMatch: /.*\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:4351',
      },
    },
  ],
  webServer: {
    command: 'DB_PORT=23798 bun run api:all',
    url: 'http://localhost:4352/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
