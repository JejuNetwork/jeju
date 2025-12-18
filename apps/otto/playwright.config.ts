import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:4040',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'api',
      testMatch: /api\.test\.ts$/,
    },
    {
      name: 'integration',
      testMatch: /integration\.test\.ts$/,
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:4040/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});

