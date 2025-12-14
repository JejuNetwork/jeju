/**
 * Playwright Configuration
 * 
 * Live E2E tests against real network infrastructure:
 * - network localnet for blockchain (port 9545)
 * - Wallet dev server for UI (port 4015)
 * - Real RPC calls and transactions
 */

import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  
  // Timeout - live tests against real blockchain
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  
  // Sequential for consistent chain state
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ...(isCI ? [['github' as const]] : []),
  ],
  
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4015',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  
  projects: [
    // Live E2E - requires network localnet running
    {
      name: 'live',
      testDir: './tests/e2e/live',
      use: { 
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
    
    // MetaMask - requires Synpress + headed browser
    {
      name: 'metamask',
      testDir: './tests/e2e/metamask',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
      },
    },
    
    // Network Extension - requires extension build
    {
      name: 'jeju-extension',
      testDir: './tests/e2e/jeju-extension',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
      },
    },
  ],
  
  // Start dev server for tests
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:4015',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
