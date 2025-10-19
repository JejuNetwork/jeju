import { test, expect } from '@playwright/test'

test.describe('Bazaar Homepage', () => {
  test('should display homepage with all features', async ({ page }) => {
    await page.goto('/')

    // Check title
    await expect(page.getByRole('heading', { name: /Welcome to Bazaar/i })).toBeVisible()

    // Check feature cards
    await expect(page.getByText('Tokens')).toBeVisible()
    await expect(page.getByText('Swap')).toBeVisible()
    await expect(page.getByText('Pools')).toBeVisible()
    await expect(page.getByText('NFTs')).toBeVisible()
  })

  test('should navigate to tokens page', async ({ page }) => {
    await page.goto('/')

    // Click on Tokens card
    await page.getByRole('link', { name: /Tokens/i }).first().click()

    // Should be on tokens page
    await expect(page).toHaveURL(/\/tokens/)
    await expect(page.getByRole('heading', { name: /Tokens/i })).toBeVisible()
  })

  test('should display navigation menu', async ({ page }) => {
    await page.goto('/')

    // Check navigation items
    await expect(page.getByRole('link', { name: /^Home$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Tokens$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Swap$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Pools$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^NFTs$/i })).toBeVisible()
  })
})



