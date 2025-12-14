/**
 * Base Playwright configuration for Jeju apps
 * 
 * Usage in app playwright.config.ts:
 * 
 * ```typescript
 * import { createPlaywrightConfig } from '@jejunetwork/tests/playwright.config.base';
 * export default createPlaywrightConfig({
 *   appPort: 4006,
 *   appName: 'bazaar',
 * });
 * ```
 */

import { defineConfig, devices } from '@playwright/test';

export interface PlaywrightConfigOptions {
  /** Port the app runs on */
  appPort: number;
  /** App name for test naming */
  appName: string;
  /** Test directory (default: ./tests) */
  testDir?: string;
  /** Test match pattern (default: **\/*.test.ts, excluding wallet tests) */
  testMatch?: string;
  /** Test ignore pattern */
  testIgnore?: string | string[];
  /** Timeout in ms (default: 60000) */
  timeout?: number;
  /** Base URL override */
  baseURL?: string;
  /** Number of retries (default: 0 for local, 2 for CI) */
  retries?: number;
  /** Number of workers */
  workers?: number;
  /** Run tests in headless mode (default: true) */
  headless?: boolean;
}

export function createPlaywrightConfig(options: PlaywrightConfigOptions) {
  const {
    appPort,
    appName,
    testDir = './tests',
    testMatch = '**/*.test.ts',
    testIgnore = ['**/*.wallet.test.ts', '**/wallet-setup/**'],
    timeout = 60000,
    baseURL = `http://localhost:${appPort}`,
    retries = process.env.CI ? 2 : 0,
    workers = process.env.CI ? 1 : undefined,
    headless = true,
  } = options;

  return defineConfig({
    testDir,
    testMatch,
    testIgnore,
    timeout,
    
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries,
    workers,
    
    reporter: process.env.CI ? [
      ['list'],
      ['html', { open: 'never' }],
      ['json', { outputFile: 'test-results.json' }],
    ] : [['list']],

    use: {
      baseURL,
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      headless,
    },

    projects: [
      {
        name: `${appName}-chromium`,
        use: { ...devices['Desktop Chrome'] },
      },
      // Add more browsers for CI
      ...(process.env.CI ? [
        {
          name: `${appName}-firefox`,
          use: { ...devices['Desktop Firefox'] },
        },
      ] : []),
    ],

    // Web server configuration
    webServer: process.env.CI ? undefined : {
      command: `bun run dev`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },

    // Output
    outputDir: './test-results',
    
    // Environment
    metadata: {
      appName,
      appPort,
    },
  });
}

export default createPlaywrightConfig;
