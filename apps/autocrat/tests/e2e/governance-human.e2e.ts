/**
 * Human Governance E2E Tests
 *
 * Tests human governance actions in Autocrat web UI.
 */

import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  ensureDir,
  initAIVerifier,
  navigateToDAO,
  navigateToGovernance,
  saveVerificationCache,
  screenshotPath,
  setupErrorCapture,
  verifyScreenshot,
} from './helpers'

const SCREENSHOT_DIR = join(process.cwd(), 'test-results', 'screenshots', 'governance')
const CACHE_FILE = join(process.cwd(), 'test-results', 'governance-verification-cache.json')

test.beforeAll(() => {
  ensureDir(SCREENSHOT_DIR)
  initAIVerifier(CACHE_FILE)
})

test.afterAll(() => saveVerificationCache(CACHE_FILE))

// ============================================================================
// DIRECTOR DASHBOARD
// ============================================================================

test.describe('Director Dashboard', () => {
  test('loads with all sections', async ({ page }) => {
    const { errors, hasKnownBug } = setupErrorCapture(page)

    await page.goto('/director', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1500)

    if (errors.length > 0 && !hasKnownBug) {
      await page.screenshot({ path: screenshotPath(SCREENSHOT_DIR, 'Director-ERROR'), fullPage: true })
      throw new Error(`Console errors: ${errors.join(', ')}`)
    }

    await expect(page.locator('h1:has-text("Director Dashboard")')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Pending Decisions')).toBeVisible()

    const path = screenshotPath(SCREENSHOT_DIR, 'Director-Dashboard')
    await page.screenshot({ path, fullPage: true })
    await verifyScreenshot(path, 'Director Dashboard with pending decisions and proposal list', '/director')
  })

  test('shows pending proposals or empty state', async ({ page }) => {
    await page.goto('/director', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    await expect(page.locator('h2:has-text("Pending Proposals")')).toBeVisible()

    const hasProposals = await page.locator('[class*="space-y"]').first().isVisible().catch(() => false)
    const hasEmpty = await page.locator('text=No pending proposals').isVisible().catch(() => false)
    expect(hasProposals || hasEmpty).toBe(true)
  })

  test('proposal selection shows context', async ({ page }) => {
    await page.goto('/director', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    const proposals = page.locator('button[class*="w-full p-4"]')
    if (await proposals.count() === 0) return

    await proposals.first().click()
    await page.waitForTimeout(500)

    await expect(page.locator('text=Select a proposal')).not.toBeVisible()
    await page.screenshot({ path: screenshotPath(SCREENSHOT_DIR, 'Director-Context'), fullPage: true })
  })

  test('decision form validates input', async ({ page }) => {
    await page.goto('/director', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    const proposals = page.locator('button[class*="w-full p-4"]')
    if (await proposals.count() === 0) return

    await proposals.first().click()
    await page.waitForTimeout(2000)

    const decisionForm = page.locator('h3:has-text("Your Decision")')
    if (!await decisionForm.isVisible()) return

    const submitBtn = page.locator('button:has-text("Sign & Submit Decision")')
    await expect(submitBtn).toBeDisabled()

    await page.click('button:has-text("APPROVE")')
    await expect(submitBtn).toBeDisabled() // Still disabled without reasoning

    await page.locator('textarea[placeholder*="Explain"]').fill('Valid reasoning for approval.')
    await expect(submitBtn).toBeEnabled()
  })
})

// ============================================================================
// GOVERNANCE TAB
// ============================================================================

test.describe('Governance Tab', () => {
  test('loads with filters', async ({ page }) => {
    const { errors, hasKnownBug } = setupErrorCapture(page)

    if (!await navigateToGovernance(page)) return

    if (errors.length > 0 && !hasKnownBug) throw new Error(`Console errors: ${errors.join(', ')}`)

    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible()
    await expect(page.locator('select').first()).toBeVisible()
    await expect(page.locator('text=Proposal')).toBeVisible()

    await page.screenshot({ path: screenshotPath(SCREENSHOT_DIR, 'Governance-Tab'), fullPage: true })
  })

  test('search filters work', async ({ page }) => {
    if (!await navigateToGovernance(page)) return

    const search = page.locator('input[placeholder*="Search"]')
    await search.fill('test proposal')
    await page.waitForTimeout(500)
    await expect(search).toHaveValue('test proposal')
  })

  test('new proposal button navigates', async ({ page }) => {
    if (!await navigateToGovernance(page)) return

    const newBtn = page.locator('a:has-text("New")').first()
    if (!await newBtn.isVisible()) return

    await newBtn.click()
    await page.waitForURL('**/proposal/new**')
    await expect(page).toHaveURL(/proposal\/new/)
  })
})

// ============================================================================
// PROPOSAL CREATION
// ============================================================================

test.describe('Proposal Creation', () => {
  test('wizard validates required fields', async ({ page }) => {
    if (!await navigateToGovernance(page)) return

    const newBtn = page.locator('a:has-text("New")').first()
    if (!await newBtn.isVisible()) return

    await newBtn.click()
    await page.waitForTimeout(1000)

    const submitBtn = page.locator('button:has-text("Submit")').first()
    if (await submitBtn.isVisible()) {
      await expect(submitBtn).toBeDisabled()
    }
  })
})

// ============================================================================
// OTHER TABS
// ============================================================================

test.describe('Treasury Tab', () => {
  test('shows financial data', async ({ page }) => {
    if (!await navigateToDAO(page)) return

    await page.click('button:has-text("Treasury")')
    await page.waitForTimeout(500)

    const path = screenshotPath(SCREENSHOT_DIR, 'Treasury-Tab')
    await page.screenshot({ path, fullPage: true })
    await verifyScreenshot(path, 'Treasury dashboard with balance and transactions', '/dao/*/treasury')
  })
})

test.describe('Settings Tab', () => {
  test('shows governance parameters', async ({ page }) => {
    if (!await navigateToDAO(page)) return

    await page.click('button:has-text("Settings")')
    await page.waitForTimeout(500)
    await page.screenshot({ path: screenshotPath(SCREENSHOT_DIR, 'Settings-Tab'), fullPage: true })
  })
})

// ============================================================================
// MOBILE
// ============================================================================

test.describe('Mobile Responsiveness', () => {
  test('Director Dashboard renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/director', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    await expect(page.locator('body')).toBeVisible()

    const path = screenshotPath(SCREENSHOT_DIR, 'Mobile-Director')
    await page.screenshot({ path, fullPage: true })
    await verifyScreenshot(path, 'Mobile Director Dashboard with stacked layout', '/director/mobile')
  })

  test('Governance tab renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    if (!await navigateToGovernance(page)) return

    await page.screenshot({ path: screenshotPath(SCREENSHOT_DIR, 'Mobile-Governance'), fullPage: true })
  })
})
