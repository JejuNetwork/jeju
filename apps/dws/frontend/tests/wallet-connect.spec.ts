import { expect, test } from '@playwright/test'

// Basic wallet UI tests - actual MetaMask integration tested separately
test.describe('Wallet UI', () => {
  test('should show connect wallet button when not connected', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(
      page.locator('button:has-text("Connect Wallet")').first(),
    ).toBeVisible()
  })

  test('should show welcome screen when not connected', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.locator('h3:has-text("Welcome to DWS Console")'),
    ).toBeVisible()
  })

  test('should prompt to connect wallet on main dashboard', async ({
    page,
  }) => {
    await page.goto('/')
    const connectButton = page.locator('main button:has-text("Connect Wallet")')
    await expect(connectButton).toBeVisible()
  })

  test('should show connect wallet in header', async ({ page }) => {
    await page.goto('/')
    const headerConnect = page.locator(
      'header button:has-text("Connect Wallet")',
    )
    await expect(headerConnect).toBeVisible()
  })

  test('should show consumer/provider toggle', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('button:has-text("Consumer")')).toBeVisible()
    await expect(page.locator('button:has-text("Provider")')).toBeVisible()
  })

  test('should be able to switch to provider mode UI', async ({ page }) => {
    await page.goto('/')
    await page.locator('button:has-text("Provider")').click()
    // Provider mode button should be active
    await expect(page.locator('button:has-text("Provider")')).toHaveClass(
      /active/,
    )
  })

  test('should show disabled buttons when not connected', async ({ page }) => {
    await page.goto('/compute/containers')
    const runButton = page.locator('button:has-text("Run Container")').first()
    await expect(runButton).toBeDisabled()
  })
})
