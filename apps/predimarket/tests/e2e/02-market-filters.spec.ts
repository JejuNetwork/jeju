import { test, expect } from '@playwright/test';

test.describe('Market Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have filter buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'All Markets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Active' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resolved' })).toBeVisible();
  });

  test('should filter to active markets', async ({ page }) => {
    await page.getByRole('button', { name: 'Active' }).click();
    
    // Active button should be highlighted
    await expect(page.getByRole('button', { name: 'Active' })).toHaveClass(/bg-green-600/);
  });

  test('should filter to resolved markets', async ({ page }) => {
    await page.getByRole('button', { name: 'Resolved' }).click();
    
    await expect(page.getByRole('button', { name: 'Resolved' })).toHaveClass(/bg-green-600/);
  });

  test('should switch between filters', async ({ page }) => {
    await page.getByRole('button', { name: 'Active' }).click();
    await page.getByRole('button', { name: 'Resolved' }).click();
    await page.getByRole('button', { name: 'All Markets' }).click();
    
    await expect(page.getByRole('button', { name: 'All Markets' })).toHaveClass(/bg-green-600/);
  });
});



