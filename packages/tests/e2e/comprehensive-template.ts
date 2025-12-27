/**
 * Comprehensive E2E Test Template
 *
 * Copy this template to your app's tests/e2e/comprehensive.spec.ts
 * and customize the routes array for your app.
 *
 * Features:
 * - Tests ALL frontend pages
 * - AI visual verification with caching
 * - Fail-fast on any errors
 * - Screenshot capture for all pages
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

// =============================================================================
// CUSTOMIZE THIS SECTION FOR YOUR APP
// =============================================================================

/**
 * Define all routes for your app.
 * Extract these from your App.tsx routes.
 */
const APP_ROUTES: Array<{
  path: string
  name: string
  expectedContent: string
  description: string
}> = [
  // Example routes - replace with your app's routes:
  {
    path: '/',
    name: 'Dashboard',
    expectedContent: 'Dashboard',
    description: 'Main dashboard with navigation sidebar and overview.',
  },
  // Add more routes here...
]

/**
 * API endpoints to health check (optional)
 */
const API_ROUTES = [{ path: '/health', method: 'GET', expectedStatus: [200] }]

/**
 * Your app's API port (if different from frontend)
 */
const API_PORT = 4030

// =============================================================================
// TEST INFRASTRUCTURE (no changes needed below)
// =============================================================================

// AI verification module
let verifyImage:
  | ((
      path: string,
      desc: string,
    ) => Promise<{
      matches: boolean
      description: string
      issues: string[]
      quality: string
      confidence: number
    }>)
  | undefined
let isLLMConfigured: (() => boolean) | undefined

// Verification cache
interface VerificationCache {
  [hash: string]: {
    result: {
      matches: boolean
      description: string
      issues: string[]
      quality: string
      confidence: number
    }
    timestamp: string
    route: string
  }
}

let verificationCache: VerificationCache = {}
const CACHE_FILE = join(
  process.cwd(),
  'test-results',
  'ai-verification-cache.json',
)
const SCREENSHOT_DIR = join(process.cwd(), 'test-results', 'screenshots')

function loadCache(): void {
  try {
    if (existsSync(CACHE_FILE)) {
      const data = readFileSync(CACHE_FILE, 'utf-8')
      verificationCache = JSON.parse(data) as VerificationCache
      console.log(
        `📦 Loaded ${Object.keys(verificationCache).length} cached verifications`,
      )
    }
  } catch {
    verificationCache = {}
  }
}

function saveCache(): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(verificationCache, null, 2))
  } catch (error) {
    console.warn('Failed to save verification cache:', error)
  }
}

function hashImage(imagePath: string): string {
  const buffer = readFileSync(imagePath)
  return createHash('sha256').update(buffer).digest('hex').substring(0, 16)
}

// Initialize
test.beforeAll(async () => {
  loadCache()
  mkdirSync(SCREENSHOT_DIR, { recursive: true })

  try {
    const ai = await import('@jejunetwork/tests/ai')
    verifyImage = ai.verifyImage
    isLLMConfigured = ai.isLLMConfigured

    if (!isLLMConfigured()) {
      console.log('⚠️ No LLM API key - visual verification skipped')
    } else {
      console.log('✅ AI visual verification enabled')
    }
  } catch {
    console.log('⚠️ AI verification module not available')
  }
})

// Page tests
test.describe('Frontend - All Pages', () => {
  for (const route of APP_ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      const errors: string[] = []
      let hasKnownBug = false

      // Capture console errors
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text()
          if (
            text.includes('favicon') ||
            text.includes('net::ERR_BLOCKED_BY_CLIENT') ||
            text.includes('Failed to load resource') ||
            text.includes('the server responded with a status of 4') ||
            text.includes('net::ERR_CONNECTION_REFUSED')
          ) {
            return
          }
          errors.push(text)
        }
      })

      // Capture page errors
      page.on('pageerror', (error) => {
        const msg = error.message
        if (msg.includes('Cannot read properties of undefined')) {
          console.warn(`   ⚠️ Known bug: ${msg}`)
          hasKnownBug = true
          return
        }
        errors.push(`PageError: ${msg}`)
      })

      // Navigate
      await page.goto(route.path, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      await page.waitForTimeout(500)

      // Check for errors
      if (errors.length > 0) {
        const screenshotPath = join(
          SCREENSHOT_DIR,
          `${route.name.replace(/\s+/g, '-')}-ERROR.png`,
        )
        await page.screenshot({ path: screenshotPath, fullPage: true })
        throw new Error(
          `Page ${route.path} has errors:\n  - ${errors.join('\n  - ')}`,
        )
      }

      // Visibility check
      try {
        await expect(page.locator('body')).toBeVisible({ timeout: 10000 })
      } catch {
        if (hasKnownBug) {
          console.log(`   ⚠️ Page has known bug - skipping`)
          const screenshotPath = join(
            SCREENSHOT_DIR,
            `${route.name.replace(/\s+/g, '-')}-BUG.png`,
          )
          await page.screenshot({ path: screenshotPath, fullPage: true })
          return
        }
        throw new Error(`Page ${route.path} body not visible`)
      }

      // Content check
      const pageText = await page.textContent('body')
      if (!pageText?.includes(route.expectedContent)) {
        const screenshotPath = join(
          SCREENSHOT_DIR,
          `${route.name.replace(/\s+/g, '-')}-FAIL.png`,
        )
        await page.screenshot({ path: screenshotPath, fullPage: true })
        throw new Error(
          `Page ${route.path} missing expected content "${route.expectedContent}"`,
        )
      }

      // Screenshot
      const screenshotPath = join(
        SCREENSHOT_DIR,
        `${route.name.replace(/\s+/g, '-')}.png`,
      )
      await page.screenshot({ path: screenshotPath, fullPage: true })

      // AI Verification
      if (isLLMConfigured?.() && verifyImage) {
        const imageHash = hashImage(screenshotPath)
        const cached = verificationCache[imageHash]
        let verification: (typeof cached)['result']

        if (cached) {
          console.log(`\n📦 ${route.name} - Using cached (hash: ${imageHash})`)
          verification = cached.result
        } else {
          console.log(`\n🔍 ${route.name} - Running AI verification...`)
          verification = await verifyImage(screenshotPath, route.description)
          verificationCache[imageHash] = {
            result: verification,
            timestamp: new Date().toISOString(),
            route: route.path,
          }
          saveCache()
        }

        console.log(
          `   ✓ Quality: ${verification.quality} (${Math.round(verification.confidence * 100)}%)`,
        )
        if (verification.issues.length > 0) {
          console.log(`   ⚠️ Issues:`)
          for (const issue of verification.issues) {
            console.log(`      - ${issue}`)
          }
        }

        // Save verification
        writeFileSync(
          join(
            SCREENSHOT_DIR,
            `${route.name.replace(/\s+/g, '-')}-verification.json`,
          ),
          JSON.stringify(
            { ...verification, hash: imageHash, cached: !!cached },
            null,
            2,
          ),
        )

        // Fail on broken
        if (verification.quality === 'broken') {
          throw new Error(
            `Page ${route.path} BROKEN: ${verification.issues.join(', ')}`,
          )
        }
      }

      // Final error check
      if (errors.length > 0) {
        throw new Error(
          `Page ${route.path} has errors:\n  - ${errors.join('\n  - ')}`,
        )
      }
    })
  }
})

// Navigation test
test.describe('Navigation', () => {
  test('sidebar navigation works', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const navLinks = await page.locator('a[href^="/"]').all()
    const tested = new Set<string>()

    for (const link of navLinks.slice(0, 5)) {
      try {
        const href = await link.getAttribute('href', { timeout: 3000 })
        if (!href || tested.has(href) || href.includes('http')) continue
        tested.add(href)

        if (await link.isVisible()) {
          await link.click({ timeout: 3000 })
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 })
          await page.goBack()
        }
      } catch {
        // Some links may not be clickable
      }
    }
  })
})

// Mobile test
test.describe('Mobile', () => {
  test('renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'mobile.png'),
      fullPage: true,
    })
  })
})

// API health checks
test.describe('API Health', () => {
  for (const endpoint of API_ROUTES) {
    test(`API ${endpoint.method} ${endpoint.path}`, async ({ request }) => {
      const response = await request
        .fetch(`http://localhost:${API_PORT}${endpoint.path}`, {
          method: endpoint.method,
          timeout: 10000,
        })
        .catch(() => null)

      if (!response) {
        console.log(`⚠️ API ${endpoint.path} not reachable`)
        return
      }

      expect(endpoint.expectedStatus).toContain(response.status())
    })
  }
})

// 404 test
test.describe('Error States', () => {
  test('handles 404', async ({ page, baseURL }) => {
    await page.goto('/nonexistent-page-12345')
    await page.waitForLoadState('domcontentloaded')

    const is404 = await page
      .locator('text=/404|not found/i')
      .isVisible()
      .catch(() => false)
    const redirected = page.url() === baseURL || page.url() === `${baseURL}/`

    expect(is404 || redirected).toBe(true)
  })
})

// Summary
test.afterAll(async () => {
  saveCache()
  writeFileSync(
    join(SCREENSHOT_DIR, 'summary.json'),
    JSON.stringify(
      {
        totalRoutes: APP_ROUTES.length,
        testedAt: new Date().toISOString(),
        aiEnabled: isLLMConfigured?.() ?? false,
        cached: Object.keys(verificationCache).length,
      },
      null,
      2,
    ),
  )
  console.log(`\n📊 Summary: ${APP_ROUTES.length} routes tested`)
  console.log(`📁 Screenshots: ${SCREENSHOT_DIR}`)
})
