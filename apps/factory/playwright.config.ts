/**
 * Factory Playwright Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { createAppConfig } from '@jejunetwork/tests'

const FACTORY_PORT = parseInt(process.env.PORT || '4009', 10)

export default createAppConfig({
  name: 'factory',
  port: FACTORY_PORT,
  testDir: './tests/e2e',
  webServer: {
    command: 'bun run dev',
    timeout: 120000,
  },
})
