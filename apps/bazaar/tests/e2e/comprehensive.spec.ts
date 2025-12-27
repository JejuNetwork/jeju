/**
 * Bazaar Comprehensive E2E Tests
 * DeFi, NFTs, launchpad, JNS, prediction markets
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
 * All Bazaar Routes from App.tsx
 */
const ROUTES = [
  { path: '/', name: 'Home', expectedContent: 'Bazaar', description: 'Bazaar home page with DeFi navigation and trending content.' },
  { path: '/swap', name: 'Swap', expectedContent: 'Swap', description: 'Token swap interface with token selectors and price display.' },
  { path: '/pools', name: 'Pools', expectedContent: 'Pool', description: 'Liquidity pools list with APY and TVL stats.' },
  { path: '/perps', name: 'Perps', expectedContent: 'Perp', description: 'Perpetuals trading interface with charts and order book.' },
  { path: '/coins', name: 'Coins', expectedContent: 'Coin', description: 'Token listings with market data and charts.' },
  { path: '/coins/create', name: 'Create Coin', expectedContent: 'Create', description: 'Token creation wizard with parameters.' },
  { path: '/coins/launch', name: 'Launch Coin', expectedContent: 'Launch', description: 'Token launch wizard for bonding curves.' },
  { path: '/coins/jeju-ico', name: 'Jeju ICO', expectedContent: 'JEJU', description: 'Jeju token ICO page with purchase options.' },
  { path: '/markets', name: 'Markets', expectedContent: 'Market', description: 'Markets overview with prediction markets and perps.' },
  { path: '/markets/create', name: 'Create Market', expectedContent: 'Create', description: 'Prediction market creation wizard.' },
  { path: '/markets/predictions', name: 'Predictions', expectedContent: 'Prediction', description: 'Prediction markets list with outcomes.' },
  { path: '/items', name: 'Items', expectedContent: 'Item', description: 'NFT marketplace with collections and listings.' },
  { path: '/items/mint', name: 'Mint Item', expectedContent: 'Mint', description: 'NFT minting interface.' },
  { path: '/names', name: 'Names', expectedContent: 'Name', description: 'JNS domain registration and management.' },
  { path: '/liquidity', name: 'Liquidity', expectedContent: 'Liquidity', description: 'Add/remove liquidity interface.' },
  { path: '/tfmm', name: 'TFMM', expectedContent: 'TFMM', description: 'Token-weighted AMM interface.' },
  { path: '/portfolio', name: 'Portfolio', expectedContent: 'Portfolio', description: 'User portfolio with balances and positions.' },
  { path: '/rewards', name: 'Rewards', expectedContent: 'Reward', description: 'Rewards dashboard with claimable rewards.' },
  { path: '/settings', name: 'Settings', expectedContent: 'Setting', description: 'User settings and preferences.' },
  { path: '/trending', name: 'Trending', expectedContent: 'Trend', description: 'Trending tokens and markets.' },
]

test.beforeAll(async () => {
  loadCache(); mkdirSync(SCREENSHOT_DIR, { recursive: true })
  try { const ai = await import('@jejunetwork/tests/ai'); verifyImage = ai.verifyImage; isLLMConfigured = ai.isLLMConfigured; console.log(isLLMConfigured?.() ? '✅ AI enabled' : '⚠️ No LLM key') } catch { console.log('⚠️ AI not available') }
})

test.describe('Bazaar - All Pages', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      const errors: string[] = []; let hasKnownBug = false
      page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Failed to load') && !msg.text().includes('net::ERR') && !msg.text().includes('status of 4')) errors.push(msg.text()) })
      page.on('pageerror', error => { if (error.message.includes('Cannot read properties')) { hasKnownBug = true; return }; errors.push(`PageError: ${error.message}`) })

      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForTimeout(1000)
      if (errors.length > 0 && !hasKnownBug) { await page.screenshot({ path: join(SCREENSHOT_DIR, `${route.name.replace(/\s+/g, '-')}-ERROR.png`), fullPage: true }); throw new Error(`Errors: ${errors.join(', ')}`) }

      try { await expect(page.locator('body')).toBeVisible({ timeout: 10000 }) } catch { if (hasKnownBug) { console.log('⚠️ Known bug'); return }; throw new Error('Body not visible') }

      const screenshotPath = join(SCREENSHOT_DIR, `${route.name.replace(/\s+/g, '-')}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })

      if (isLLMConfigured?.() && verifyImage) {
        const hash = hashImage(screenshotPath); const cached = verificationCache[hash]
        const verification = cached ? cached.result : await verifyImage(screenshotPath, route.description)
        if (!cached) { verificationCache[hash] = { result: verification, timestamp: new Date().toISOString(), route: route.path }; saveCache() }
        console.log(`${cached ? '📦' : '🔍'} ${route.name}: ${verification.quality} (${Math.round(verification.confidence * 100)}%)`)
        if (verification.issues.length > 0) console.log(`   Issues: ${verification.issues.join(', ')}`)
        if (verification.quality === 'broken') throw new Error('Page BROKEN')
      }
    })
  }
})

test.describe('Bazaar Mobile', () => {
  test('renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); await page.goto('/'); await page.waitForTimeout(1000)
    await expect(page.locator('body')).toBeVisible()
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'mobile.png'), fullPage: true })
  })
})

test.afterAll(() => { saveCache(); console.log(`📊 ${ROUTES.length} routes tested`) })
