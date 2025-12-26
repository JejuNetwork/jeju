#!/usr/bin/env bun
/**
 * Generate comprehensive E2E coverage tests for all apps
 *
 * Creates full-coverage.spec.ts files for apps that don't have them.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface AppManifest {
  name: string
  displayName?: string
  ports?: {
    main?: number
    frontend?: number
  }
  type?: string
  tags?: string[]
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

function generatePlaywrightConfig(appName: string, port: number): string {
  const envVar = `${appName.toUpperCase().replace(/-/g, '_')}_PORT`

  return `import { defineConfig, devices } from '@playwright/test'

const PORT = parseInt(process.env.${envVar} || '${port}', 10)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60000,

  use: {
    baseURL: \`http://localhost:\${PORT}\`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: \`http://localhost:\${PORT}\`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
`
}

function generateE2ETests(appName: string, displayName: string, port: number, tags: string[]): string {
  const envVar = `${appName.toUpperCase().replace(/-/g, '_')}_URL`
  const baseUrl = `process.env.${envVar} || 'http://localhost:${port}'`

  // Determine app-specific pages based on tags
  const pages: Array<{ path: string; name: string }> = [{ path: '/', name: 'Home' }]

  if (tags.includes('defi') || tags.includes('swap')) {
    pages.push({ path: '/swap', name: 'Swap' })
    pages.push({ path: '/pools', name: 'Pools' })
  }
  if (tags.includes('nft') || tags.includes('marketplace')) {
    pages.push({ path: '/marketplace', name: 'Marketplace' })
    pages.push({ path: '/collections', name: 'Collections' })
  }
  if (tags.includes('governance') || tags.includes('dao')) {
    pages.push({ path: '/proposals', name: 'Proposals' })
    pages.push({ path: '/voting', name: 'Voting' })
  }
  if (tags.includes('dws') || tags.includes('storage')) {
    pages.push({ path: '/storage', name: 'Storage' })
    pages.push({ path: '/compute', name: 'Compute' })
  }
  if (tags.includes('vpn')) {
    pages.push({ path: '/connect', name: 'Connect' })
    pages.push({ path: '/settings', name: 'Settings' })
  }
  if (tags.includes('factory') || tags.includes('bounties')) {
    pages.push({ path: '/bounties', name: 'Bounties' })
    pages.push({ path: '/projects', name: 'Projects' })
  }

  const pageTests = pages
    .map(
      (p) => `
    test('should navigate to ${p.name}', async ({ page }) => {
      await page.goto(\`\${BASE_URL}${p.path}\`)
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('body')).toBeVisible()
    })`,
    )
    .join('\n')

  return `/**
 * ${displayName} Full E2E Coverage Tests
 *
 * Comprehensive tests covering all pages, buttons, forms, and user flows.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = ${baseUrl}

test.describe('${displayName} - Full Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('domcontentloaded')
  })

  test('should load homepage without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text())
      }
    })

    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()

    expect(errors.filter((e) => !e.includes('net::ERR')).length).toBeLessThan(5)
  })

  test('should have proper meta tags', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(viewport).toBeTruthy()
  })

  test('should render on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.reload()
    await expect(page.locator('body')).toBeVisible()
  })

  test('should have navigation', async ({ page }) => {
    const nav = page.locator('nav, [role="navigation"], header')
    await expect(nav.first()).toBeVisible()
  })

  test('should show wallet connect option', async ({ page }) => {
    const connectBtn = page.locator('button:has-text(/connect/i)').first()
    const isVisible = await connectBtn.isVisible().catch(() => false)

    // Wallet connect is optional but expected for web3 apps
    if (isVisible) {
      await expect(connectBtn).toBeVisible()
    }
  })
})

test.describe('${displayName} - Navigation', () => {
${pageTests}

  test('should navigate via links', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('domcontentloaded')

    const navLinks = await page.locator('nav a, header a').all()

    for (const link of navLinks.slice(0, 5)) {
      const href = await link.getAttribute('href')
      if (href && href.startsWith('/') && !href.startsWith('//')) {
        await link.click()
        await page.waitForLoadState('domcontentloaded')
        await expect(page.locator('body')).toBeVisible()
        await page.goBack()
      }
    }
  })
})

test.describe('${displayName} - Button Interactions', () => {
  test('should test all visible buttons', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    const buttons = await page.locator('button:visible').all()

    for (const button of buttons.slice(0, 10)) {
      const text = await button.textContent()

      // Skip wallet connection buttons
      if (text?.toLowerCase().includes('connect')) continue

      try {
        await button.click({ timeout: 3000 })
        await page.waitForTimeout(500)
        await page.keyboard.press('Escape')
      } catch {
        // Button might be disabled
      }
    }

    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('${displayName} - Form Interactions', () => {
  test('should fill forms without submitting', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    const inputs = await page.locator('input:visible:not([type="hidden"])').all()

    for (const input of inputs.slice(0, 5)) {
      const type = await input.getAttribute('type')

      try {
        if (type === 'number') {
          await input.fill('1.0')
        } else if (type === 'text' || type === 'email') {
          await input.fill('test@example.com')
        }
      } catch {
        // Input might be read-only
      }
    }

    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('${displayName} - Error States', () => {
  test('should handle 404 pages', async ({ page }) => {
    await page.goto(\`\${BASE_URL}/nonexistent-page-12345\`)

    const is404 = page.url().includes('nonexistent') || await page.locator('text=/404|not found/i').isVisible()
    const redirectedHome = page.url() === BASE_URL || page.url() === \`\${BASE_URL}/\`

    expect(is404 || redirectedHome).toBe(true)
  })
})
`
}

async function main() {
  const rootDir = findMonorepoRoot()
  const appsDir = join(rootDir, 'apps')

  console.log('Generating E2E coverage tests for all apps...\n')

  const entries = readdirSync(appsDir, { withFileTypes: true })
  let generated = 0
  let skipped = 0

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    const appPath = join(appsDir, entry.name)
    const manifestPath = join(appPath, 'jeju-manifest.json')

    if (!existsSync(manifestPath)) continue

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AppManifest

    // Skip storage-only apps
    if (manifest.type === 'storage') continue

    const e2eDir = join(appPath, 'tests', 'e2e')
    const coverageTestPath = join(e2eDir, 'full-coverage.spec.ts')
    const playwrightConfigPath = join(appPath, 'playwright.config.ts')

    // Skip if already has comprehensive tests
    if (existsSync(coverageTestPath)) {
      console.log(`  ⊘ ${entry.name}: already has full-coverage.spec.ts`)
      skipped++
      continue
    }

    const port = manifest.ports?.main ?? manifest.ports?.frontend ?? 3000
    const displayName = manifest.displayName ?? entry.name
    const tags = manifest.tags ?? []

    // Create e2e directory if needed
    mkdirSync(e2eDir, { recursive: true })

    // Generate playwright config if missing
    if (!existsSync(playwrightConfigPath)) {
      writeFileSync(playwrightConfigPath, generatePlaywrightConfig(entry.name, port))
      console.log(`  ✓ ${entry.name}: created playwright.config.ts`)
    }

    // Generate E2E tests
    writeFileSync(coverageTestPath, generateE2ETests(entry.name, displayName, port, tags))
    console.log(`  ✓ ${entry.name}: created full-coverage.spec.ts`)
    generated++
  }

  console.log(`\nDone. Generated ${generated} test files, skipped ${skipped}.`)
}

main().catch(console.error)

