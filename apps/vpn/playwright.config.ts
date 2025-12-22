/**
 * VPN Playwright Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { createAppConfig } from '@jejunetwork/tests'

const VPN_PORT = parseInt(process.env.VPN_PORT || '1421', 10)

export default createAppConfig({
  name: 'vpn',
  port: VPN_PORT,
  testDir: './tests/e2e',
  webServer: {
    command: 'bun run dev:web',
    timeout: 60000,
  },
})
