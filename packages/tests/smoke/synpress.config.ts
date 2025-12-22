import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { findJejuWorkspaceRoot } from '../shared/utils'

/**
 * Synpress config for wallet smoke tests
 *
 * These tests verify the full Synpress setup works:
 * - MetaMask extension loads
 * - Wallet imports correctly
 * - Network is configured
 * - Can connect to dApps
 * - On-chain verification works
 *
 * CLI:
 *   jeju test synpress --smoke
 *
 * Direct:
 *   bunx playwright test --config packages/tests/smoke/synpress.config.ts
 */

const rootDir = findJejuWorkspaceRoot()

export default defineConfig({
  testDir: '.',
  testMatch: 'wallet-smoke.spec.ts',
  fullyParallel: false, // Synpress requires sequential execution
  workers: 1, // Single worker for MetaMask
  retries: process.env.CI ? 1 : 0,
  timeout: 180000, // 3 minutes per test
  globalTimeout: 600000, // 10 minutes total

  expect: {
    timeout: 30000,
  },

  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: join(rootDir, 'test-results', 'wallet-smoke-results.json'),
      },
    ],
  ],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
