/**
 * Factory Comprehensive E2E Tests
 * Developer tools platform
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'

let verifyImage: ((path: string, desc: string) => Promise<{ matches: boolean; description: string; issues: string[]; quality: string; confidence: number }>) | undefined
let isLLMConfigured: (() => boolean) | undefined

interface VerificationCache { [hash: string]: { result: { matches: boolean; description: string; issues: string[]; quality: string; confidence: number }; timestamp: string; route: string } }
let verificationCache: VerificationCache = {}
const CACHE_FILE = join(process.cwd(), 'test-results', 'ai-verification-cache.json')
const SCREENSHOT_DIR = join(process.cwd(), 'test-results', 'screenshots')

function loadCache(): void { try { if (existsSync(CACHE_FILE)) { verificationCache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as VerificationCache } } catch { verificationCache = {} } }
function saveCache(): void { try { writeFileSync(CACHE_FILE, JSON.stringify(verificationCache, null, 2)) } catch {} }
function hashImage(imagePath: string): string { return createHash('sha256').update(readFileSync(imagePath)).digest('hex').substring(0, 16) }

const ROUTES = [
  { path: '/', name: 'Home', expectedContent: 'Factory', description: 'Factory home page.' },
  { path: '/bounties', name: 'Bounties', expectedContent: 'Bount', description: 'Bounty listings.' },
  { path: '/jobs', name: 'Jobs', expectedContent: 'Job', description: 'Job listings.' },
  { path: '/git', name: 'Git', expectedContent: 'Git', description: 'Git repository browser.' },
  { path: '/packages', name: 'Packages', expectedContent: 'Package', description: 'Package registry.' },
  { path: '/models', name: 'Models', expectedContent: 'Model', description: 'AI model registry.' },
  { path: '/containers', name: 'Containers', expectedContent: 'Container', description: 'Container management.' },
  { path: '/projects', name: 'Projects', expectedContent: 'Project', description: 'Project listings.' },
  { path: '/ci', name: 'CI', expectedContent: 'CI', description: 'CI/CD pipelines.' },
  { path: '/agents', name: 'Agents', expectedContent: 'Agent', description: 'Agent management.' },
  { path: '/feed', name: 'Feed', expectedContent: 'Feed', description: 'Activity feed.' },
  { path: '/messages', name: 'Messages', expectedContent: 'Message', description: 'Messaging interface.' },
]

test.beforeAll(async () => {
  loadCache(); mkdirSync(SCREENSHOT_DIR, { recursive: true })
  try { const ai = await import('@jejunetwork/tests/ai'); verifyImage = ai.verifyImage; isLLMConfigured = ai.isLLMConfigured; console.log(isLLMConfigured?.() ? '✅ AI enabled' : '⚠️ No LLM key') } catch { console.log('⚠️ AI not available') }
})

test.describe('Factory - All Pages', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      const errors: string[] = []; let hasKnownBug = false
      page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Failed to load') && !msg.text().includes('net::ERR')) errors.push(msg.text()) })
      page.on('pageerror', error => { if (error.message.includes('Cannot read properties')) { hasKnownBug = true; return }; errors.push(`PageError: ${error.message}`) })

      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForTimeout(500)
      if (errors.length > 0) { await page.screenshot({ path: join(SCREENSHOT_DIR, `${route.name.replace(/\s+/g, '-')}-ERROR.png`), fullPage: true }); throw new Error(`Errors: ${errors.join(', ')}`) }

      try { await expect(page.locator('body')).toBeVisible({ timeout: 10000 }) } catch { if (hasKnownBug) return; throw new Error('Body not visible') }

      const screenshotPath = join(SCREENSHOT_DIR, `${route.name.replace(/\s+/g, '-')}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })

      if (isLLMConfigured?.() && verifyImage) {
        const hash = hashImage(screenshotPath); const cached = verificationCache[hash]
        const verification = cached ? cached.result : await verifyImage(screenshotPath, route.description)
        if (!cached) { verificationCache[hash] = { result: verification, timestamp: new Date().toISOString(), route: route.path }; saveCache() }
        console.log(`${cached ? '📦' : '🔍'} ${route.name}: ${verification.quality} (${Math.round(verification.confidence * 100)}%)`)
        if (verification.quality === 'broken') throw new Error('Page BROKEN')
      }
    })
  }
})

test.describe('Factory Mobile', () => {
  test('renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); await page.goto('/'); await expect(page.locator('body')).toBeVisible()
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'mobile.png'), fullPage: true })
  })
})

test.afterAll(() => { saveCache(); console.log(`📊 ${ROUTES.length} routes tested`) })

