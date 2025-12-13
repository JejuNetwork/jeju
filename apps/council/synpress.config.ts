import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:8010';
const CEO_URL = 'http://localhost:8004';

export default defineConfig({
  testDir: './tests/synpress',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 120000,
  expect: {
    timeout: 30000
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'bun run src/index.ts',
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      command: 'bun run src/ceo-server.ts',
      url: CEO_URL,
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
});
