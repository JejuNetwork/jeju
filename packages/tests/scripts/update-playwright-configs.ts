#!/usr/bin/env bun
/**
 * Update all playwright.config.ts files to use @jejunetwork/config/ports
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface AppManifest {
  name: string
  ports?: {
    main?: number
  }
}

// Port mapping from CORE_PORTS constant names to app names
const APP_PORT_MAPPING: Record<string, string> = {
  gateway: 'CORE_PORTS.GATEWAY',
  bazaar: 'CORE_PORTS.BAZAAR',
  autocrat: 'CORE_PORTS.AUTOCRAT_API',
  factory: 'CORE_PORTS.FACTORY',
  documentation: 'CORE_PORTS.DOCUMENTATION',
  indexer: 'CORE_PORTS.INDEXER_GRAPHQL',
  wallet: 'CORE_PORTS.WALLET',
  node: 'CORE_PORTS.NODE_API',
  monitoring: 'CORE_PORTS.MONITORING',
  vpn: 'CORE_PORTS.VPN_WEB',
  oauth3: 'CORE_PORTS.OAUTH3_API',
  crucible: 'CORE_PORTS.CRUCIBLE_API',
  dws: 'CORE_PORTS.DWS_API',
  example: 'CORE_PORTS.EXAMPLE',
}

// Default ports for apps not in CORE_PORTS
const DEFAULT_PORTS: Record<string, number> = {
  example: 3000,
  wallet: 3000,
}

function findMonorepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
      return dir
    }
    dir = join(dir, '..')
  }
  return process.cwd()
}

function generatePlaywrightConfig(appName: string, portExpr: string, baseUrl?: string): string {
  const envVarCheck = APP_PORT_MAPPING[appName]
    ? `const PORT = ${portExpr}.get()`
    : `const PORT = ${portExpr}`

  const actualBaseUrl = baseUrl || `\`http://localhost:\${PORT}\``

  return `/**
 * ${appName.charAt(0).toUpperCase() + appName.slice(1)} Playwright Configuration
 */
import { CORE_PORTS } from '@jejunetwork/config/ports'
import { defineConfig, devices } from '@playwright/test'

${envVarCheck}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 120000,

  use: {
    baseURL: ${actualBaseUrl},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.SKIP_WEBSERVER ? undefined : {
    command: 'bun run dev',
    url: ${actualBaseUrl},
    reuseExistingServer: true,
    timeout: 120000,
  },
})
`
}

async function main() {
  const rootDir = findMonorepoRoot()
  const appsDir = join(rootDir, 'apps')

  console.log('Updating playwright.config.ts files...\n')

  const entries = readdirSync(appsDir, { withFileTypes: true })
  let updated = 0

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    const appPath = join(appsDir, entry.name)
    const playwrightPath = join(appPath, 'playwright.config.ts')

    if (!existsSync(playwrightPath)) continue

    const appName = entry.name
    let portExpr = APP_PORT_MAPPING[appName]
    let baseUrl: string | undefined

    // Special cases
    if (appName === 'documentation') {
      baseUrl = '`http://localhost:${PORT}/jeju`'
    }

    if (!portExpr) {
      // Use default port
      const defaultPort = DEFAULT_PORTS[appName] || 3000
      portExpr = String(defaultPort)
    }

    const config = generatePlaywrightConfig(appName, portExpr, baseUrl)
    writeFileSync(playwrightPath, config)
    console.log(`  ✓ ${appName}/playwright.config.ts`)
    updated++
  }

  console.log(`\nUpdated ${updated} playwright configs.`)
}

main().catch(console.error)

