/**
 * Token Operations Transaction Tests
 * Tests ALL token registration and management transactions
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTransaction } from '../helpers/transaction-helpers';
import { GATEWAY_URL, FEE_MARGINS, randomAddress } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Token Registration Transactions', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should register new token with valid parameters', async ({ page, metamask }) => {
    // Generate random token address for testing
    const testTokenAddress = randomAddress();

    // Fill registration form
    await page.getByPlaceholder('0x...').fill(testTokenAddress);
    await page.locator('input[placeholder="0"]').fill(FEE_MARGINS.MIN.toString());
    await page.locator('input[placeholder="200"]').fill(FEE_MARGINS.MAX.toString());

    await page.screenshot({
      path: 'test-results/screenshots/token-tx/01-registration-form.png',
      fullPage: true,
    });

    // Submit
    await page.getByRole('button', { name: /Register Token/i }).click();

    // Confirm transaction
    await executeTransaction(page, metamask, {
      expectSuccessMessage: 'Token registered successfully',
      timeout: 60000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/token-tx/02-registered-success.png',
      fullPage: true,
    });

    console.log('✅ Token registration transaction successful');
  });

  test('should reject registration with invalid address', async ({ page }) => {
    await page.getByPlaceholder('0x...').fill('not-an-address');
    await page.locator('input[placeholder="0"]').fill('0');
    await page.locator('input[placeholder="200"]').fill('200');

    const submitButton = page.getByRole('button', { name: /Register Token/i });
    await submitButton.click();

    // Should show error
    await expect(page.getByText(/Invalid token address/i)).toBeVisible({ timeout: 5000 });

    console.log('✅ Invalid address rejected');
  });

  test('should reject min > max fee configuration', async ({ page }) => {
    await page.getByPlaceholder('0x...').fill(randomAddress());
    await page.locator('input[placeholder="0"]').fill('300'); // Min
    await page.locator('input[placeholder="200"]').fill('100'); // Max (less than min)

    const submitButton = page.getByRole('button', { name: /Register Token/i });
    await submitButton.click();

    await expect(page.getByText(/Min fee must be <= max fee/i)).toBeVisible({ timeout: 5000 });

    console.log('✅ Min > Max fee rejected');
  });

  test('should reject max fee > 500 bps', async ({ page }) => {
    await page.getByPlaceholder('0x...').fill(randomAddress());
    await page.locator('input[placeholder="0"]').fill('0');
    await page.locator('input[placeholder="200"]').fill('600'); // > 500 max

    const submitButton = page.getByRole('button', { name: /Register Token/i });
    await submitButton.click();

    await expect(page.getByText(/cannot exceed 5%/i)).toBeVisible({ timeout: 5000 });

    console.log('✅ Fee > 5% rejected');
  });

  test('should display registration fee requirement', async ({ page }) => {
    await expect(page.getByText(/Registration Fee:/i)).toBeVisible();
    await expect(page.getByText(/0.1.*ETH/i)).toBeVisible();

    console.log('✅ Registration fee displayed');
  });
});


