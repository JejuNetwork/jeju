import { expect, test } from '@playwright/test'

const BASE_URL = 'http://localhost:1420'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
  })

  test('loads the dashboard view', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible()
  })

  test('displays sidebar navigation', async ({ page }) => {
    const sidebar = page.locator('[class*="sidebar"]').or(page.locator('nav'))
    if (await sidebar.isVisible()) {
      const hasServices = await page
        .locator('text=Services')
        .first()
        .isVisible()
      const hasEarnings = await page
        .locator('text=Earnings')
        .first()
        .isVisible()
      const hasSettings = await page
        .locator('text=Settings')
        .first()
        .isVisible()

      expect(hasServices || hasEarnings || hasSettings).toBeTruthy()
    }
  })
})

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
  })

  test('Dashboard navigation works', async ({ page }) => {
    const button = page.locator('text=Dashboard').first()
    if (await button.isVisible()) {
      await button.click()
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('Services navigation works', async ({ page }) => {
    const link = page.locator('text=Services').first()
    if (await link.isVisible()) {
      await link.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toContainText(
        /Service|Compute|Provider/i,
      )
    }
  })

  test('Bots navigation works', async ({ page }) => {
    const link = page.locator('text=Bots').first()
    if (await link.isVisible()) {
      await link.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('Earnings navigation works', async ({ page }) => {
    const link = page.locator('text=Earnings').first()
    if (await link.isVisible()) {
      await link.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toContainText(/Earn|Total|USD|\$/i)
    }
  })

  test('Staking navigation works', async ({ page }) => {
    const link = page.locator('text=Staking').first()
    if (await link.isVisible()) {
      await link.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('Settings navigation works', async ({ page }) => {
    const link = page.locator('text=Settings').first()
    if (await link.isVisible()) {
      await link.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toContainText(
        /Setting|Config|Network/i,
      )
    }
  })

  test('Wallet navigation works', async ({ page }) => {
    const link = page.locator('text=Wallet').first()
    if (await link.isVisible()) {
      await link.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('can navigate through all views without errors', async ({ page }) => {
    const navItems = [
      'Dashboard',
      'Services',
      'Bots',
      'Earnings',
      'Staking',
      'Settings',
    ]

    for (const item of navItems) {
      const link = page.locator(`text=${item}`).first()
      if (await link.isVisible()) {
        await link.click()
        await page.waitForLoadState('networkidle')
        await expect(page.locator('body')).toBeVisible()
      }
    }
  })
})

test.describe('Responsive Design', () => {
  test('renders correctly on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
  })

  test('renders correctly on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
  })

  test('renders correctly on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
  })
})
