import { expect, test } from '@playwright/test'

test.describe('VPN Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('h1')
  })

  test('navigates to contribution tab', async ({ page }) => {
    await page.locator('nav button').nth(1).click()
    await expect(page.getByText('Fair Contribution')).toBeVisible()
  })

  test('navigates to settings tab', async ({ page }) => {
    await page.locator('nav button').nth(2).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('navigates back to VPN tab', async ({ page }) => {
    await page.locator('nav button').nth(2).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.locator('nav button').nth(0).click()
    await expect(page.getByText('Tap to Connect')).toBeVisible()
  })
})
