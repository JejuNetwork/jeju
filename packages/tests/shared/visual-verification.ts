/**
 * Visual Verification for E2E Tests
 *
 * Integrates AI-powered screenshot verification into the E2E test flow.
 * Each test can specify what the page should look like, and AI will verify it.
 *
 * Usage:
 *   import { verifyPage, verifyPageElement } from '@jejunetwork/tests/visual-verification'
 *
 *   test('dashboard loads correctly', async ({ page }) => {
 *     await page.goto('/dashboard')
 *     await verifyPage(page, {
 *       description: 'Dashboard with navigation, user stats, and recent activity',
 *       quality: 'good',
 *     })
 *   })
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  type ImageVerification,
  isLLMConfigured,
  verifyImage,
} from './ai/llm'

export interface PageVerificationOptions {
  /** Description of what the page should look like */
  description: string
  /** Minimum acceptable quality level (default: 'acceptable') */
  quality?: 'excellent' | 'good' | 'acceptable' | 'poor'
  /** Whether to fail the test on verification failure (default: true) */
  failOnMismatch?: boolean
  /** Custom screenshot name */
  screenshotName?: string
  /** Directory to save screenshots */
  screenshotDir?: string
  /** Take full page screenshot (default: true) */
  fullPage?: boolean
}

export interface VerificationResult extends ImageVerification {
  screenshotPath: string
  passed: boolean
}

// Quality level ordering for comparison
const QUALITY_ORDER = ['broken', 'poor', 'acceptable', 'good', 'excellent'] as const

function qualityMeetsMinimum(
  actual: typeof QUALITY_ORDER[number],
  minimum: typeof QUALITY_ORDER[number],
): boolean {
  return QUALITY_ORDER.indexOf(actual) >= QUALITY_ORDER.indexOf(minimum)
}

/**
 * Find the test results directory
 */
function getTestResultsDir(): string {
  // Look for monorepo root
  let dir = process.cwd()
  while (dir !== '/') {
    if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
      return join(dir, 'test-results')
    }
    dir = join(dir, '..')
  }
  return join(process.cwd(), 'test-results')
}

/**
 * Generate screenshot filename from test context
 */
function generateScreenshotName(page: Page, customName?: string): string {
  if (customName) return customName

  // Extract meaningful name from URL
  const url = new URL(page.url())
  const path = url.pathname.replace(/^\//, '').replace(/\//g, '-') || 'home'
  const timestamp = Date.now()

  return `${path}-${timestamp}`
}

/**
 * Verify a page matches its expected description
 *
 * Takes a screenshot and uses AI to verify it matches the expected description.
 * Returns verification result with quality assessment.
 */
export async function verifyPage(
  page: Page,
  options: PageVerificationOptions,
): Promise<VerificationResult> {
  const {
    description,
    quality: minimumQuality = 'acceptable',
    failOnMismatch = true,
    screenshotName,
    screenshotDir,
    fullPage = true,
  } = options

  // Determine screenshot path
  const resultsDir = screenshotDir ?? join(getTestResultsDir(), 'visual-verification')
  mkdirSync(resultsDir, { recursive: true })

  const name = generateScreenshotName(page, screenshotName)
  const screenshotPath = join(resultsDir, `${name}.png`)

  // Take screenshot
  await page.screenshot({ path: screenshotPath, fullPage })

  // Check if AI verification is available
  if (!isLLMConfigured()) {
    console.warn('⚠️ AI verification skipped - no LLM API key configured')
    console.warn('Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable visual verification')

    return {
      matches: true,
      description: 'AI verification skipped - no API key',
      issues: ['LLM not configured'],
      quality: 'acceptable',
      confidence: 0,
      screenshotPath,
      passed: true,
    }
  }

  // Run AI verification
  const verification = await verifyImage(screenshotPath, description)

  // Check if quality meets minimum
  const meetsQuality = qualityMeetsMinimum(verification.quality, minimumQuality)
  const passed = verification.matches && meetsQuality

  const result: VerificationResult = {
    ...verification,
    screenshotPath,
    passed,
  }

  // Save verification result as JSON
  const resultPath = screenshotPath.replace('.png', '.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2))

  // Log result
  if (passed) {
    console.log(`✅ Visual verification passed: ${screenshotPath}`)
    console.log(`   Quality: ${verification.quality} (${Math.round(verification.confidence * 100)}% confidence)`)
  } else {
    console.log(`❌ Visual verification failed: ${screenshotPath}`)
    console.log(`   Quality: ${verification.quality} (minimum: ${minimumQuality})`)
    console.log(`   Issues: ${verification.issues.join(', ') || 'none'}`)
    console.log(`   Description: ${verification.description}`)
  }

  // Fail test if configured
  if (!passed && failOnMismatch) {
    throw new Error(
      `Visual verification failed for ${screenshotPath}:\n` +
        `Expected: ${description}\n` +
        `Quality: ${verification.quality} (minimum: ${minimumQuality})\n` +
        `Issues: ${verification.issues.join(', ') || 'none'}\n` +
        `AI Description: ${verification.description}`,
    )
  }

  return result
}

/**
 * Verify a specific element on the page
 */
export async function verifyElement(
  page: Page,
  selector: string,
  options: Omit<PageVerificationOptions, 'fullPage'>,
): Promise<VerificationResult> {
  const element = page.locator(selector)
  const isVisible = await element.isVisible()

  if (!isVisible) {
    throw new Error(`Element not visible: ${selector}`)
  }

  // Take element screenshot
  const resultsDir = options.screenshotDir ?? join(getTestResultsDir(), 'visual-verification')
  mkdirSync(resultsDir, { recursive: true })

  const name = options.screenshotName ?? `element-${Date.now()}`
  const screenshotPath = join(resultsDir, `${name}.png`)

  await element.screenshot({ path: screenshotPath })

  // Check if AI verification is available
  if (!isLLMConfigured()) {
    console.warn('⚠️ AI verification skipped - no LLM API key configured')
    return {
      matches: true,
      description: 'AI verification skipped - no API key',
      issues: ['LLM not configured'],
      quality: 'acceptable',
      confidence: 0,
      screenshotPath,
      passed: true,
    }
  }

  // Run AI verification
  const verification = await verifyImage(screenshotPath, options.description)

  const minimumQuality = options.quality ?? 'acceptable'
  const meetsQuality = qualityMeetsMinimum(verification.quality, minimumQuality)
  const passed = verification.matches && meetsQuality

  const result: VerificationResult = {
    ...verification,
    screenshotPath,
    passed,
  }

  // Save verification result
  const resultPath = screenshotPath.replace('.png', '.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2))

  if (!passed && (options.failOnMismatch ?? true)) {
    throw new Error(
      `Element verification failed for ${selector}:\n` +
        `Expected: ${options.description}\n` +
        `Quality: ${verification.quality}\n` +
        `Issues: ${verification.issues.join(', ')}`,
    )
  }

  return result
}

/**
 * Verify multiple pages in sequence
 */
export async function verifyPages(
  page: Page,
  pages: Array<{
    url: string
    description: string
    quality?: 'excellent' | 'good' | 'acceptable'
  }>,
): Promise<Map<string, VerificationResult>> {
  const results = new Map<string, VerificationResult>()

  for (const pageConfig of pages) {
    await page.goto(pageConfig.url, { waitUntil: 'networkidle' })

    const result = await verifyPage(page, {
      description: pageConfig.description,
      quality: pageConfig.quality,
      failOnMismatch: false, // Collect all results first
    })

    results.set(pageConfig.url, result)
  }

  // Check for any failures
  const failures = [...results.entries()].filter(([_, r]) => !r.passed)
  if (failures.length > 0) {
    throw new Error(
      `Visual verification failed for ${failures.length} page(s):\n` +
        failures.map(([url, r]) =>
          `  - ${url}: ${r.quality} quality, issues: ${r.issues.join(', ')}`
        ).join('\n'),
    )
  }

  return results
}

/**
 * Create a visual test for an app based on its manifest
 */
export function createAppVisualTest(manifest: {
  name: string
  ports?: { main?: number; frontend?: number }
  testing?: {
    smokeTest?: {
      criticalPages?: string[]
    }
  }
}) {
  const port = manifest.ports?.main ?? manifest.ports?.frontend ?? 3000
  const baseUrl = `http://localhost:${port}`
  const pages = manifest.testing?.smokeTest?.criticalPages ?? ['/']

  return {
    baseUrl,
    pages: pages.map((path) => ({
      url: `${baseUrl}${path}`,
      description: `${manifest.name} ${path === '/' ? 'home' : path} page`,
    })),
  }
}

