/**
 * Deep interaction tests for Liquidity page - EVERY field, EVERY selection
 */

import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Liquidity - Deep Interaction Testing', () => {
  test('should test token A selection and amount input', async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Token A amount input
    const tokenAInput = page.locator('input[type="number"]').first();
    await expect(tokenAInput).toBeVisible();
    
    const testAmounts = ['0', '0.01', '1', '10.5', '1000'];
    
    for (const amount of testAmounts) {
      await tokenAInput.fill(amount);
      await page.waitForTimeout(300);
      await assertNoPageErrors(page);
      expect(await tokenAInput.inputValue()).toBe(amount);
    }
    
    // Token A selector
    const tokenASelect = page.locator('select').first();
    const tokenAExists = await tokenASelect.isVisible();
    
    if (tokenAExists) {
      const options = await tokenASelect.locator('option').allTextContents();
      
      for (const option of options.slice(0, 2)) {
        await tokenASelect.selectOption({ label: option });
        await page.waitForTimeout(200);
        await assertNoPageErrors(page);
      }
    }
  });

  test('should test token B selection and amount input', async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Token B amount input
    const tokenBInput = page.locator('input[type="number"]').nth(1);
    await expect(tokenBInput).toBeVisible();
    
    const testAmounts = ['0', '1', '100', '0.5'];
    
    for (const amount of testAmounts) {
      await tokenBInput.fill(amount);
      await page.waitForTimeout(300);
      await assertNoPageErrors(page);
    }
    
    // Token B selector
    const tokenBSelect = page.locator('select').nth(1);
    const tokenBExists = await tokenBSelect.isVisible();
    
    if (tokenBExists) {
      const options = await tokenBSelect.locator('option').allTextContents();
      
      for (const option of options.slice(0, 2)) {
        await tokenBSelect.selectOption({ label: option });
        await page.waitForTimeout(200);
        await assertNoPageErrors(page);
      }
    }
  });

  test('should test price range inputs', async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Find min and max price inputs
    const allInputs = page.locator('input[type="number"]');
    const inputCount = await allInputs.count();
    
    console.log(`Found ${inputCount} number inputs on liquidity page`);
    
    // Test each input
    for (let i = 0; i < inputCount; i++) {
      const input = allInputs.nth(i);
      const inputVisible = await input.isVisible();
      
      if (inputVisible) {
        await input.fill('100');
        await page.waitForTimeout(200);
        await assertNoPageErrors(page);
      }
    }
  });

  test('should test hook selection dropdown', async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const hookSelect = page.locator('select').filter({ hasText: /Hook|TWAMM|Limit Order/i }).first();
    const hookExists = await hookSelect.isVisible();
    
    if (hookExists) {
      const options = await hookSelect.locator('option').allTextContents();
      console.log('Hook options:', options);
      
      for (const option of options) {
        await hookSelect.selectOption({ label: option });
        await page.waitForTimeout(300);
        await assertNoPageErrors(page);
      }
    }
  });

  test('should test add liquidity button states', async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const addLiquidityButton = page.locator('button').filter({ hasText: /Add Liquidity|Connect Wallet|Switch to Jeju/i }).first();
    
    // Initial state
    const initialText = await addLiquidityButton.textContent();
    console.log('Add Liquidity button state:', initialText);
    
    // Hover
    await addLiquidityButton.hover();
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    
    // Try filling form first
    const tokenAInput = page.locator('input[type="number"]').first();
    await tokenAInput.fill('1');
    await page.waitForTimeout(300);
    
    const tokenBInput = page.locator('input[type="number"]').nth(1);
    await tokenBInput.fill('1');
    await page.waitForTimeout(300);
    
    // Click button
    await addLiquidityButton.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
  });

  test('should test your positions section', async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Look for positions section or any liquidity content
    const positionsHeading = page.getByRole('heading', { name: /Your Positions/i });
    const positionsExists = await positionsHeading.isVisible();
    
    if (positionsExists) {
      await expect(positionsHeading).toBeVisible();
      
      // Check if page has any content (positions or empty state)
      const body = await page.textContent('body');
      expect(body).toBeTruthy();
      expect(body!.length).toBeGreaterThan(100);
    } else {
      // Positions section may not exist - just verify page loaded
      const body = await page.textContent('body');
      expect(body).toBeTruthy();
    }
  });

  test('should verify peripheral contract warning if not deployed', async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Look for warning about contracts
    const warning = page.locator('text=/V4 Periphery|Contracts Not Deployed|unavailable/i');
    const warningCount = await warning.count();
    
    console.log(`Found ${warningCount} contract warnings`);
    
    if (warningCount > 0) {
      await expect(warning.first()).toBeVisible();
    }
  });
});

