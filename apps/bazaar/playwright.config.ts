/**
 * Bazaar Playwright Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { CORE_PORTS } from '@jejunetwork/config'
import { createAppConfig } from '@jejunetwork/tests'

const BAZAAR_PORT = CORE_PORTS.BAZAAR.get()

export default createAppConfig({
  name: 'bazaar',
  port: BAZAAR_PORT,
  testDir: './tests/e2e',
  timeout: 120000,
  webServer: {
    command: 'bun run dev',
    timeout: 120000,
  },
})
