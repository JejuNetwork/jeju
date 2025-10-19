import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet, executeSwap } from '../../../../tests/shared/helpers/contracts';
import { navigateToSwap } from '../../../../tests/shared/helpers/navigation';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar Token Swap - With Approval', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);
    await navigateToSwap(page);
  });

  test('should swap ETH for USDC', async ({ wallet, page }) => {
    // Execute swap using helper
    await executeSwap(page, wallet, {
      inputToken: 'ETH',
      outputToken: 'USDC',
      amount: '0.1',
    });

    // Should show success
    await expect(page.locator('text=/success|completed/i')).toBeVisible({
      timeout: 60000,
    });
  });

  test.skip('should approve ERC20 token before swap', async ({ wallet, page }) => {
    // This test requires ERC20 -> ERC20 swap
    // Select USDC -> elizaOS
    const inputSelect = page.locator('select[name*="input"]').first();
    if (await inputSelect.isVisible().catch(() => false)) {
      await inputSelect.selectOption('USDC');
    }

    const outputSelect = page.locator('select[name*="output"]').first();
    if (await outputSelect.isVisible().catch(() => false)) {
      await outputSelect.selectOption('elizaOS');
    }

    // Enter amount
    const amountInput = page.locator('input[placeholder*="0.0"]').first();
    await amountInput.fill('100');

    // Click swap
    const swapButton = page.locator('button:has-text("Swap")').first();
    await swapButton.click();

    // Should show approval prompt
    await expect(page.getByText(/Approve|Approval/i)).toBeVisible({ timeout: 10000 });

    // Approve
    await wallet.confirmTransaction();

    // Wait for approval
    await page.waitForTimeout(3000);

    // Then execute swap
    await wallet.confirmTransaction();

    // Success
    await expect(page.getByText(/success/i)).toBeVisible({ timeout: 60000 });
  });
});
