import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/synpress',
  fullyParallel: false, // Synpress tests need sequential execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for wallet tests
  reporter: [
    ['html', { outputFolder: 'playwright-report-synpress' }],
    ['json', { outputFile: 'test-results-synpress.json' }],
  ],
  use: {
    baseURL: 'http://localhost:4040',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:4040/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});

