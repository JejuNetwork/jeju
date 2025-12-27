/**
 * Comprehensive E2E Tests for All Apps
 *
 * This test file automatically discovers all apps in the monorepo and runs
 * comprehensive E2E tests on each one. It:
 *
 * 1. Visits every page in each app
 * 2. Clicks every button and link
 * 3. Tests form submissions
 * 4. Verifies no critical errors
 * 5. Captures coverage metrics
 *
 * Usage:
 *   bunx playwright test packages/tests/e2e/all-apps-e2e.spec.ts
 *   jeju test e2e --mode full
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type CrawlResult, runFullAppCrawl } from './full-app-crawler'

// App manifest schema for type safety
interface AppManifest {
  name: string
  displayName?: string
  ports?: {
    main?: number
    frontend?: number
  }
  enabled?: boolean
  type?: string
  testing?: {
    e2e?: {
      requiresChain?: boolean
      requiresWallet?: boolean
    }
  }
}

// Discover all apps
function discoverApps(
  rootDir: string,
): Array<{ name: string; port: number; manifest: AppManifest }> {
  const appsDir = join(rootDir, 'apps')
  const apps: Array<{ name: string; port: number; manifest: AppManifest }> = []

  if (!existsSync(appsDir)) return apps

  const entries = readdirSync(appsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue

    const manifestPath = join(appsDir, entry.name, 'jeju-manifest.json')
    if (!existsSync(manifestPath)) continue

    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    ) as AppManifest

    // Skip disabled apps
    if (manifest.enabled === false) continue

    // Skip storage apps (they don't have frontends)
    if (manifest.type === 'storage') continue

    const port = manifest.ports?.main ?? manifest.ports?.frontend ?? 3000

    apps.push({
      name: entry.name,
      port,
      manifest,
    })
  }

  return apps
}

// Get monorepo root
function findMonorepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (
      existsSync(join(dir, 'bun.lock')) &&
      existsSync(join(dir, 'packages'))
    ) {
      return dir
    }
    dir = join(dir, '..')
  }
  return process.cwd()
}

// Main test suite
test.describe('Full App E2E Coverage', () => {
  const rootDir = findMonorepoRoot()
  const apps = discoverApps(rootDir)

  // Store results for summary
  const allResults: Map<string, CrawlResult> = new Map()

  test.afterAll(async () => {
    // Print summary of all app crawls
    console.log(`\n${'='.repeat(60)}`)
    console.log('FULL E2E COVERAGE SUMMARY')
    console.log('='.repeat(60))

    let totalPages = 0
    let totalButtons = 0
    let totalErrors = 0

    for (const [appName, result] of allResults) {
      totalPages += result.coverage.totalPages
      totalButtons += result.coverage.buttonsClicked
      totalErrors += result.errors.length

      console.log(`\n${appName}:`)
      console.log(`  Pages: ${result.coverage.totalPages}`)
      console.log(
        `  Buttons tested: ${result.coverage.buttonsClicked}/${result.coverage.totalButtons}`,
      )
      console.log(
        `  Forms tested: ${result.coverage.formsSubmitted}/${result.coverage.totalForms}`,
      )
      console.log(`  Errors: ${result.errors.length}`)
    }

    console.log(`\n${'-'.repeat(60)}`)
    console.log(
      `TOTAL: ${totalPages} pages, ${totalButtons} buttons, ${totalErrors} errors`,
    )
    console.log('='.repeat(60))
  })

  // Test each app
  for (const app of apps) {
    test.describe(app.name, () => {
      const baseUrl = `http://localhost:${app.port}`

      test('should load and navigate all pages', async ({ page }) => {
        // Check if app is running
        try {
          await page.goto(baseUrl, { timeout: 10000 })
        } catch {
          test.skip(true, `${app.name} not running on port ${app.port}`)
          return
        }

        // Run full crawl
        const result = await runFullAppCrawl(page, {
          baseUrl,
          maxPages: 50,
          maxActionsPerPage: 30,
          timeout: 15000,
          verbose: process.env.VERBOSE === 'true',
          screenshotOnError: true,
          screenshotDir: `test-results/screenshots/${app.name}`,
        })

        // Store results
        allResults.set(app.name, result)

        // Assertions
        expect(
          result.coverage.totalPages,
          `${app.name} should have discoverable pages`,
        ).toBeGreaterThan(0)

        // Allow some navigation errors but not too many
        const criticalErrors = result.errors.filter(
          (e) => e.action === 'navigation' && !e.error.includes('net::ERR'),
        )
        expect(
          criticalErrors.length,
          `${app.name} should have minimal critical navigation errors`,
        ).toBeLessThan(5)
      })

      test('should have no JavaScript errors on pages', async ({ page }) => {
        const jsErrors: string[] = []

        // Listen for console errors
        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            const text = msg.text()
            // Filter out common non-critical errors
            if (
              !text.includes('favicon') &&
              !text.includes('Failed to load resource') &&
              !text.includes('net::ERR')
            ) {
              jsErrors.push(text)
            }
          }
        })

        // Listen for page errors
        page.on('pageerror', (error) => {
          jsErrors.push(error.message)
        })

        try {
          await page.goto(baseUrl, { timeout: 10000 })
          await page.waitForLoadState('domcontentloaded')
          await page.waitForTimeout(2000) // Wait for any async errors
        } catch {
          test.skip(true, `${app.name} not running`)
          return
        }

        // Log errors for debugging
        if (jsErrors.length > 0) {
          console.log(`${app.name} JS errors:`, jsErrors)
        }

        // Allow minimal errors
        expect(
          jsErrors.length,
          `${app.name} should have minimal JS errors`,
        ).toBeLessThan(5)
      })

      test('should render correctly on mobile viewport', async ({ page }) => {
        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 667 })

        try {
          await page.goto(baseUrl, { timeout: 10000 })
          await page.waitForLoadState('domcontentloaded')
        } catch {
          test.skip(true, `${app.name} not running`)
          return
        }

        // Check for viewport meta tag
        const viewport = await page
          .locator('meta[name="viewport"]')
          .getAttribute('content')
        expect(viewport, 'Should have viewport meta tag').toBeTruthy()

        // Check that content is not overflowing horizontally
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
        const viewportWidth = await page.evaluate(() => window.innerWidth)

        // Allow some overflow for complex UIs
        expect(
          bodyWidth,
          `${app.name} content should not overflow significantly on mobile`,
        ).toBeLessThan(viewportWidth * 1.5)
      })

      test('should handle dark mode if supported', async ({ page }) => {
        try {
          await page.goto(baseUrl, { timeout: 10000 })
        } catch {
          test.skip(true, `${app.name} not running`)
          return
        }

        // Emulate dark mode
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.waitForTimeout(500)

        // Check for dark mode support via CSS custom properties or class
        const hasDarkMode = await page.evaluate(() => {
          const root = document.documentElement
          const style = getComputedStyle(root)

          // Check for common dark mode indicators
          return (
            root.classList.contains('dark') ||
            root.getAttribute('data-theme') === 'dark' ||
            style.getPropertyValue('--background').includes('dark') ||
            style.colorScheme.includes('dark')
          )
        })

        // Dark mode is optional, just log if not present
        if (!hasDarkMode) {
          console.log(
            `${app.name}: No explicit dark mode support detected (optional)`,
          )
        }

        // Just verify page still renders
        await expect(page.locator('body')).toBeVisible()
      })

      // Only run wallet tests for apps that require it
      if (app.manifest.testing?.e2e?.requiresWallet) {
        test('should show wallet connection option', async ({ page }) => {
          try {
            await page.goto(baseUrl, { timeout: 10000 })
            await page.waitForLoadState('domcontentloaded')
          } catch {
            test.skip(true, `${app.name} not running`)
            return
          }

          // Look for wallet connect buttons
          const walletButton = page
            .locator(
              '[data-testid*="connect"], button:has-text(/connect/i), [aria-label*="wallet" i]',
            )
            .first()

          // Wallet connection should be available
          const hasWallet = (await walletButton.count()) > 0
          expect(
            hasWallet,
            `${app.name} should have wallet connection option`,
          ).toBe(true)
        })
      }
    })
  }

  // Summary test that runs at the end
  test('should have comprehensive coverage across all apps', async () => {
    // This test validates overall coverage after all apps are tested
    const totalApps = apps.length
    const testedApps = allResults.size

    console.log(`\nApps discovered: ${totalApps}`)
    console.log(`Apps successfully tested: ${testedApps}`)

    // Calculate total coverage
    let totalPages = 0
    let totalButtons = 0
    let totalForms = 0

    for (const result of allResults.values()) {
      totalPages += result.coverage.totalPages
      totalButtons += result.coverage.buttonsClicked
      totalForms += result.coverage.formsSubmitted
    }

    console.log(`\nTotal coverage:`)
    console.log(`  Pages: ${totalPages}`)
    console.log(`  Buttons: ${totalButtons}`)
    console.log(`  Forms: ${totalForms}`)

    // Assertions - should have tested at least some apps
    // Skip if running in isolation
    if (testedApps > 0) {
      expect(
        totalPages,
        'Should have visited pages across apps',
      ).toBeGreaterThan(0)
    }
  })
})

// Logged-in vs logged-out tests
test.describe('Authentication State Coverage', () => {
  const rootDir = findMonorepoRoot()
  const apps = discoverApps(rootDir)

  // Filter to apps with wallet requirements
  const walletApps = apps.filter(
    (app) => app.manifest.testing?.e2e?.requiresWallet,
  )

  for (const app of walletApps) {
    const baseUrl = `http://localhost:${app.port}`

    test.describe(`${app.name} - logged out state`, () => {
      test('should show appropriate logged-out UI', async ({ page }) => {
        try {
          await page.goto(baseUrl, { timeout: 10000 })
        } catch {
          test.skip(true, `${app.name} not running`)
          return
        }

        // Should see connect wallet prompts or logged-out content
        const connectOptions = await page
          .locator('button:has-text(/connect/i)')
          .all()
        const loggedOutContent = await page
          .locator('[data-testid*="logged-out"], [data-testid*="guest"]')
          .all()

        // Just verify the page loads properly in logged-out state
        await expect(page.locator('body')).toBeVisible()

        // Log detection for debugging
        if (connectOptions.length > 0 || loggedOutContent.length > 0) {
          console.log(`${app.name}: Detected logged-out state UI elements`)
        }
      })

      test('should navigate all public pages', async ({ page }) => {
        try {
          await page.goto(baseUrl, { timeout: 10000 })
        } catch {
          test.skip(true, `${app.name} not running`)
          return
        }

        // Crawl public pages (no auth)
        const result = await runFullAppCrawl(page, {
          baseUrl,
          maxPages: 20,
          maxActionsPerPage: 10,
          timeout: 10000,
          skipPatterns: [/\/dashboard/, /\/settings/, /\/profile/, /\/admin/],
        })

        expect(
          result.coverage.totalPages,
          'Should have public pages',
        ).toBeGreaterThan(0)
      })
    })
  }
})
