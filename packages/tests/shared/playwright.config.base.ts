/**
 * Base Playwright Configuration for All Network Apps
 *
 * Apps should extend this config for consistency.
 *
 * Usage in app:
 * ```typescript
 * import { createAppConfig } from '@jejunetwork/tests';
 * export default createAppConfig({ name: 'my-app', port: 4000 });
 * ```
 */

import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test'

// Import from canonical source
import { getTestEnv } from './utils'

// Re-export for backwards compatibility
export { getTestEnv }

export interface AppConfigOptions {
  name: string
  port: number
  testDir?: string
  timeout?: number
  retries?: number
  workers?: number
  baseURL?: string
  webServer?: {
    command: string
    timeout?: number
  }
}

const DEFAULT_TIMEOUTS = {
  test: 120000,
  expect: 30000,
  action: 30000,
  navigation: 30000,
} as const

export function createAppConfig(
  options: AppConfigOptions,
): PlaywrightTestConfig {
  const {
    name,
    port,
    testDir = './tests/e2e',
    timeout = DEFAULT_TIMEOUTS.test,
    retries = process.env.CI ? 2 : 0,
    workers = process.env.CI ? 1 : undefined,
    baseURL = `http://localhost:${port}`,
    webServer,
  } = options

  return defineConfig({
    testDir,
    fullyParallel: !process.env.CI,
    forbidOnly: !!process.env.CI,
    retries,
    workers,
    timeout,

    expect: {
      timeout: DEFAULT_TIMEOUTS.expect,
    },

    reporter: [
      ['list'],
      ['html', { outputFolder: `playwright-report-${name}` }],
      ['json', { outputFile: `test-results-${name}.json` }],
    ],

    use: {
      baseURL,
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      actionTimeout: DEFAULT_TIMEOUTS.action,
      navigationTimeout: DEFAULT_TIMEOUTS.navigation,
    },

    projects: [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1280, height: 720 },
        },
      },
    ],

    webServer: webServer
      ? {
          command: webServer.command,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: webServer.timeout ?? 120000,
        }
      : undefined,
  })
}

export default createAppConfig

// Alias for backwards compatibility
export const createPlaywrightConfig = createAppConfig
