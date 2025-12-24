import { createSynpressConfig } from '@jejunetwork/tests'

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '4501', 10)

export default createSynpressConfig({
  appName: 'example',
  port: FRONTEND_PORT,
  testDir: './tests/wallet',
  overrides: {
    timeout: 120000, // 2 minutes for wallet operations
    webServer: undefined,
  },
})

export { basicSetup, walletPassword } from '@jejunetwork/tests'
