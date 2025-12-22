/**
 * Crucible Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { createSynpressConfig, PASSWORD } from '@jejunetwork/tests'
import basicSetup from '@jejunetwork/tests/wallet-setup'

const CRUCIBLE_PORT = parseInt(process.env.PORT || '4020', 10)

export default createSynpressConfig({
  appName: 'crucible',
  port: CRUCIBLE_PORT,
  testDir: './tests/synpress',
  timeout: 120000,
})

// Re-export wallet setup for tests
export { basicSetup, PASSWORD }
