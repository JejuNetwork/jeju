import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

test.describe('Tokens Listing Page', () => {
  test('should display tokens page', async ({ page }) => {
    await page.goto('/tokens')

    await expect(page.getByRole('heading', { name: /Tokens/i })).toBeVisible()
    await expect(page.getByText(/Browse and trade tokens/i)).toBeVisible()
  })

  test('should show create token button', async ({ page }) => {
    await page.goto('/tokens')

    const createButton = page.getByRole('link', { name: /Create Token/i })
    await expect(createButton).toBeVisible()
    await expect(createButton).toHaveAttribute('href', '/tokens/create')
  })

  test('should have filter buttons', async ({ page }) => {
    await page.goto('/tokens')

    await expect(page.getByRole('button', { name: /All Tokens/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Verified/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /New/i })).toBeVisible()
  })

  test('should switch between filters', async ({ page }) => {
    await page.goto('/tokens')

    const allButton = page.getByRole('button', { name: /All Tokens/i })
    const verifiedButton = page.getByRole('button', { name: /Verified/i })

    // Click verified filter
    await verifiedButton.click()
    await expect(verifiedButton).toHaveClass(/bg-purple-600/)

    // Click back to all
    await allButton.click()
    await expect(allButton).toHaveClass(/bg-purple-600/)
  })
})



