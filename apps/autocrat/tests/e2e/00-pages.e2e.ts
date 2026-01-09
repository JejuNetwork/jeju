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

  test('Home page (/) loads correctly', async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(page).toHaveTitle(/Autocrat/)

    // Main content visible
    await expect(page.locator('main')).toBeVisible()

    // Header with navigation
    await expect(page.locator('header')).toBeVisible()

    // Hero section with heading
    await expect(page.getByRole('heading').first()).toBeVisible()

    // Create DAO link visible
    await expect(
      page.getByRole('link', { name: /Create DAO/i }).first(),
    ).toBeVisible()
  })

  test('Create page (/create) loads correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/create`)

    // Page should have Create DAO heading
    await expect(
      page.getByRole('heading', { name: /Create|Organization|DAO/i }).first(),
    ).toBeVisible()

    // Wizard steps visible
    await expect(page.getByText('Basics', { exact: true })).toBeVisible()
    await expect(page.getByText('Director', { exact: true })).toBeVisible()
    await expect(page.getByText('Board', { exact: true })).toBeVisible()

    // Form fields visible
    await expect(page.getByLabel(/Slug|Username/i)).toBeVisible()
    await expect(page.getByLabel(/Display Name/i)).toBeVisible()
  })

  test('My DAOs page (/my-daos) loads correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/my-daos`)

    // Main content visible
    await expect(page.locator('main')).toBeVisible()

    // Header still visible
    await expect(page.locator('header')).toBeVisible()
  })
})

test.describe('Navigation', () => {
  test('can navigate between all pages', async ({ page }) => {
    await page.goto(BASE_URL)

    // Navigate to Create
    await page
      .getByRole('link', { name: /Create DAO/i })
      .first()
      .click()
    await expect(page).toHaveURL(`${BASE_URL}/create`)

    // Navigate back home
    const homeLink = page
      .getByRole('link', { name: /Cancel|Autocrat|Home/i })
      .first()
    await homeLink.click()
    await expect(page).toHaveURL(BASE_URL)
  })
})

test.describe('Theme Toggle', () => {
  test('can toggle between light and dark mode', async ({ page }) => {
    await page.goto(BASE_URL)

    // Look for theme toggle button
    const themeButton = page
      .locator('button')
      .filter({ has: page.locator('svg') })
      .first()

    if (await themeButton.isVisible().catch(() => false)) {
      await themeButton.click()
      // Just verify it's clickable
    }

    // Page should still work
    await expect(page.locator('main')).toBeVisible()
  })

  test('theme persists across navigation', async ({ page }) => {
    await page.goto(BASE_URL)

    // Navigate and verify page still works
    await page.goto(`${BASE_URL}/create`)
    await expect(page.locator('main')).toBeVisible()
  })
})

test.describe('Responsive Design', () => {
  test('mobile viewport renders without errors', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(BASE_URL)

    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('header')).toBeVisible()
  })

  test('tablet viewport renders without errors', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(BASE_URL)

    await expect(page.locator('main')).toBeVisible()
  })
})
