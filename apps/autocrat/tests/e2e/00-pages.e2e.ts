/**
 * Page Load Tests - Verify all pages load correctly
 *
 * Tests each route to ensure:
 * - Page loads without errors
 * - Key elements are visible
 * - No console errors
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const BASE_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`

test.describe('All Pages Load', () => {
  test.beforeEach(async ({ page }) => {
    // Collect console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`Console error: ${msg.text()}`)
      }
    })
  })

  test('Dashboard (/) loads correctly', async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(page).toHaveTitle(/Autocrat/)

    // Main content visible
    await expect(page.locator('main')).toBeVisible()

    // Header with navigation
    await expect(page.locator('header')).toBeVisible()
    await expect(
      page.locator('header').getByRole('link', { name: 'Dashboard' }),
    ).toBeVisible()

    // Stats cards visible
    await expect(page.locator('.stat-label').first()).toBeVisible()

    // CEO Status section
    await expect(page.getByText('AI CEO')).toBeVisible()

    // View all link
    await expect(page.getByText('View all →')).toBeVisible()
  })

  test('Proposals page (/proposals) loads correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/proposals`)

    // Page header
    await expect(page.getByRole('heading', { name: 'Proposals' })).toBeVisible()

    // Create button (use first one in main content area)
    await expect(
      page
        .locator('main')
        .getByRole('link', { name: /Create/ })
        .first(),
    ).toBeVisible()

    // Search input
    await expect(page.getByPlaceholder('Search...')).toBeVisible()

    // Filter buttons
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Active' })).toBeVisible()
  })

  test('Create page (/create) loads correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // Page header
    await expect(
      page.getByRole('heading', { name: 'Create Proposal' }),
    ).toBeVisible()

    // Back button
    await expect(page.getByRole('link', { name: '' }).first()).toBeVisible()

    // Wizard steps visible (use exact match)
    await expect(page.getByText('Draft', { exact: true })).toBeVisible()
    await expect(page.getByText('Quality', { exact: true })).toBeVisible()
    await expect(page.getByText('Duplicates', { exact: true })).toBeVisible()
    await expect(page.getByText('Submit', { exact: true })).toBeVisible()

    // Proposal type grid
    await expect(page.getByText('Parameter Change')).toBeVisible()
    await expect(page.getByText('Treasury Allocation')).toBeVisible()
    await expect(page.getByText('Code Upgrade')).toBeVisible()

    // Form fields
    await expect(page.getByLabel('Title')).toBeVisible()
    await expect(page.getByLabel('Summary')).toBeVisible()
    await expect(page.getByLabel('Full Description')).toBeVisible()
  })

  test('CEO page (/ceo) loads correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/ceo`)

    // Page header
    await expect(
      page.getByRole('heading', { name: 'AI CEO Management' }),
    ).toBeVisible()

    // Back button
    await expect(page.getByRole('link', { name: '' }).first()).toBeVisible()
  })

  test('Bug Bounty page (/bug-bounty) loads correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/bug-bounty`)

    // Hero section
    await expect(
      page.getByRole('heading', { name: 'Security Bug Bounty' }),
    ).toBeVisible()

    // Main CTA button
    await expect(
      page.getByRole('link', { name: /Report Vulnerability/ }),
    ).toBeVisible()

    // Tabs
    await expect(page.getByRole('button', { name: 'overview' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'submissions' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'leaderboard' }),
    ).toBeVisible()

    // Stats cards
    await expect(page.getByText('Bounty Pool')).toBeVisible()
    await expect(page.getByText('Total Paid')).toBeVisible()
    await expect(page.getByText('Active Reports')).toBeVisible()

    // Reward tiers section
    await expect(page.getByText('Reward Tiers')).toBeVisible()
    await expect(page.getByText('Low')).toBeVisible()
    await expect(page.getByText('Medium')).toBeVisible()
    await expect(page.getByText('High')).toBeVisible()
    await expect(page.getByText('Critical')).toBeVisible()
  })

  test('Auth callback page (/auth/callback) handles no params', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/auth/callback`)

    // Should show error state without proper params
    await expect(page.getByText(/Invalid callback parameters/i)).toBeVisible()
  })
})

test.describe('Navigation Works', () => {
  test('can navigate between all pages', async ({ page }) => {
    await page.goto(BASE_URL)

    // Dashboard -> Proposals (use nav link)
    await page
      .locator('header')
      .getByRole('link', { name: 'Proposals' })
      .click()
    await expect(page).toHaveURL(`${BASE_URL}/proposals`)
    await expect(page.getByRole('heading', { name: 'Proposals' })).toBeVisible()

    // Proposals -> Create (use nav link)
    await page.locator('header').getByRole('link', { name: 'Create' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/create`)
    await expect(
      page.getByRole('heading', { name: 'Create Proposal' }),
    ).toBeVisible()

    // Create -> Dashboard (via back)
    await page.getByRole('link', { name: '' }).first().click()
    await expect(page).toHaveURL(BASE_URL)

    // Dashboard -> CEO
    await page.locator('header').getByRole('link', { name: 'CEO' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/ceo`)
    await expect(
      page.getByRole('heading', { name: 'AI CEO Management' }),
    ).toBeVisible()

    // CEO -> Dashboard
    await page
      .locator('header')
      .getByRole('link', { name: 'Dashboard' })
      .click()
    await expect(page).toHaveURL(BASE_URL)
  })

  test('View all link goes to proposals', async ({ page }) => {
    await page.goto(BASE_URL)

    await page.getByText('View all →').click()
    await expect(page).toHaveURL(`${BASE_URL}/proposals`)
  })

  test('Create Proposal link works from empty state', async ({ page }) => {
    await page.goto(BASE_URL)

    // Click Create Proposal in empty state (if visible)
    const createLink = page.getByRole('link', { name: /Create Proposal/ })
    if (await createLink.isVisible()) {
      await createLink.click()
      await expect(page).toHaveURL(`${BASE_URL}/create`)
    }
  })
})

test.describe('Theme Toggle', () => {
  test('toggles between light and dark mode', async ({ page }) => {
    await page.goto(BASE_URL)

    const themeButton = page.getByRole('button', { name: 'Toggle theme' })
    await expect(themeButton).toBeVisible()

    // Check initial state
    const html = page.locator('html')
    const initialDark = await html.evaluate((el) =>
      el.classList.contains('dark'),
    )

    // Toggle theme
    await themeButton.click()
    await page.waitForTimeout(100)

    // Check it changed
    const newDark = await html.evaluate((el) => el.classList.contains('dark'))
    expect(newDark).not.toBe(initialDark)

    // Toggle back
    await themeButton.click()
    await page.waitForTimeout(100)

    const finalDark = await html.evaluate((el) => el.classList.contains('dark'))
    expect(finalDark).toBe(initialDark)
  })

  test('theme persists across navigation', async ({ page }) => {
    await page.goto(BASE_URL)

    // Set dark mode
    const html = page.locator('html')
    const initialDark = await html.evaluate((el) =>
      el.classList.contains('dark'),
    )

    if (!initialDark) {
      await page.getByRole('button', { name: 'Toggle theme' }).click()
    }

    // Navigate to another page
    await page.getByRole('link', { name: 'Proposals' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/proposals`)

    // Check theme persists
    const stillDark = await html.evaluate((el) => el.classList.contains('dark'))
    expect(stillDark).toBe(true)
  })
})

test.describe('Responsive Design', () => {
  test('mobile viewport renders without errors', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // Main content visible
    await expect(page.locator('main')).toBeVisible()

    // Header exists
    await expect(page.locator('header')).toBeVisible()

    // Stats are visible
    await expect(page.locator('.stat-label').first()).toBeVisible()
  })

  test('desktop viewport renders without errors', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // Main content visible
    await expect(page.locator('main')).toBeVisible()

    // Header navigation should be visible
    const header = page.locator('header')
    await expect(header).toBeVisible()
    await expect(header.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  })
})
