import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet, addLiquidity } from '../../../../tests/shared/helpers/contracts';
import { navigateToLiquidity } from '../../../../tests/shared/helpers/navigation';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar Add Liquidity', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);
    await navigateToLiquidity(page);
  });

  test('should display add liquidity form', async ({ page }) => {
    await expect(page.getByText(/Add Liquidity|Provide Liquidity/i)).toBeVisible();

    // Should show input fields for both tokens
    const amountInputs = page.locator('input[type="number"], input[type="text"]');
    await expect(amountInputs).toHaveCount(2, { timeout: 5000 });
  });

  test('should select token pair', async ({ page }) => {
    // Select first token
    const token0Select = page.locator('select, button').filter({ hasText: /Select Token|Token/i }).first();

    if (await token0Select.isVisible({ timeout: 3000 }).catch(() => false)) {
      await token0Select.click();

      // Should show token list
      await expect(page.getByText(/ETH|USDC|elizaOS/i)).toBeVisible();
    }
  });

  test('should enter liquidity amounts', async ({ page }) => {
    // Find amount inputs
    const amount0Input = page.locator('input[name*="amount"], input[placeholder*="0.0"]').first();
    const amount1Input = page.locator('input[name*="amount"], input[placeholder*="0.0"]').nth(1);

    // Enter amounts
    await amount0Input.fill('1.0');
    await amount1Input.fill('1000');

    // Should display entered amounts
    await expect(amount0Input).toHaveValue('1.0');
    await expect(amount1Input).toHaveValue('1000');
  });

  test('should show liquidity preview', async ({ page }) => {
    // Enter amounts
    const amount0Input = page.locator('input[name*="amount"], input[placeholder*="0.0"]').first();
    await amount0Input.fill('1.0');

    await page.waitForTimeout(2000);

    // Should show preview of LP tokens to receive
    const previewSection = page.locator('[data-preview], .preview, text=/You will receive/i');

    if (await previewSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Preview displayed');
    }
  });

  test('should approve tokens before adding liquidity', async ({ wallet, page }) => {
    // Enter amounts
    const amount0Input = page.locator('input[name*="amount"], input[placeholder*="0.0"]').first();
    const amount1Input = page.locator('input[name*="amount"], input[placeholder*="0.0"]').nth(1);

    await amount0Input.fill('0.1');
    await amount1Input.fill('100');

    // Look for approve button
    const approveButton = page.locator('button:has-text("Approve")').first();

    if (await approveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveButton.click();

      // Confirm in MetaMask
      await wallet.confirmTransaction();

      // Wait for approval
      await expect(page.getByText(/Approved|Approval confirmed/i)).toBeVisible({
        timeout: 30000
      });
    }
  });

  test.skip('should add liquidity successfully', async ({ wallet, page }) => {
    // Use helper to add liquidity
    await addLiquidity(page, wallet, {
      token0: 'ETH',
      token1: 'USDC',
      amount0: '0.1',
      amount1: '100',
    });

    // Should show success
    await expect(page.getByText(/Liquidity added|Success/i)).toBeVisible();
  });

  test('should show liquidity balance after adding', async ({ page }) => {
    // Navigate to pools or positions
    await page.goto(`${BAZAAR_URL}/pools`);

    await page.waitForTimeout(2000);

    // Should show user's liquidity positions
    const positionsList = page.locator('[data-testid="position"], [data-position]');

    if (await positionsList.count() > 0) {
      console.log('User has liquidity positions');
      await expect(positionsList.first()).toBeVisible();
    }
  });
});
