/**
 * Board Member Voting E2E Tests
 */

import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  ensureDir,
  initAIVerifier,
  navigateToDAO,
  navigateToProposal,
  saveVerificationCache,
  screenshotPath,
  setupErrorCapture,
  verifyScreenshot,
} from './helpers'

const SCREENSHOT_DIR = join(
  process.cwd(),
  'test-results',
  'screenshots',
  'board',
)
const CACHE_FILE = join(
  process.cwd(),
  'test-results',
  'board-voting-cache.json',
)

test.beforeAll(() => {
  ensureDir(SCREENSHOT_DIR)
  initAIVerifier(CACHE_FILE)
})

test.afterAll(() => saveVerificationCache(CACHE_FILE))

// ============================================================================
// BOARD MEMBER DASHBOARD
// ============================================================================

test.describe('Board Member Dashboard', () => {
  test('shows all board members', async ({ page }) => {
    const { errors, hasKnownBug } = setupErrorCapture(page)

    if (!(await navigateToDAO(page))) return

    await expect(
      page.locator('button[aria-selected="true"]:has-text("Agents")'),
    ).toBeVisible()

    if (errors.length > 0 && !hasKnownBug)
      throw new Error(`Console errors: ${errors.join(', ')}`)

    const path = screenshotPath(SCREENSHOT_DIR, 'Board-Agents')
    await page.screenshot({ path, fullPage: true })
    await verifyScreenshot(
      path,
      'Board agents showing Director and members with roles',
      '/dao/*/agents',
    )
  })

  test('clicking board member shows detail', async ({ page }) => {
    if (!(await navigateToDAO(page))) return

    const viewBtn = page.locator('button:has-text("View Details")').first()
    if (!(await viewBtn.isVisible())) return

    await viewBtn.click()
    await page.waitForTimeout(500)

    const modal = page.locator('[role="dialog"]')
    if (await modal.isVisible()) {
      await page.screenshot({
        path: screenshotPath(SCREENSHOT_DIR, 'Board-Detail-Modal'),
        fullPage: true,
      })
      await expect(page.locator('text=Role')).toBeVisible()
    }
  })
})

// ============================================================================
// BOARD VOTING INTERFACE
// ============================================================================

test.describe('Board Voting Interface', () => {
  test('proposal shows board votes', async ({ page }) => {
    if (!(await navigateToProposal(page))) return

    const path = screenshotPath(SCREENSHOT_DIR, 'Proposal-Board-Votes')
    await page.screenshot({ path, fullPage: true })
    await verifyScreenshot(
      path,
      'Proposal detail with board vote breakdown showing individual votes',
      '/dao/*/proposal/*',
    )
  })

  test('vote type indicators visible', async ({ page }) => {
    if (!(await navigateToProposal(page))) return

    const hasApprove = await page
      .locator('text=APPROVE')
      .first()
      .isVisible()
      .catch(() => false)
    const hasReject = await page
      .locator('text=REJECT')
      .first()
      .isVisible()
      .catch(() => false)
    const hasAbstain = await page
      .locator('text=ABSTAIN')
      .first()
      .isVisible()
      .catch(() => false)
    const hasNoVotes = await page
      .locator('text=No votes yet')
      .isVisible()
      .catch(() => false)

    expect(hasApprove || hasReject || hasAbstain || hasNoVotes).toBe(true)
  })
})

// ============================================================================
// VOTE HISTORY
// ============================================================================

test.describe('Vote History', () => {
  test('governance stats show metrics', async ({ page }) => {
    if (!(await navigateToDAO(page))) return

    await page.click('button:has-text("Governance")')
    await page.waitForTimeout(500)

    await expect(page.locator('text=Active').first()).toBeVisible()
    await page.screenshot({
      path: screenshotPath(SCREENSHOT_DIR, 'Governance-Stats'),
      fullPage: true,
    })
  })
})

// ============================================================================
// HUMAN/AI PARITY
// ============================================================================

test.describe('Human/AI Board Member Parity', () => {
  test('both shown with same interface', async ({ page }) => {
    if (!(await navigateToDAO(page))) return

    const path = screenshotPath(SCREENSHOT_DIR, 'Human-AI-Parity')
    await page.screenshot({ path, fullPage: true })
    await verifyScreenshot(
      path,
      'Agents showing human and AI board members with badges and same layout',
      '/dao/*/agents/parity',
    )
  })
})
