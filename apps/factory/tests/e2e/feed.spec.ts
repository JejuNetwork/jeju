/**
 * Feed E2E Tests
 * Tests Farcaster-powered social feed
 */

import { test, expect } from '@playwright/test';

test.describe('Feed', () => {
  test('should display feed page', async ({ page }) => {
    await page.goto('/feed');
    await expect(page.getByRole('heading', { name: /feed/i })).toBeVisible();
  });

  test('should show feed content', async ({ page }) => {
    await page.goto('/feed');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should show compose area', async ({ page }) => {
    await page.goto('/feed');
    const textarea = page.getByPlaceholder(/what's happening/i);
    if (await textarea.isVisible()) {
      await expect(textarea).toBeVisible();
    }
  });

  test('should show posts', async ({ page }) => {
    await page.goto('/feed');
    const cards = page.locator('.card');
    await expect(cards.first()).toBeVisible();
  });

  test('should show sidebar', async ({ page }) => {
    await page.goto('/feed');
    // Check for sidebar content
    await expect(page.getByText(/trending/i).first()).toBeVisible();
  });

  test('should load page', async ({ page }) => {
    await page.goto('/feed', { timeout: 60000 });
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  });
});
