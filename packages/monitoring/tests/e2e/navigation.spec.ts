/** E2E tests for navigation and theme toggling. */

import { expect, test } from '@playwright/test'

test.describe('Desktop Navigation', () => {
  // Skip desktop nav tests on mobile
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 1024,
    'Desktop navigation not visible on mobile',
  )

  test('should navigate to all pages via header nav', async ({ page }) => {
    await page.goto('/')

    // Navigate to Alerts
    await page.getByRole('link', { name: 'Alerts' }).first().click()
    await expect(page).toHaveURL('/alerts')
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()

    // Navigate to Targets
    await page.getByRole('link', { name: 'Targets' }).first().click()
    await expect(page).toHaveURL('/targets')
    await expect(page.getByRole('heading', { name: 'Targets' })).toBeVisible()

    // Navigate to OIF
    await page.getByRole('link', { name: 'OIF' }).first().click()
    await expect(page).toHaveURL('/oif')
    await expect(page.getByRole('heading', { name: 'OIF' })).toBeVisible()

    // Navigate to Query
    await page.getByRole('link', { name: 'Query' }).first().click()
    await expect(page).toHaveURL('/query')
    await expect(page.getByRole('heading', { name: 'Query' })).toBeVisible()

    // Navigate back to Dashboard
    await page.getByRole('link', { name: 'Dashboard' }).first().click()
    await expect(page).toHaveURL('/')
  })

  test('should navigate via quick links on dashboard', async ({ page }) => {
    await page.goto('/')

    // Click Alerts quick link (the card link, not nav)
    await page.locator('main a[href="/alerts"]').first().click()
    await expect(page).toHaveURL('/alerts')

    await page.goto('/')

    // Click Targets quick link
    await page.locator('main a[href="/targets"]').first().click()
    await expect(page).toHaveURL('/targets')

    await page.goto('/')

    // Click OIF quick link
    await page.locator('main a[href="/oif"]').first().click()
    await expect(page).toHaveURL('/oif')
  })

  test('should navigate to alerts from View All link', async ({ page }) => {
    await page.goto('/')

    // Click View all link in Recent Alerts
    await page.getByRole('link', { name: 'View all' }).click()
    await expect(page).toHaveURL('/alerts')
  })

  test('should highlight active nav item', async ({ page }) => {
    await page.goto('/alerts')

    // Active nav item should have primary color styling
    const alertsLink = page.getByRole('link', { name: 'Alerts' }).first()
    await expect(alertsLink).toHaveCSS('color', 'rgb(255, 107, 53)') // --color-primary
  })
})

test.describe('Mobile Navigation', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('should open and close mobile menu', async ({ page }) => {
    await page.goto('/')
    const menuButton = page
      .locator('header button')
      .filter({ has: page.locator('svg') })
      .last()
    await menuButton.click()
    await expect(page.getByText('Menu')).toBeVisible()
    const closeButton = page
      .locator('nav')
      .filter({ hasText: 'Menu' })
      .locator('button')
      .first()
    await closeButton.click()
    await page.waitForTimeout(400)
    const menuNav = page.locator('nav').filter({ hasText: 'Menu' })
    await expect(menuNav).toHaveClass(/translate-x-full/)
  })

  test('should navigate via mobile menu', async ({ page }) => {
    await page.goto('/')
    const menuButton = page
      .locator('header button')
      .filter({ has: page.locator('svg') })
      .last()
    await menuButton.click()
    await page
      .locator('nav')
      .filter({ hasText: 'Menu' })
      .getByRole('link', { name: 'Alerts' })
      .click()
    await expect(page).toHaveURL('/alerts')
  })

  test('should navigate via bottom nav', async ({ page }) => {
    await page.goto('/')
    const bottomNav = page.locator('nav').last()
    await bottomNav.getByRole('link', { name: 'Alerts' }).click()
    await expect(page).toHaveURL('/alerts')
  })
})

test.describe('Theme Toggle', () => {
  test('should toggle between light and dark mode', async ({ page }) => {
    await page.goto('/')
    const themeButton = page.locator('header button').first()
    const html = page.locator('html')
    const initialDark = await html.evaluate((el) =>
      el.classList.contains('dark'),
    )
    await themeButton.click()
    const afterToggle = await html.evaluate((el) =>
      el.classList.contains('dark'),
    )
    expect(afterToggle).toBe(!initialDark)
    await themeButton.click()
    const afterSecondToggle = await html.evaluate((el) =>
      el.classList.contains('dark'),
    )
    expect(afterSecondToggle).toBe(initialDark)
  })

  test('should persist theme preference', async ({ page }) => {
    await page.goto('/')
    const themeButton = page.locator('header button').first()
    const html = page.locator('html')
    await themeButton.click()
    const isLight = await html.evaluate((el) => !el.classList.contains('dark'))

    if (!isLight) {
      await themeButton.click()
    }
    await page.reload()
    const afterReload = await html.evaluate(
      (el) => !el.classList.contains('dark'),
    )
    expect(afterReload).toBe(true)
  })
})

test.describe('Logo Navigation', () => {
  test('should navigate home when clicking logo', async ({ page }) => {
    await page.goto('/alerts')
    await page.getByRole('link', { name: 'Monitoring' }).click()
    await expect(page).toHaveURL('/')
  })
})
