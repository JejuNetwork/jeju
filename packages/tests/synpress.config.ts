/**
 * Default Synpress Configuration for Jeju E2E Tests
 *
 * This is the root synpress config used by `jeju test e2e`.
 * Apps can override this by creating their own synpress.config.ts.
 *
 * Usage:
 *   jeju test e2e              # Run all E2E tests
 *   jeju test e2e --smoke      # Run smoke tests only
 *   jeju test e2e --app gateway # Test specific app
 *   jeju test e2e --build-cache # Build wallet cache
 */

import {
  createSynpressConfig,
  createWalletSetup,
} from './shared/synpress.config.base'

// Default port for smoke tests (no specific app)
const DEFAULT_PORT = parseInt(process.env.GATEWAY_PORT || '4001', 10)

// Export Playwright config
export default createSynpressConfig({
  appName: 'jeju',
  port: DEFAULT_PORT,
  testDir: './smoke',
  timeout: 180000,
  overrides: {
    // Don't require a web server for smoke tests
    webServer: undefined,
  },
})

// Export wallet setup for Synpress
export const basicSetup = createWalletSetup()
