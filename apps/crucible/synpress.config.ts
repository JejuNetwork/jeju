/**
 * Crucible Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { createSynpressConfig } from '@jejunetwork/tests/playwright-only'

const CRUCIBLE_PORT = parseInt(process.env.PORT || '4020', 10)

export default createSynpressConfig({
  appName: 'crucible',
  port: CRUCIBLE_PORT,
  testDir: './tests/synpress',
  timeout: 120000,
})
