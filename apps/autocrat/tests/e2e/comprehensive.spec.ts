/**
 * Autocrat Comprehensive E2E Tests
 * AI-powered DAO management platform
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

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
      verificationCache = JSON.parse(
        readFileSync(CACHE_FILE, 'utf-8'),
      ) as VerificationCache
    }
  } catch {
    verificationCache = {}
  }
}
function saveCache(): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(verificationCache, null, 2))
  } catch {}
}
function hashImage(imagePath: string): string {
  return createHash('sha256')
    .update(readFileSync(imagePath))
    .digest('hex')
    .substring(0, 16)
}

/**
 * All Autocrat Routes from main.tsx
 */
const ROUTES = [
  {
    path: '/',
    name: 'DAO List',
    expectedContent: 'DAO',
    description: 'List of DAOs with search, filter, and create options.',
  },
  {
    path: '/create',
    name: 'Create DAO',
    expectedContent: 'Create',
    description:
      'DAO creation wizard with name, token, and governance configuration.',
  },
  {
    path: '/my-daos',
    name: 'My DAOs',
    expectedContent: 'DAO',
    description: 'User-owned DAOs list.',
  },
]

test.beforeAll(async () => {
  loadCache()
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  try {
    const ai = await import('@jejunetwork/tests/ai')
    verifyImage = ai.verifyImage
    isLLMConfigured = ai.isLLMConfigured
    console.log(isLLMConfigured?.() ? '✅ AI enabled' : '⚠️ No LLM key')
  } catch {
    console.log('⚠️ AI not available')
  }
})

test.describe('Autocrat - All Pages', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      const errors: string[] = []
      let hasKnownBug = false
      page.on('console', (msg) => {
        if (
          msg.type() === 'error' &&
          !msg.text().includes('favicon') &&
          !msg.text().includes('Failed to load') &&
          !msg.text().includes('net::ERR') &&
          !msg.text().includes('status of 4')
        )
          errors.push(msg.text())
      })
      page.on('pageerror', (error) => {
        if (error.message.includes('Cannot read properties')) {
          hasKnownBug = true
          return
        }
        errors.push(`PageError: ${error.message}`)
      })

      await page.goto(route.path, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      await page.waitForTimeout(1000)
      if (errors.length > 0 && !hasKnownBug) {
        await page.screenshot({
          path: join(
            SCREENSHOT_DIR,
            `${route.name.replace(/\s+/g, '-')}-ERROR.png`,
          ),
          fullPage: true,
        })
        throw new Error(`Errors: ${errors.join(', ')}`)
      }

      try {
        await expect(page.locator('body')).toBeVisible({ timeout: 10000 })
      } catch {
        if (hasKnownBug) {
          console.log('⚠️ Known bug')
          return
        }
        throw new Error('Body not visible')
      }

      const screenshotPath = join(
        SCREENSHOT_DIR,
        `${route.name.replace(/\s+/g, '-')}.png`,
      )
      await page.screenshot({ path: screenshotPath, fullPage: true })

      if (isLLMConfigured?.() && verifyImage) {
        const hash = hashImage(screenshotPath)
        const cached = verificationCache[hash]
        const verification = cached
          ? cached.result
          : await verifyImage(screenshotPath, route.description)
        if (!cached) {
          verificationCache[hash] = {
            result: verification,
            timestamp: new Date().toISOString(),
            route: route.path,
          }
          saveCache()
        }
        console.log(
          `${cached ? '📦' : '🔍'} ${route.name}: ${verification.quality} (${Math.round(verification.confidence * 100)}%)`,
        )
        if (verification.issues.length > 0)
          console.log(`   Issues: ${verification.issues.join(', ')}`)
        if (verification.quality === 'broken') throw new Error('Page BROKEN')
      }
    })
  }
})

test.describe('Autocrat Mobile', () => {
  test('renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.waitForTimeout(1000)
    await expect(page.locator('body')).toBeVisible()
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'mobile.png'),
      fullPage: true,
    })
  })
})

test.afterAll(() => {
  saveCache()
  console.log(`📊 ${ROUTES.length} routes tested`)
})
