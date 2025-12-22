/**
 * Playwright E2E Configuration for VPN App
 */

import { createAppConfig } from '@jejunetwork/tests'

export default createAppConfig({
  name: 'vpn',
  port: 1421,
  testDir: './tests/e2e',
  webServer: {
    command: 'bun run dev:web',
    timeout: 120000,
  },
})
