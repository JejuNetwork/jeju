/**
 * DWS Frontend Synpress Configuration
 * Uses shared config from @jejunetwork/tests
 */
import {
  createSynpressConfig,
  createWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests'

const DWS_FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '4031', 10)

export default createSynpressConfig({
  appName: 'dws-frontend',
  port: DWS_FRONTEND_PORT,
  testDir: './tests',
  timeout: 60000,
  overrides: {
    testMatch: ['**/*.spec.ts'],
    expect: {
      timeout: 10000,
    },
    webServer: {
      command: 'bun run dev',
      url: `http://localhost:${DWS_FRONTEND_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  },
})

export const basicSetup = createWalletSetup()
export { PASSWORD }
