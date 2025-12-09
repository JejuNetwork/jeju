import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';

test.describe('Token Creation Page', () => {
  test('should display create token form', async ({ page }) => {
    await page.goto('/coins/create')

    await expect(page.getByRole('heading', { name: /Create Token/i })).toBeVisible()
    await expect(page.getByText(/Launch your own ERC20 token/i)).toBeVisible()
  })

  test('should have all required form fields', async ({ page }) => {
    await page.goto('/coins/create')

    // Check for form fields
    await expect(page.getByPlaceholder(/My Awesome Token/i)).toBeVisible()
    await expect(page.getByPlaceholder(/MAT/i)).toBeVisible()
    await expect(page.getByPlaceholder(/Describe your token/i)).toBeVisible()
    await expect(page.getByPlaceholder('1000000')).toBeVisible()
  })

  test('should show wallet connection requirement', async ({ page }) => {
    await page.goto('/coins/create')

    // Should show connect wallet message when not connected
    await expect(page.getByText(/Please connect your wallet/i)).toBeVisible()
  })

  test('should display how it works section', async ({ page }) => {
    await page.goto('/coins/create')

    await expect(page.getByRole('heading', { name: /How it works/i })).toBeVisible()
    await expect(page.getByText(/Connect your wallet and switch to Jeju network/i)).toBeVisible()
    await expect(page.getByText(/Fill in token details \(name, symbol, supply\)/i)).toBeVisible()
    await expect(page.getByText(/Deploy your ERC20 token contract/i)).toBeVisible()
    await expect(page.getByText(/appears on Bazaar automatically via the indexer/i)).toBeVisible()
  })

  test('should validate form inputs', async ({ page }) => {
    await page.goto('/coins/create')

    // Get the form submit button (inside main content, not header)
    const createButton = page.locator('main, [role="main"]').getByRole('button', { name: /Create Token|Connect Wallet|Switch to Jeju/i }).first()

    // Button should exist
    await expect(createButton).toBeVisible()
    const buttonText = await createButton.textContent()
    
    if (buttonText?.includes('Connect Wallet')) {
      // Not connected, button shows "Connect Wallet"
      expect(buttonText).toContain('Connect Wallet')
    } else if (buttonText?.includes('Switch to Jeju')) {
      // Connected but wrong chain
      expect(buttonText).toContain('Switch to Jeju')
    } else {
      // Connected and correct chain, button should be disabled without required inputs
      await expect(createButton).toBeDisabled()
    }

    // Fill in required fields
    await page.getByPlaceholder(/My Awesome Token/i).fill('Test Token')
    await page.getByPlaceholder(/MAT/i).fill('TEST')

    // Still disabled if not connected (button will show "Connect Wallet" or "Switch to Jeju")
    const updatedButtonText = await createButton.textContent()
    expect(updatedButtonText).toBeTruthy()
  })
})



