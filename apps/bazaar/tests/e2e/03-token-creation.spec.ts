import { test, expect } from '@playwright/test'

test.describe('Token Creation Page', () => {
  test('should display create token form', async ({ page }) => {
    await page.goto('/tokens/create')

    await expect(page.getByRole('heading', { name: /Create Token/i })).toBeVisible()
    await expect(page.getByText(/Launch your own ERC20 token/i)).toBeVisible()
  })

  test('should have all required form fields', async ({ page }) => {
    await page.goto('/tokens/create')

    // Check for form fields
    await expect(page.getByPlaceholder(/My Awesome Token/i)).toBeVisible()
    await expect(page.getByPlaceholder(/MAT/i)).toBeVisible()
    await expect(page.getByPlaceholder(/Describe your token/i)).toBeVisible()
    await expect(page.getByPlaceholder('1000000')).toBeVisible()
  })

  test('should show wallet connection requirement', async ({ page }) => {
    await page.goto('/tokens/create')

    // Should show connect wallet message when not connected
    await expect(page.getByText(/Please connect your wallet/i)).toBeVisible()
  })

  test('should display how it works section', async ({ page }) => {
    await page.goto('/tokens/create')

    await expect(page.getByText(/How it works/i)).toBeVisible()
    await expect(page.getByText(/Connect your wallet/i)).toBeVisible()
    await expect(page.getByText(/Fill in token details/i)).toBeVisible()
    await expect(page.getByText(/Deploy your ERC20 token contract/i)).toBeVisible()
    await expect(page.getByText(/appears on Bazaar automatically/i)).toBeVisible()
  })

  test('should validate form inputs', async ({ page }) => {
    await page.goto('/tokens/create')

    const createButton = page.getByRole('button', { name: /Create Token/i }).last()

    // Button should be disabled without inputs
    await expect(createButton).toBeDisabled()

    // Fill in required fields
    await page.getByPlaceholder(/My Awesome Token/i).fill('Test Token')
    await page.getByPlaceholder(/MAT/i).fill('TEST')

    // Still disabled if not connected
    await expect(createButton).toBeDisabled()
  })
})



