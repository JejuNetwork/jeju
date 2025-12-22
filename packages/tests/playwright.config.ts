/**
 * Root Playwright Configuration for packages/tests E2E tests
 * Uses shared config from @jejunetwork/tests
 */
import { createAppConfig } from './shared/playwright.config.base'

// Default port - tests are infrastructure-level, not app-specific
const DEFAULT_PORT = parseInt(process.env.TEST_PORT || '4001', 10)

export default createAppConfig({
  name: 'tests',
  port: DEFAULT_PORT,
  testDir: './e2e',
  timeout: 60000,
})
