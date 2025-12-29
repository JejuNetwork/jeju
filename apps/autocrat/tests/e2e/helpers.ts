/**
 * Shared E2E Test Helpers
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

export interface AIVerificationResult {
  matches: boolean
  description: string
  issues: string[]
  quality: string
  confidence: number
}

interface CacheEntry {
  result: AIVerificationResult
  timestamp: string
  route: string
}

const IGNORED_ERRORS = [
  'favicon',
  'Failed to load',
  'net::ERR',
  'status of 4',
  'ResizeObserver',
]

export function setupErrorCapture(page: Page): {
  errors: string[]
  hasKnownBug: boolean
} {
  const errors: string[] = []
  let hasKnownBug = false

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORED_ERRORS.some((e) => text.includes(e))) return
    errors.push(text)
  })

  page.on('pageerror', (error) => {
    if (error.message.includes('Cannot read properties')) {
      hasKnownBug = true
      return
    }
    errors.push(`PageError: ${error.message}`)
  })

  return {
    errors,
    get hasKnownBug() {
      return hasKnownBug
    },
  }
}

let verificationCache: Record<string, CacheEntry> = {}
let aiVerifier: {
  verifyImage: (path: string, desc: string) => Promise<AIVerificationResult>
  isLLMConfigured: () => boolean
} | null = null

export function initAIVerifier(cacheFile: string): void {
  try {
    if (existsSync(cacheFile)) {
      verificationCache = JSON.parse(readFileSync(cacheFile, 'utf-8'))
    }
  } catch {
    verificationCache = {}
  }

  import('@jejunetwork/tests/ai')
    .then((ai) => {
      aiVerifier = {
        verifyImage: ai.verifyImage,
        isLLMConfigured: ai.isLLMConfigured,
      }
    })
    .catch(() => {})
}

export function saveVerificationCache(cacheFile: string): void {
  try {
    writeFileSync(cacheFile, JSON.stringify(verificationCache, null, 2))
  } catch {}
}

export async function verifyScreenshot(
  path: string,
  desc: string,
  route: string,
): Promise<void> {
  if (!aiVerifier?.isLLMConfigured()) return

  const hash = createHash('sha256')
    .update(readFileSync(path))
    .digest('hex')
    .slice(0, 16)
  const cached = verificationCache[hash]
  const result = cached?.result ?? (await aiVerifier.verifyImage(path, desc))

  if (!cached) {
    verificationCache[hash] = {
      result,
      timestamp: new Date().toISOString(),
      route,
    }
  }

  if (result.quality === 'broken') throw new Error('Page BROKEN')
}

export async function navigateToDAO(page: Page): Promise<boolean> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)

  const daoCards = page.locator('a[href*="/dao/"]')
  if ((await daoCards.count()) === 0) return false

  await daoCards.first().click()
  await page.waitForURL('**/dao/**')
  await page.waitForTimeout(1000)
  return true
}

export async function navigateToGovernance(page: Page): Promise<boolean> {
  if (!(await navigateToDAO(page))) return false
  await page.click('button:has-text("Governance")')
  await page.waitForTimeout(500)
  return true
}

export async function navigateToProposal(page: Page): Promise<boolean> {
  if (!(await navigateToGovernance(page))) return false

  const proposalCards = page.locator('a[href*="/proposal/"]')
  if ((await proposalCards.count()) === 0) return false

  await proposalCards.first().click()
  await page.waitForURL('**/proposal/**')
  await page.waitForTimeout(1000)
  return true
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export function screenshotPath(dir: string, name: string): string {
  return join(dir, `${name}.png`)
}
