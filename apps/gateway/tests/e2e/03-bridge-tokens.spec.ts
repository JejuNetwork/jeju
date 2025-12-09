/**
 * @fileoverview Bridge token E2E tests
 * @module gateway/tests/e2e/bridge-tokens
 */

import { testWithWallet as test, expect } from '../fixtures/wallet';
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';
import { connectWallet } from '@jejunetwork/tests/helpers/contracts';

test.describe('Bridge from Ethereum Flow', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
    
    // Navigate to Bridge tab
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
  });

  test('should display bridge interface', async ({ page }) => {
    await expect(page.getByText('Bridge from Ethereum to Jeju')).toBeVisible();
  });

  test('should show elizaOS warning message', async ({ page }) => {
    // elizaOS is native and should not be bridgeable
    await expect(page.getByText(/elizaOS is a native Jeju token/i)).toBeVisible();
    await expect(page.getByText(/cannot be bridged from Ethereum/i)).toBeVisible();
  });

  test('should only show bridgeable tokens in selector', async ({ page }) => {
    // Click token selector
    await page.locator('.input').first().click();
    
    // Should show CLANKER, VIRTUAL, CLANKERMON but NOT elizaOS
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    // elizaOS should not be in the dropdown
    const dropdown = page.locator('[style*="position: absolute"]').filter({ hasText: 'CLANKER' });
    await expect(dropdown.getByText('elizaOS')).not.toBeVisible();
  });

  test('should allow custom token address input', async ({ page }) => {
    // Switch to custom token mode
    await page.getByRole('button', { name: /Custom Address/i }).click();
    
    // Custom address input should appear
    await expect(page.getByPlaceholder('0x...')).toBeVisible();
    await expect(page.getByText(/Enter any ERC20 token address/i)).toBeVisible();
  });

  test('should validate amount input', async ({ page }) => {
    // Select a token
    await page.locator('.input').first().click();
    await page.getByText('CLANKER').click();
    
    // Amount input should be enabled
    const amountInput = page.getByPlaceholder('0.0');
    await expect(amountInput).toBeEnabled();
    
    // Enter amount
    await amountInput.fill('100');
    
    // USD value should be calculated and displayed
    await expect(page.getByText(/≈ \$/)).toBeVisible();
  });

  test('should allow optional recipient address', async ({ page }) => {
    // Select token and amount
    await page.locator('.input').first().click();
    await page.getByText('VIRTUAL').click();
    await page.getByPlaceholder('0.0').fill('50');
    
    // Recipient field should be optional
    const recipientInput = page.getByPlaceholder(/0x.../);
    await expect(recipientInput).toBeVisible();
    
    // Bridge button should be enabled even without recipient
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeEnabled();
  });

  test('should display bridge information', async ({ page }) => {
    await expect(page.getByText(/Estimated Time/i)).toBeVisible();
    await expect(page.getByText(/~2 minutes/i)).toBeVisible();
    await expect(page.getByText(/OP Stack Standard Bridge/i)).toBeVisible();
  });

  test('should disable bridge button without amount', async ({ page }) => {
    // Select token but no amount
    await page.locator('.input').first().click();
    await page.getByText('CLANKERMON').click();
    
    // Bridge button should be disabled
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeDisabled();
  });

  test('should validate custom token address format', async ({ page }) => {
    await page.getByRole('button', { name: /Custom Address/i }).click();
    
    const customInput = page.getByPlaceholder('0x...');
    await customInput.fill('invalid-address');
    
    const amountInput = page.getByPlaceholder('0.0');
    await amountInput.fill('100');
    
    // Bridge button should remain disabled with invalid address
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeDisabled();
  });
});


