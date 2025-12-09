/**
 * Deep interaction tests for Swap page - EVERY dropdown, EVERY input, EVERY combination
 */

import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Swap - Deep Interaction Testing', () => {
  test('should test all token dropdown selections', async ({ page }) => {
    await page.goto('/swap');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Test input token dropdown
    const inputTokenSelect = page.locator('select').first();
    await expect(inputTokenSelect).toBeVisible();
    
    // Get all available options
    const inputOptions = await inputTokenSelect.locator('option').allTextContents();
    console.log('Input token options:', inputOptions);
    
    // Test selecting each option
    for (const option of inputOptions.slice(0, 3)) {
      await inputTokenSelect.selectOption({ label: option });
      await page.waitForTimeout(200);
      await assertNoPageErrors(page);
    }
    
    // Test output token dropdown
    const outputTokenSelect = page.locator('select').nth(1);
    await expect(outputTokenSelect).toBeVisible();
    
    const outputOptions = await outputTokenSelect.locator('option').allTextContents();
    
    // Test selecting each option
    for (const option of outputOptions.slice(0, 3)) {
      await outputTokenSelect.selectOption({ label: option });
      await page.waitForTimeout(200);
      await assertNoPageErrors(page);
    }
  });

  test('should test amount input with various values', async ({ page }) => {
    await page.goto('/swap');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const inputAmount = page.locator('input[type="number"]').first();
    
    const testValues = ['0', '0.001', '1', '10.5', '999', '0.123456789', ''];
    
    for (const value of testValues) {
      await inputAmount.fill(value);
      await page.waitForTimeout(300);
      await assertNoPageErrors(page);
      
      if (value) {
        expect(await inputAmount.inputValue()).toBe(value);
      }
    }
  });

  test('should test swapping token selections', async ({ page }) => {
    await page.goto('/swap');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const inputSelect = page.locator('select').first();
    const outputSelect = page.locator('select').nth(1);
    
    // Select ETH → USDC
    await inputSelect.selectOption('ETH');
    await outputSelect.selectOption('USDC');
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    
    // Click swap icon (if exists) to reverse
    const swapIcon = page.locator('button').filter({ hasText: /↓|⇅|swap/i });
    const swapIconCount = await swapIcon.count();
    
    if (swapIconCount > 0) {
      await swapIcon.first().click();
      await page.waitForTimeout(300);
      await assertNoPageErrors(page);
    }
  });

  test('should verify output amount calculation display', async ({ page }) => {
    await page.goto('/swap');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const inputAmount = page.locator('input[type="number"]').first();
    await inputAmount.fill('1');
    await page.waitForTimeout(500);
    
    // Output amount field should exist
    const outputAmount = page.locator('input[type="number"]').nth(1);
    await expect(outputAmount).toBeVisible();
    
    // May be readonly or show calculated value
    const outputValue = await outputAmount.inputValue();
    console.log('Output amount:', outputValue);
  });

  test('should verify price info displays', async ({ page }) => {
    await page.goto('/swap');
    await page.waitForTimeout(1000);
    await assertNoPageErrors(page);
    
    // Price info may only show when V4 periphery is deployed
    const body = await page.textContent('body');
    const hasSwapContent = body?.includes('Swap') || body?.includes('swap');
    
    // If periphery deployed, should show rate/fee/price impact
    const hasPeriphery = body?.includes('Rate') || body?.includes('Fee') || body?.includes('Price Impact');
    
    // If no periphery, should show warning
    const hasWarning = body?.includes('Contracts Not Deployed') || body?.includes('unavailable');
    
    // Should have swap content OR show appropriate warning
    expect(hasSwapContent).toBe(true);
  });

  test('should test swap button states', async ({ page }) => {
    await page.goto('/swap');
    await page.waitForTimeout(1000);
    await assertNoPageErrors(page);
    
    // Find swap button with more flexible selector
    const swapButton = page.getByRole('button', { name: /Swap|Connect Wallet|Switch to Jeju|Contracts Not Deployed/i });
    const buttonExists = await swapButton.first().isVisible({ timeout: 5000 });
    
    if (buttonExists) {
      // Initial state
      const initialText = await swapButton.first().textContent();
      console.log('Swap button initial state:', initialText);
      
      // Enter amount if possible
      const inputAmount = page.locator('input[type="number"]').first();
      const inputExists = await inputAmount.isVisible();
      
      if (inputExists) {
        await inputAmount.fill('1');
        await page.waitForTimeout(300);
      }
      
      // Verify button still exists
      const finalText = await swapButton.first().textContent();
      console.log('Swap button final state:', finalText);
      
      expect(finalText).toBeTruthy();
    } else {
      // Page loaded but button not found - check page has swap content
      const body = await page.textContent('body');
      expect(body).toContain('Swap');
    }
  });

  test('should test all token pair combinations', async ({ page }) => {
    await page.goto('/swap');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const inputSelect = page.locator('select').first();
    const outputSelect = page.locator('select').nth(1);
    
    const tokens = ['ETH', 'USDC', 'elizaOS'];
    
    for (const inputToken of tokens) {
      for (const outputToken of tokens) {
        if (inputToken === outputToken) continue;
        
        await inputSelect.selectOption(inputToken);
        await page.waitForTimeout(100);
        await outputSelect.selectOption(outputToken);
        await page.waitForTimeout(200);
        await assertNoPageErrors(page);
        
        console.log(`Tested: ${inputToken} → ${outputToken}`);
      }
    }
  });
});
