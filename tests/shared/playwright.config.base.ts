import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

/**
 * Shared Playwright configuration for Jeju apps
 *
 * This provides a consistent testing setup across all apps with:
 * - Screenshot capture for visual verification
 * - Dappwright wallet support
 * - Standardized timeouts and retries
 * - CI/CD optimizations
 *
 * Usage in app's playwright.config.ts:
 * ```typescript
 * import { createJejuPlaywrightConfig } from '../../tests/shared/playwright.config.base';
 *
 * export default createJejuPlaywrightConfig({
 *   appName: 'bazaar',
 *   port: 4006,
 *   testDir: './tests/e2e',
 * });
 * ```
 */

export interface JejuPlaywrightConfig {
  /** App name for organizing test results */
  appName: string;
  /** Port the app runs on */
  port: number;
  /** Test directory relative to app root */
  testDir: string;
  /** Base URL override (default: http://localhost:{port}) */
  baseURL?: string;
  /** Whether to start web server automatically (default: true in non-CI) */
  webServer?: boolean | {
    command: string;
    url?: string;
    reuseExistingServer?: boolean;
    timeout?: number;
  };
  /** Additional Playwright config overrides */
  overrides?: Partial<PlaywrightTestConfig>;
}

export function createJejuPlaywrightConfig(config: JejuPlaywrightConfig) {
  const {
    appName,
    port,
    testDir,
    baseURL = `http://localhost:${port}`,
    webServer = true,
    overrides = {},
  } = config;

  const screenshotDir = `test-results/screenshots/${appName}`;
  const videoDir = `test-results/videos/${appName}`;

  return defineConfig({
    testDir,
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,

    reporter: [
      ['html', {
        outputFolder: `playwright-report/${appName}`,
        open: process.env.CI ? 'never' : 'on-failure',
      }],
      ['json', {
        outputFile: `test-results/${appName}/results.json`
      }],
      ['list'],
    ],

    timeout: 120000, // 2 minutes per test

    expect: {
      timeout: 15000, // 15 seconds for assertions
    },

    use: {
      baseURL,
      trace: 'on-first-retry',

      // Enable screenshot capture for ALL tests
      screenshot: {
        mode: 'on',
        fullPage: true,
      },

      // Enable video recording for ALL tests
      video: {
        mode: 'on',
        size: { width: 1280, height: 720 },
      },

      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      actionTimeout: 15000,

      // Required for Dappwright/MetaMask
      headless: false,
    },

    // Output directories
    outputDir: `test-results/${appName}/artifacts`,

    projects: [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          // Dappwright requires headful mode
          headless: false,
        },
      },
    ],

    // Web server configuration
    ...(webServer !== false && {
      webServer: typeof webServer === 'boolean'
        ? {
            command: 'bun run dev',
            url: baseURL,
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
          }
        : webServer,
    }),

    // Allow overrides
    ...overrides,
  });
}

/**
 * Helper to create screenshot path for tests
 *
 * Usage in tests:
 * ```typescript
 * import { screenshotPath } from '../../tests/shared/playwright.config.base';
 *
 * await page.screenshot({
 *   path: screenshotPath('bazaar', 'homepage', '01-initial'),
 *   fullPage: true
 * });
 * ```
 */
export function screenshotPath(
  appName: string,
  feature: string,
  step: string
): string {
  return `test-results/screenshots/${appName}/${feature}/${step}.png`;
}

/**
 * Helper to create video path for tests
 */
export function videoPath(
  appName: string,
  testName: string
): string {
  return `test-results/videos/${appName}/${testName}.webm`;
}

/**
 * Legacy base config for backwards compatibility
 */
export const baseConfig = {
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

  timeout: 60000,

  expect: {
    timeout: 10000,
  },

  use: {
    trace: 'on-first-retry' as const,
    screenshot: 'only-on-failure' as const,
    video: 'retain-on-failure' as const,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    actionTimeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
};
