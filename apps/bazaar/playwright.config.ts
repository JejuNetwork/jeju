import { createPlaywrightConfig } from '@jejunetwork/tests/playwright-only'

const BAZAAR_PORT = parseInt(process.env.BAZAAR_PORT || '4006', 10)

export default createPlaywrightConfig({
  name: 'bazaar',
  port: BAZAAR_PORT,
  testDir: './tests/e2e',
  webServer: {
    command: 'bun run dev',
  },
})
