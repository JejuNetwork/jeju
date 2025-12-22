import { defineConfig } from '@playwright/test'

/**
 * Playwright config for smoke tests
 *
 * These are fast, non-wallet tests that verify chain infrastructure.
 * They run without Synpress and don't need a browser.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.playwright.ts',
  fullyParallel: true,
  workers: 1,
  retries: 0,
  timeout: 60000,

  reporter: [['list'], ['json', { outputFile: 'smoke-results.json' }]],

  use: {
    trace: 'off',
  },
})
