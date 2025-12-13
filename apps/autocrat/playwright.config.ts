import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // MEV tests need sequential execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for blockchain state consistency
  reporter: [['html'], ['list']],
  timeout: 120000, // 2 minutes per test
  use: {
    baseURL: 'http://localhost:8545',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'localnet',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer - we expect anvil to be running
});
