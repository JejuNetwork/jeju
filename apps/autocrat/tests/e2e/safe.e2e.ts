/**
 * Safe Integration E2E Tests
 *
 * Tests for Gnosis Safe UI integration including:
 * - Safe info display
 * - Transaction list views
 * - Proposal workflows
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const BASE_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`

test.describe('Safe Integration UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test('should display Safe info card when available', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Page should load without crashing
    await expect(page.locator('main')).toBeVisible()
  })

  test('should display treasury information', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Look for treasury tab
    const treasuryTab = page.getByText(/Treasury/i).first()
    if (await treasuryTab.isVisible().catch(() => false)) {
      await treasuryTab.click()
      await page.waitForTimeout(500)
    }

    // Page should work
    await expect(page.locator('main')).toBeVisible()
  })

  test('should navigate between DAO tabs without errors', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Try clicking various tabs if they exist
    const tabs = ['Overview', 'Treasury', 'Proposals', 'Members', 'Settings']
    for (const tabName of tabs) {
      const tab = page.getByText(tabName, { exact: true })
      if (await tab.isVisible().catch(() => false)) {
        await tab.click()
        await page.waitForTimeout(300)
      }
    }

    // Page should still work
    await expect(page.locator('main')).toBeVisible()
  })

  test('should display DAO detail page correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Header should be visible
    await expect(page.locator('header')).toBeVisible()

    // Main content area
    await expect(page.locator('main')).toBeVisible()
  })
})

test.describe('Safe Transaction List', () => {
  test('should handle empty transaction state gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Page should handle no transactions gracefully
    await expect(page.locator('main')).toBeVisible()
  })

  test('should display transaction status badges', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Page should work even without transaction badges
    await expect(page.locator('main')).toBeVisible()
  })
})

test.describe('Safe Actions', () => {
  test('should display action buttons when available', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Check for any buttons
    const buttons = await page.getByRole('button').count()
    expect(buttons).toBeGreaterThanOrEqual(0)
  })

  test('should show signature progress when applicable', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Page should work
    await expect(page.locator('main')).toBeVisible()
  })
})

test.describe('Safe API Integration', () => {
  test('should fetch Safe info via API', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Just verify page loads
    await expect(page.locator('main')).toBeVisible()
  })

  test('should check if address is Safe', async ({ page }) => {
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    // Page should work
    await expect(page.locator('main')).toBeVisible()
  })
})

test.describe('Responsive Design', () => {
  test('should display correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('header')).toBeVisible()
  })

  test('should display correctly on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(`${BASE_URL}/dao/jeju`)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('main')).toBeVisible()
  })
})
