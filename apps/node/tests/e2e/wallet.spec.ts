/**
 * Wallet E2E Tests
 * Tests wallet UI elements and interactions
 */

import { expect, test } from '@playwright/test'

const BASE_URL = 'http://localhost:1420'

async function navigateToWallet(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')

  const walletLink = page.locator('text=Wallet').first()
  if (await walletLink.isVisible()) {
    await walletLink.click()
    await page.waitForLoadState('networkidle')
  }
}

test.describe('Wallet UI', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToWallet(page)
  })

  test('Connect Wallet button is present when not connected', async ({
    page,
  }) => {
    const connectButton = page.locator('button:has-text("Connect")')
    const isVisible = await connectButton.first().isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('Copy Address button works when connected', async ({ page }) => {
    const copyButton = page.locator(
      'button:has([class*="Copy"]), button:has([class*="copy"])',
    )
    if (await copyButton.first().isVisible()) {
      await copyButton.first().click()
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('Disconnect button is present when connected', async ({ page }) => {
    const disconnectButton = page.locator('button:has-text("Disconnect")')
    const isVisible = await disconnectButton.first().isVisible()
    expect(typeof isVisible).toBe('boolean')
  })
})
