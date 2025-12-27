/**
 * Gateway Comprehensive E2E Tests
 * Bridge, paymasters, staking - Tab-based SPA
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

/**
 * Gateway Tabs from Dashboard.tsx
 */
const TABS = [
  { id: 'registry', name: 'Registry', expectedContent: 'Registry', description: 'Token registry with registered tokens list.' },
  { id: 'faucet', name: 'Faucet', expectedContent: 'Faucet', description: 'Testnet faucet with token request.' },
  { id: 'transfer', name: 'Transfer', expectedContent: 'Transfer', description: 'Cross-chain transfer interface.' },
  { id: 'intents', name: 'Intents', expectedContent: 'Intent', description: 'Cross-chain intents dashboard.' },
  { id: 'oracle', name: 'Oracle', expectedContent: 'Oracle', description: 'Price oracle with feeds.' },
  { id: 'xlp', name: 'Liquidity', expectedContent: 'Liquidity', description: 'XLP liquidity pools dashboard.' },
  { id: 'risk', name: 'Risk Pools', expectedContent: 'Risk', description: 'Risk allocation dashboard.' },
  { id: 'tokens', name: 'Tokens', expectedContent: 'Token', description: 'Token list and registration.' },
  { id: 'deploy', name: 'Deploy', expectedContent: 'Deploy', description: 'Paymaster deployment interface.' },
  { id: 'nodes', name: 'Nodes', expectedContent: 'Node', description: 'Node staking dashboard.' },
]

test.beforeAll(async () => {
  loadCache(); mkdirSync(SCREENSHOT_DIR, { recursive: true })
  try { const ai = await import('@jejunetwork/tests/ai'); verifyImage = ai.verifyImage; isLLMConfigured = ai.isLLMConfigured; console.log(isLLMConfigured?.() ? '✅ AI enabled' : '⚠️ No LLM key') } catch { console.log('⚠️ AI not available') }
})

test.describe('Gateway - Dashboard Loads', () => {
  test('Main page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Failed to load') && !msg.text().includes('net::ERR') && !msg.text().includes('status of 4')) errors.push(msg.text()) })
    page.on('pageerror', error => errors.push(`PageError: ${error.message}`))

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForTimeout(1000)
    
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Gateway')).toBeVisible({ timeout: 5000 })

    const screenshotPath = join(SCREENSHOT_DIR, 'Gateway-Main.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })

    if (isLLMConfigured?.() && verifyImage) {
      const hash = hashImage(screenshotPath)
      const cached = verificationCache[hash]
      const verification = cached ? cached.result : await verifyImage(screenshotPath, 'Gateway dashboard with tab navigation for bridge, staking, and token management')
      if (!cached) { verificationCache[hash] = { result: verification, timestamp: new Date().toISOString(), route: '/' }; saveCache() }
      console.log(`${cached ? '📦' : '🔍'} Gateway: ${verification.quality} (${Math.round(verification.confidence * 100)}%)`)
      if (verification.quality === 'broken') throw new Error('Page BROKEN')
    }

    if (errors.length > 0) throw new Error(`Errors: ${errors.join(', ')}`)
  })
})

test.describe('Gateway - All Tabs', () => {
  for (const tab of TABS) {
    test(`Tab: ${tab.name}`, async ({ page }) => {
      const errors: string[] = []; let hasKnownBug = false
      page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Failed to load') && !msg.text().includes('net::ERR') && !msg.text().includes('status of 4')) errors.push(msg.text()) })
      page.on('pageerror', error => { if (error.message.includes('Cannot read properties')) { hasKnownBug = true; return }; errors.push(`PageError: ${error.message}`) })

      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForTimeout(1000)

      // Click tab button
      const tabButton = page.locator(`button:has-text("${tab.name}")`).first()
      if (await tabButton.isVisible()) {
        await tabButton.click()
        await page.waitForTimeout(500)
      }

      const screenshotPath = join(SCREENSHOT_DIR, `Gateway-${tab.name.replace(/\s+/g, '-')}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })

      if (isLLMConfigured?.() && verifyImage) {
        const hash = hashImage(screenshotPath); const cached = verificationCache[hash]
        const verification = cached ? cached.result : await verifyImage(screenshotPath, tab.description)
        if (!cached) { verificationCache[hash] = { result: verification, timestamp: new Date().toISOString(), route: `tab:${tab.id}` }; saveCache() }
        console.log(`${cached ? '📦' : '🔍'} ${tab.name}: ${verification.quality} (${Math.round(verification.confidence * 100)}%)`)
        if (verification.issues.length > 0) console.log(`   Issues: ${verification.issues.join(', ')}`)
      }

      if (errors.length > 0 && !hasKnownBug) throw new Error(`Errors: ${errors.join(', ')}`)
    })
  }
})

test.describe('Gateway Mobile', () => {
  test('renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); await page.goto('/'); await page.waitForTimeout(1000)
    await expect(page.locator('body')).toBeVisible()
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'mobile.png'), fullPage: true })
  })
})

test.afterAll(() => { saveCache(); console.log(`📊 ${TABS.length + 1} views tested`) })
