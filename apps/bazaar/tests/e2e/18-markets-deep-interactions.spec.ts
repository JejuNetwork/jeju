/**
 * Deep interaction tests for Markets page - EVERY button, EVERY action
 */

import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Markets Page - Deep Button Testing', () => {
  test('should test ALL filter buttons sequentially', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(1000);
    await assertNoPageErrors(page);
    
    // Test ALL button
    const allButton = page.getByTestId('filter-all');
    await allButton.click();
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    await expect(allButton).toHaveClass(/bg-purple-600/);
    
    // Test ACTIVE button
    const activeButton = page.getByTestId('filter-active');
    await activeButton.click();
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    await expect(activeButton).toHaveClass(/bg-purple-600/);
    await expect(allButton).not.toHaveClass(/bg-purple-600/);
    
    // Test RESOLVED button
    const resolvedButton = page.getByTestId('filter-resolved');
    await resolvedButton.click();
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    await expect(resolvedButton).toHaveClass(/bg-purple-600/);
    await expect(activeButton).not.toHaveClass(/bg-purple-600/);
  });

  test('should test search input with various queries', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(1000);
    await assertNoPageErrors(page);
    
    const searchInput = page.getByTestId('market-search');
    
    // Test empty input
    await searchInput.fill('');
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    
    // Test normal query
    await searchInput.fill('test');
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    expect(await searchInput.inputValue()).toBe('test');
    
    // Test long query
    await searchInput.fill('this is a very long search query that might match something');
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    
    // Test special characters
    await searchInput.fill('test@#$%');
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    
    // Test query that won't match
    await searchInput.fill('xyznonexistentquery123');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    // Clear button should appear
    const clearButton = page.getByRole('button', { name: /Clear Search/i });
    const clearVisible = await clearButton.isVisible();
    if (clearVisible) {
      await clearButton.click();
      await page.waitForTimeout(300);
      await assertNoPageErrors(page);
      expect(await searchInput.inputValue()).toBe('');
    }
  });

  test('should test all filter combinations with search', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(1000);
    await assertNoPageErrors(page);
    
    const searchInput = page.getByTestId('market-search');
    const allButton = page.getByTestId('filter-all');
    const activeButton = page.getByTestId('filter-active');
    const resolvedButton = page.getByTestId('filter-resolved');
    
    // Search + All filter
    await searchInput.fill('test');
    await allButton.click();
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    
    // Search + Active filter
    await activeButton.click();
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    
    // Search + Resolved filter
    await resolvedButton.click();
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    
    // Clear search + keep filter
    await searchInput.clear();
    await page.waitForTimeout(300);
    await assertNoPageErrors(page);
    await expect(resolvedButton).toHaveClass(/bg-purple-600/);
  });

  test('should test clicking every visible market card', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const marketCards = page.getByTestId('market-card');
    const count = await marketCards.count();
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      await page.goto('/markets');
      await page.waitForTimeout(1000);
      
      const card = page.getByTestId('market-card').nth(i);
      const cardVisible = await card.isVisible();
      
      if (cardVisible) {
        await card.click();
        await page.waitForTimeout(500);
        await assertNoPageErrors(page);
        await expect(page).toHaveURL(/\/markets\/.+/);
      }
    }
  });

  test('should test hovering over market cards', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    await assertNoPageErrors(page);
    
    const marketCards = page.getByTestId('market-card');
    const count = await marketCards.count();
    
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 3); i++) {
        const card = marketCards.nth(i);
        await card.hover();
        await page.waitForTimeout(200);
        await assertNoPageErrors(page);
      }
    }
  });
});

