/**
 * Playwright Configuration
 * 
 * Supports three test modes:
 * 1. Mock tests (fast, no extension)
 * 2. MetaMask tests (with Synpress)
 * 3. Jeju Extension tests (with our extension)
 */

import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  
  // Global timeout
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  
  // Run tests sequentially for wallet tests
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  
  // Reporter configuration
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ...(isCI ? [['github' as const]] : []),
  ],
  
  // Global settings
  use: {
    baseURL: 'http://localhost:4015',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  
  projects: [
    // Mock tests - fast, no extension required
    {
      name: 'mock',
      testDir: './tests/e2e/mock',
      use: { 
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
    
    // MetaMask tests - using Synpress
    {
      name: 'metamask',
      testDir: './tests/e2e/metamask',
      use: {
        ...devices['Desktop Chrome'],
        headless: false, // Extensions require headed mode
      },
    },
    
    // Jeju Extension tests
    {
      name: 'jeju-extension',
      testDir: './tests/e2e/jeju-extension',
      use: {
        ...devices['Desktop Chrome'],
        headless: false, // Extensions require headed mode
      },
    },
    
    // Legacy tests (existing tests)
    {
      name: 'legacy',
      testMatch: [
        'tests/*.spec.ts',
        '!tests/e2e/**',
      ],
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
      },
    },
  ],
  
  // Web server configuration
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:4015',
    reuseExistingServer: !isCI,
    timeout: 120000,
  },
});
