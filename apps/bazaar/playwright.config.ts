/**
 * Bazaar Playwright Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { createAppConfig } from '@jejunetwork/tests'

const BAZAAR_PORT = parseInt(process.env.BAZAAR_PORT || '4006', 10)

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
