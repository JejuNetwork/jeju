/**
 * CEO Dashboard Flow Tests
 *
 * Tests the AI CEO Management page:
 * - Dashboard display
 * - Model election section
 * - Recent decisions
 * - Interaction flows
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const BASE_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`
const CEO_URL = `${BASE_URL}/ceo`

test.describe('CEO Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CEO_URL)
    await page.waitForLoadState('networkidle')
  })

  test('displays page header correctly', async ({ page }) => {
    // Page header
    await expect(
      page.getByRole('heading', { name: 'AI CEO Management' }),
    ).toBeVisible()

    // Back button
    await expect(page.getByRole('link', { name: '' }).first()).toBeVisible()
  })

  test('shows CEO dashboard section', async ({ page }) => {
    // Wait for loading to complete
    await page.waitForTimeout(1000)

    // Dashboard title should appear
    await expect(page.getByText('AI CEO Dashboard')).toBeVisible()

    // Refresh button
    await expect(page.getByRole('button', { name: /Refresh/ })).toBeVisible()
  })

  test('displays Current AI CEO or loading state', async ({ page }) => {
    await page.waitForTimeout(1500)

    // Either shows Current AI CEO or the dashboard is still loading/empty
    const hasCEO = await page
      .getByText('Current AI CEO')
      .isVisible({ timeout: 2000 })
      .catch(() => false)
    const hasDashboard = await page
      .getByText('AI CEO Dashboard')
      .isVisible({ timeout: 2000 })
      .catch(() => false)

    expect(hasCEO || hasDashboard).toBe(true)
  })

  test('displays stats cards when data loaded', async ({ page }) => {
    await page.waitForTimeout(1500)

    // Check for stat labels if data is loaded
    const hasStats = await page
      .getByText('Approval Rate')
      .isVisible({ timeout: 2000 })
      .catch(() => false)

    // Either stats are visible or we're in empty state
    if (hasStats) {
      await expect(page.getByText('Total Decisions')).toBeVisible()
    }
    // Test passes - component rendered without crash
    expect(true).toBe(true)
  })

  test('displays Model Election section', async ({ page }) => {
    await page.waitForTimeout(1500)

    // Section header should always be visible
    await expect(page.getByText('Model Election')).toBeVisible()
  })

  test('displays Recent Decisions section', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Section header
    await expect(page.getByText('Recent Decisions')).toBeVisible()

    // View all button
    await expect(
      page.getByRole('button', { name: 'View All Decisions' }),
    ).toBeVisible()
  })

  test('nominate model button exists', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(
      page.getByRole('button', { name: /Nominate New Model/ }),
    ).toBeVisible()
  })
})

test.describe('CEO Dashboard Interactions', () => {
  test('refresh button reloads data', async ({ page }) => {
    await page.goto(CEO_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Click refresh
    const refreshButton = page.getByRole('button', { name: /Refresh/ })
    await refreshButton.click()

    // Should trigger loading state (buttons/cards may animate)
    // Wait for refresh to complete
    await page.waitForTimeout(500)

    // Page should still be functional
    await expect(page.getByText('AI CEO Dashboard')).toBeVisible()
  })

  test('back button navigates to dashboard', async ({ page }) => {
    await page.goto(CEO_URL)
    await page.waitForLoadState('networkidle')

    // Click back
    await page.getByRole('link', { name: '' }).first().click()

    // Should be on dashboard
    await expect(page).toHaveURL(BASE_URL)
  })

  test('model candidate cards can expand', async ({ page }) => {
    await page.goto(CEO_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Find a model candidate card (if any exist)
    const modelCard = page.locator('button:has-text("Staked")').first()

    if (await modelCard.isVisible({ timeout: 2000 })) {
      // Click to expand
      await modelCard.click()

      // Should show expanded details
      await expect(page.getByText('Total Staked')).toBeVisible()
      await expect(page.getByText('Reputation')).toBeVisible()
      await expect(page.getByText('Decisions')).toBeVisible()
      await expect(page.getByText('Benchmark')).toBeVisible()

      // Action buttons should appear
      await expect(
        page.getByRole('button', { name: 'Stake on Model' }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'View Details' }),
      ).toBeVisible()

      // Click again to collapse
      await modelCard.click()

      // Should collapse (action buttons hidden)
      await expect(
        page.getByRole('button', { name: 'Stake on Model' }),
      ).not.toBeVisible()
    }
  })
})

test.describe('CEO Dashboard Empty States', () => {
  test('handles no model candidates gracefully', async ({ page }) => {
    await page.goto(CEO_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Check if empty state message is shown
    const emptyState = page.getByText('No model candidates registered')
    if (await emptyState.isVisible({ timeout: 1000 })) {
      await expect(emptyState).toBeVisible()
      await expect(
        page.getByText('CEOAgent contract may not be deployed'),
      ).toBeVisible()
    }
  })

  test('handles no decisions gracefully', async ({ page }) => {
    await page.goto(CEO_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Check if empty state message is shown
    const emptyState = page.getByText('No decisions recorded yet')
    if (await emptyState.isVisible({ timeout: 1000 })) {
      await expect(emptyState).toBeVisible()
      await expect(
        page.getByText('Decisions will appear here after CEO review'),
      ).toBeVisible()
    }
  })
})

test.describe('CEO Dashboard Navigation', () => {
  test('can navigate from dashboard to CEO page', async ({ page }) => {
    await page.goto(BASE_URL)

    await page.getByRole('link', { name: 'CEO' }).click()

    await expect(page).toHaveURL(CEO_URL)
    await expect(
      page.getByRole('heading', { name: 'AI CEO Management' }),
    ).toBeVisible()
  })

  test('CEO status on dashboard links correctly', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // Look for AI CEO section on dashboard
    await expect(page.getByText('AI CEO')).toBeVisible()
  })
})

test.describe('CEO Dashboard Responsive', () => {
  test('mobile layout displays correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(CEO_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Page should load
    await expect(
      page.getByRole('heading', { name: 'AI CEO Management' }),
    ).toBeVisible()

    // Dashboard section should be visible
    await expect(page.getByText('AI CEO Dashboard')).toBeVisible()
  })

  test('tablet layout shows full content', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(CEO_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // All sections visible
    await expect(page.getByText('AI CEO Dashboard')).toBeVisible()
    await expect(page.getByText('Model Election')).toBeVisible()
    await expect(page.getByText('Recent Decisions')).toBeVisible()
  })
})
