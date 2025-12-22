import { createAppConfig } from '@jejunetwork/tests'

const DOCS_PORT = parseInt(process.env.DOCUMENTATION_PORT || '4004', 10)

export default createAppConfig({
  name: 'documentation',
  port: DOCS_PORT,
  testDir: './tests/e2e',
  baseURL: `http://localhost:${DOCS_PORT}/jeju`,
  webServer: {
    command: 'bun run dev',
    timeout: 120000,
  },
})
