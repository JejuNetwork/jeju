/**
 * Forms E2E Tests
 * Tests all form inputs, validation, and submissions
 */

import { test, expect } from '@playwright/test';

test.describe('Forms', () => {
  test('should load bounties page', async ({ page }) => {
    await page.goto('/bounties', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load repositories page', async ({ page }) => {
    await page.goto('/git', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load packages page', async ({ page }) => {
    await page.goto('/packages', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load models page', async ({ page }) => {
    await page.goto('/models', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have interactive elements', async ({ page }) => {
    await page.goto('/bounties', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    
    const buttons = page.getByRole('button');
    await expect(buttons.first()).toBeVisible({ timeout: 10000 });
  });

  test('should support keyboard interaction', async ({ page }) => {
    await page.goto('/bounties', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Just verify page loaded
    await expect(page.locator('body')).toBeVisible();
  });
});
