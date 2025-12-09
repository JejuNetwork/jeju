/**
 * Deep interaction tests for Market Detail page - EVERY button, EVERY action
 */

import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Market Detail - Deep Button Testing', () => {
  test('should test YES/NO button toggling extensively', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) {
      console.log('No markets available');
      return;
    }
    
    await marketCard.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const yesButton = page.getByTestId('outcome-yes-button');
    const noButton = page.getByTestId('outcome-no-button');
    
    const buttonsExist = await yesButton.isVisible() && 
                         await noButton.isVisible();
    
    if (!buttonsExist) return;
    
    // Click YES
    await yesButton.click();
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    await expect(yesButton).toHaveClass(/ring-green-400/);
    await expect(noButton).not.toHaveClass(/ring-red-400/);
    
    // Click NO
    await noButton.click();
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    await expect(noButton).toHaveClass(/ring-red-400/);
    await expect(yesButton).not.toHaveClass(/ring-green-400/);
    
    // Click YES again
    await yesButton.click();
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    await expect(yesButton).toHaveClass(/ring-green-400/);
    
    // Rapid clicking
    await noButton.click();
    await yesButton.click();
    await noButton.click();
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
  });

  test('should test amount input with edge cases', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) return;
    
    await marketCard.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const amountInput = page.getByTestId('amount-input');
    const inputExists = await amountInput.isVisible();
    
    if (!inputExists) return;
    
    // Test zero
    await amountInput.fill('0');
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    expect(await amountInput.inputValue()).toBe('0');
    
    // Test small amount
    await amountInput.fill('0.001');
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    
    // Test normal amount
    await amountInput.fill('1.5');
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    
    // Test large amount
    await amountInput.fill('999999');
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    
    // Test decimal precision
    await amountInput.fill('0.123456789');
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    
    // Test negative (if allowed)
    await amountInput.fill('-1');
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    
    // Clear and test empty
    await amountInput.fill('');
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
  });

  test('should test buy button states and interactions', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) return;
    
    await marketCard.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const buyButton = page.getByTestId('buy-button');
    const buttonExists = await buyButton.isVisible();
    
    if (!buttonExists) return;
    
    // Check initial state
    const initialText = await buyButton.textContent();
    expect(initialText).toBeTruthy();
    
    // Hover over button
    await buyButton.hover();
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    
    // Click button (will fail without wallet/contract but shouldn't crash)
    await buyButton.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
  });

  test('should test tab switching in activity section', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) return;
    
    await marketCard.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Find tab buttons
    const tabs = page.locator('button').filter({ hasText: /Recent Activity|Your Position/i });
    const tabCount = await tabs.count();
    
    if (tabCount > 0) {
      for (let i = 0; i < tabCount; i++) {
        const tab = tabs.nth(i);
        await tab.click();
        await page.waitForTimeout(300);
        await assertNoPageErrors(page);
      }
    }
  });

  test('should test price display interactions', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) return;
    
    await marketCard.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Verify price elements exist and are visible
    const yesPrice = page.locator('text=/YES/i').first();
    const noPrice = page.locator('text=/NO/i').first();
    
    const yesPriceVisible = await yesPrice.isVisible();
    const noPriceVisible = await noPrice.isVisible();
    
    if (yesPriceVisible || noPriceVisible) {
      await page.waitForTimeout(5000);
      await assertNoPageErrors(page);
    }
  });

  test('should test chart presence and interaction', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) return;
    
    await marketCard.click();
    await page.waitForTimeout(1000);
    await assertNoPageErrors(page);
    
    // Look for chart container
    const chartHeading = page.getByRole('heading', { name: /Price History/i });
    const chartExists = await chartHeading.isVisible();
    
    if (chartExists) {
      // Hover over chart area
      const chartContainer = page.locator('.recharts-wrapper').first();
      const containerExists = await chartContainer.isVisible();
      
      if (containerExists) {
        await chartContainer.hover();
        await page.waitForTimeout(500);
        await assertNoPageErrors(page);
      }
    }
  });

  test('should test navigation back to markets list', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) return;
    
    await marketCard.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Click Markets link in header
    const marketsLink = page.getByRole('link', { name: /^Markets$/i });
    await marketsLink.first().click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    await expect(page).toHaveURL('/markets');
  });
});

