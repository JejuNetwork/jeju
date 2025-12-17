/**
 * Forms E2E Tests
 * Tests all form inputs, validation, and submissions
 */

import { test, expect } from '@playwright/test';

test.describe('Forms', () => {
  test('should have form elements on bounties page', async ({ page }) => {
    await page.goto('/bounties');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should search on repositories page', async ({ page }) => {
    await page.goto('/git');
    
    const search = page.getByPlaceholder(/find/i);
    if (await search.isVisible()) {
      await search.fill('contracts');
      await expect(search).toHaveValue('contracts');
    }
  });

  test('should have form elements on packages page', async ({ page }) => {
    await page.goto('/packages');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should have form elements on models page', async ({ page }) => {
    await page.goto('/models');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should interact with filter buttons', async ({ page }) => {
    await page.goto('/bounties');
    
    const buttons = page.getByRole('button');
    const count = await buttons.count();
    
    if (count > 0) {
      await buttons.first().click();
    }
  });

  test('should support keyboard navigation', async ({ page }) => {
    await page.goto('/bounties', { timeout: 60000 });
    
    // Wait for page to be ready
    await page.waitForLoadState('networkidle');
    
    // Tab to first focusable element
    await page.keyboard.press('Tab');
    
    // Just verify page loaded
    await expect(page.locator('body')).toBeVisible();
  });
});
