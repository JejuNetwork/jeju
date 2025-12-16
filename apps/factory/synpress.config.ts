import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/synpress',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results-synpress.json' }],
  ],
  timeout: 120000,
  expect: {
    timeout: 30000,
  },
  use: {
    baseURL: 'http://localhost:4009',
    trace: 'on-first-retry',
    headless: false,
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:4009',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});

