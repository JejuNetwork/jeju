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
    baseURL: process.env.OTTO_BASE_URL ?? 'http://localhost:4040',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'e2e-chat',
      testMatch: /chat-flow\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-platform',
      testMatch: /platform-flow\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /\.spec\.ts$/,
      testIgnore: [/wallet\/.*\.spec\.ts$/], // Wallet tests use Synpress
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:4040/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
