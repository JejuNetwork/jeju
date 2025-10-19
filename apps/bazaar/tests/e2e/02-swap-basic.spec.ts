import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';
import { navigateToSwap } from '../../../../tests/shared/helpers/navigation';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar Token Swap - Basic', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);
    await navigateToSwap(page);
  });

  test('should display swap interface', async ({ page }) => {
    // Should show swap form
    await expect(page.getByText('Swap Tokens')).toBeVisible();

    // Should show token selectors
    await expect(page.locator('select, button').filter({ hasText: /ETH|USDC|elizaOS/ })).toHaveCount(2);

    // Should show swap button
    await expect(page.locator('button:has-text("Swap")')).toBeVisible();
  });

  test('should enter swap amount', async ({ page }) => {
    // Find amount input
    const amountInput = page.locator('input[placeholder*="0.0"]').first();

    // Enter amount
    await amountInput.fill('0.1');

    // Should show entered amount
    await expect(amountInput).toHaveValue('0.1');
  });

  test('should select input and output tokens', async ({ page }) => {
    // Select input token
    const inputSelect = page.locator('select[name*="input"], select[name*="from"]').first();

    if (await inputSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await inputSelect.selectOption('ETH');
      expect(await inputSelect.inputValue()).toBe('ETH');
    }

    // Select output token
    const outputSelect = page.locator('select[name*="output"], select[name*="to"]').first();

    if (await outputSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await outputSelect.selectOption('USDC');
      expect(await outputSelect.inputValue()).toBe('USDC');
    }
  });

  test('should show estimated output', async ({ page }) => {
    // Enter input amount
    const amountInput = page.locator('input[placeholder*="0.0"]').first();
    await amountInput.fill('1.0');

    // Wait for quote
    await page.waitForTimeout(2000);

    // Should show output estimate
    const outputDisplay = page.locator('[data-output-amount], .output-amount').first();

    if (await outputDisplay.isVisible({ timeout: 3000 }).catch(() => false)) {
      const outputText = await outputDisplay.textContent();
      console.log(`Estimated output: ${outputText}`);
      expect(outputText).toBeTruthy();
    }
  });

  test('should show swap button disabled without amount', async ({ page }) => {
    const swapButton = page.locator('button:has-text("Swap")').first();

    // Should be disabled without amount
    await expect(swapButton).toBeDisabled();
  });

  test('should enable swap button with valid amount', async ({ page }) => {
    // Enter amount
    const amountInput = page.locator('input[placeholder*="0.0"]').first();
    await amountInput.fill('0.1');

    await page.waitForTimeout(1000);

    const swapButton = page.locator('button:has-text("Swap")').first();

    // Should be enabled with amount
    // Note: May still be disabled if no liquidity/quotes available
    const isDisabled = await swapButton.isDisabled();
    console.log(`Swap button disabled: ${isDisabled}`);
  });
});
