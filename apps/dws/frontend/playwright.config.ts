/**
 * DWS Frontend Playwright Configuration
 * Uses shared config from @jejunetwork/tests
 */
import { createAppConfig } from '@jejunetwork/tests'

const DWS_FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '4031', 10)
const isE2E = process.env.E2E === 'true'

export default createAppConfig({
  name: 'dws-frontend',
  port: DWS_FRONTEND_PORT,
  testDir: './tests',
  timeout: isE2E ? 60000 : 30000,
  workers: isE2E ? 1 : undefined,
  webServer: !isE2E
    ? {
        command: 'bun run dev',
        timeout: 60000,
      }
    : undefined,
})
