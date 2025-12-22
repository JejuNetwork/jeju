import { expect, test } from '@playwright/test'

test.describe('VPN Contribution Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('h1')
    await page.locator('nav button').nth(1).click()
    await expect(page.getByText('Fair Contribution')).toBeVisible()
  })

  test('displays adaptive bandwidth status', async ({ page }) => {
    await expect(page.getByText('Adaptive Bandwidth')).toBeVisible()
  })

  test('displays contribution quota', async ({ page }) => {
    await expect(page.getByText('Contribution Quota')).toBeVisible()
  })

  test('displays edge CDN cache status', async ({ page }) => {
    await expect(page.getByText('Edge CDN Cache')).toBeVisible()
  })

  test('displays contribution settings', async ({ page }) => {
    await expect(page.getByText('Auto Contribution')).toBeVisible()
    await expect(page.getByText('Earning Mode')).toBeVisible()
  })

  test('displays fair sharing explanation', async ({ page }) => {
    await expect(page.getByText('How Fair Sharing Works')).toBeVisible()
  })
})
