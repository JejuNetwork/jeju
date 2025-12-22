import { expect, test } from '@playwright/test'

test.describe('VPN Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('h1')
    await page.locator('nav button').nth(2).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('displays protocol options', async ({ page }) => {
    await expect(page.getByText('WireGuard')).toBeVisible()
    await expect(page.getByText('Recommended')).toBeVisible()
  })

  test('displays DNS options', async ({ page }) => {
    await expect(page.getByText('Cloudflare')).toBeVisible()
    await expect(page.getByText('1.1.1.1')).toBeVisible()
  })

  test('displays kill switch option', async ({ page }) => {
    await expect(page.getByText('Kill Switch')).toBeVisible()
  })

  test('displays about section', async ({ page }) => {
    await expect(page.getByText('Version')).toBeVisible()
    await expect(page.getByText('0.1.0')).toBeVisible()
  })
})
