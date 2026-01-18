/**
 * Node Playwright Configuration
 *
 * Native Tauri app testing is the default mode.
 * Set TAURI_WEB=1 to test web preview instead of native app.
 */
import { getTestConfig } from '@jejunetwork/config/test-config'
import { defineConfig, devices } from '@playwright/test'

const config = getTestConfig('node')
// Native mode is default for Tauri apps
const isNativeMode = process.env.TAURI_WEB !== '1'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: !isNativeMode,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: isNativeMode ? 1 : process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 120000,

  use: {
    baseURL: isNativeMode ? undefined : config.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: isNativeMode
    ? [
        {
          name: 'tauri-native',
          use: {
            connectOptions: {
              wsEndpoint: `ws://localhost:${process.env.TAURI_DRIVER_PORT || 4444}`,
            },
          },
        },
      ]
    : [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
      ],

  // When testing against remote (testnet/mainnet) or native mode, no webserver is started
  webServer:
    isNativeMode || config.skipWebServer
      ? undefined
      : {
          command: 'bun run scripts/dev.ts',
          url: config.baseURL,
          reuseExistingServer: true,
          timeout: 180000,
        },
})
