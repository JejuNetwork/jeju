/**
 * @fileoverview Token Registry E2E tests
 * @module gateway/tests/e2e/token-registry
 */

import { test, expect, setupMetaMask, importTestAccount, connectWallet } from '../fixtures/wallet';

test.describe('Token Registry Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupMetaMask(metamask);
    await importTestAccount(metamask);
    await page.goto('/');
    await connectWallet(page);
  });

  test('should display registered tokens list', async ({ page }) => {
    // Navigate to tokens tab (should be default)
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    
    // Check for token list heading
    await expect(page.getByText(/Registered Tokens/i)).toBeVisible();
  });

  test('should show register new token form', async ({ page }) => {
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    
    // Scroll to register section
    await expect(page.getByText('Register New Token')).toBeVisible();
    
    // Form fields should be visible
    await expect(page.getByPlaceholder('0x...')).toBeVisible();
    await expect(page.getByText('Min Fee (basis points)')).toBeVisible();
    await expect(page.getByText('Max Fee (basis points)')).toBeVisible();
  });

  test('should validate token address format', async ({ page }) => {
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    
    // Try to register with invalid address
    await page.getByPlaceholder('0x...').fill('invalid');
    await page.getByRole('button', { name: /Register Token/i }).click();
    
    // Should show error
    await expect(page.getByText(/Invalid token address/i)).toBeVisible();
  });

  test('should validate fee ranges', async ({ page }) => {
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    
    // Fill valid token address
    const tokenInput = page.getByPlaceholder('0x...');
    await tokenInput.fill('0x1234567890123456789012345678901234567890');
    
    // Set max fee lower than min fee
    const minFeeInput = page.locator('input[type="number"]').first();
    const maxFeeInput = page.locator('input[type="number"]').nth(1);
    
    await minFeeInput.fill('200');
    await maxFeeInput.fill('100');
    
    await page.getByRole('button', { name: /Register Token/i }).click();
    
    // Should show validation error
    await expect(page.getByText(/Min fee must be <= max fee/i)).toBeVisible();
  });

  test('should prevent fees above 5%', async ({ page }) => {
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    
    const tokenInput = page.getByPlaceholder('0x...');
    await tokenInput.fill('0x1234567890123456789012345678901234567890');
    
    const maxFeeInput = page.locator('input[type="number"]').nth(1);
    await maxFeeInput.fill('600'); // > 500 basis points
    
    await page.getByRole('button', { name: /Register Token/i }).click();
    
    await expect(page.getByText(/cannot exceed 5%/i)).toBeVisible();
  });

  test('should display registration fee', async ({ page }) => {
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    
    // Registration fee should be displayed
    await expect(page.getByText(/Registration Fee/i)).toBeVisible();
    await expect(page.getByText(/0.1 ETH/i)).toBeVisible();
  });

  test('should show token details in cards', async ({ page }) => {
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    
    // If tokens are registered, check their display
    const tokenCards = page.locator('.card').filter({ hasText: 'Active' });
    const count = await tokenCards.count();
    
    if (count > 0) {
      // Check first token card has expected info
      const firstCard = tokenCards.first();
      await expect(firstCard.getByText(/Fee Range/i)).toBeVisible();
      await expect(firstCard.getByText(/Total Volume/i)).toBeVisible();
      await expect(firstCard.getByText(/Transactions/i)).toBeVisible();
      await expect(firstCard.getByText(/Paymaster/i)).toBeVisible();
    }
  });
});

