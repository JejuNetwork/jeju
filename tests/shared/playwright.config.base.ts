import { defineConfig, devices } from '@playwright/test';

/**
 * Base Playwright configuration for all Jeju apps
 *
 * Individual apps should extend this configuration with their specific settings:
 * - baseURL
 * - webServer command
 * - testDir
 *
 * Example:
 * ```typescript
 * import { defineConfig } from '@playwright/test';
 * import { baseConfig } from '../../tests/shared/playwright.config.base';
 *
 * export default defineConfig({
 *   ...baseConfig,
 *   use: {
 *     ...baseConfig.use,
 *     baseURL: 'http://localhost:4005',
 *   },
 *   webServer: {
 *     command: 'bun run dev',
 *     url: 'http://localhost:4005',
 *     reuseExistingServer: !process.env.CI,
 *   },
 * });
 * ```
 */
export const baseConfig = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ['json', { outputFile: 'test-results.json' }],
  ],

  // Default timeout for each test
  timeout: 60000, // 60 seconds

  // Expect timeout for assertions
  expect: {
    timeout: 10000, // 10 seconds
  },

  use: {
    // Collect trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Browser viewport
    viewport: { width: 1280, height: 720 },

    // Ignore HTTPS errors (for local development)
    ignoreHTTPSErrors: true,

    // Action timeout
    actionTimeout: 15000, // 15 seconds
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
