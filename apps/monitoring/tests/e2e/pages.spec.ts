/** E2E tests for page loading and content verification. */

import { expect, test } from '@playwright/test'

test.describe('Page Load Tests', () => {
  test.describe('Dashboard Page', () => {
    test('should load and display health overview', async ({ page }) => {
      await page.goto('/')
      await expect(page).toHaveTitle(/Network Monitoring/)
      await expect(page.locator('header')).toBeVisible()
      await expect(page.locator('main')).toBeVisible()
      const healthRing = page.locator('svg[role="img"]').first()
      await expect(healthRing).toBeVisible({ timeout: 10000 })
    })

    test('should display quick link cards', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('main a[href="/alerts"]').first()).toBeVisible()
      await expect(
        page.locator('main a[href="/targets"]').first(),
      ).toBeVisible()
      await expect(page.locator('main a[href="/oif"]').first()).toBeVisible()
    })

    test('should display recent alerts section', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByText('Recent Alerts')).toBeVisible()
      await expect(page.getByRole('link', { name: 'View all' })).toBeVisible()
    })
  })

  test.describe('Alerts Page', () => {
    test('should load and display alerts interface', async ({ page }) => {
      await page.goto('/alerts')
      await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible()
      await expect(page.getByText('Total')).toBeVisible()
      await expect(page.getByText('Critical')).toBeVisible()
      await expect(page.getByText('Warning')).toBeVisible()
      await expect(page.getByText('Info')).toBeVisible()
      await expect(page.getByPlaceholder('Search...')).toBeVisible()
    })

    test('should show no active alerts or alert list', async ({ page }) => {
      await page.goto('/alerts')
      await page.waitForTimeout(1000)
      const noAlerts = page.getByText('No active alerts')
      const alertList = page
        .locator('.card-static')
        .filter({ hasText: /alertname|severity/ })

      await expect(noAlerts.or(alertList.first())).toBeVisible()
    })
  })

  test.describe('Targets Page', () => {
    test('should load and display targets interface', async ({ page }) => {
      await page.goto('/targets')
      await expect(page.getByRole('heading', { name: 'Targets' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible()
      await expect(page.getByText('Total')).toBeVisible()
      await expect(page.getByText('Up')).toBeVisible()
      await expect(page.getByText('Down')).toBeVisible()
      await expect(page.getByPlaceholder('Search...')).toBeVisible()
    })

    test('should display health ring', async ({ page }) => {
      await page.goto('/targets')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('svg[role="img"]').first()).toBeVisible({
        timeout: 10000,
      })
    })
  })

  test.describe('OIF Stats Page', () => {
    test('should load and display OIF interface', async ({ page }) => {
      await page.goto('/oif')
      await expect(page.getByRole('heading', { name: 'OIF' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible()
      const tabContainer = page
        .locator('div')
        .filter({ has: page.getByRole('button') })
        .first()
      await expect(tabContainer).toBeVisible()
    })

    test('should display overview stats by default', async ({ page }) => {
      await page.goto('/oif')
      await expect(page.getByText('Intents', { exact: true })).toBeVisible()
      await expect(page.getByText('Volume', { exact: true })).toBeVisible()
      await expect(page.getByText('Healthy', { exact: true })).toBeVisible()
      await expect(page.getByText('Unhealthy', { exact: true })).toBeVisible()
    })
  })

  test.describe('Query Explorer Page', () => {
    test('should load and display query interface', async ({ page }) => {
      await page.goto('/query')
      await expect(page.getByRole('heading', { name: 'Query' })).toBeVisible()
      await expect(page.getByPlaceholder('PromQL...')).toBeVisible()
      await expect(page.getByRole('button', { name: /Run/i })).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'HTTP Rate' }),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'CPU' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Up' })).toBeVisible()
    })

    test('should display results section', async ({ page }) => {
      await page.goto('/query')
      await expect(page.getByText('Results')).toBeVisible()
    })
  })
})

test.describe('Mobile Responsiveness', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('should show mobile navigation', async ({ page }) => {
    await page.goto('/')
    const menuButton = page
      .locator('header button')
      .filter({ has: page.locator('svg') })
      .last()
    await expect(menuButton).toBeVisible()
    await menuButton.click()
    await expect(page.getByText('Menu')).toBeVisible()
  })

  test('should have mobile bottom nav', async ({ page }) => {
    await page.goto('/')
    const bottomNav = page
      .locator('nav')
      .filter({ has: page.getByRole('link') })
      .last()
    await expect(bottomNav).toBeVisible()
  })
})
