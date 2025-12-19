/**
 * Agents E2E Tests
 * Tests Crucible agent interactions
 */

import { test, expect } from '@playwright/test';

test.describe('Agents', () => {
  test('should display agents page', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: /agent/i })).toBeVisible();
  });

  test('should show agent content', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should show filter buttons', async ({ page }) => {
    await page.goto('/agents');
    const buttons = page.getByRole('button');
    await expect(buttons.first()).toBeVisible();
  });

  test('should show agent cards', async ({ page }) => {
    await page.goto('/agents');
    const cards = page.locator('.card');
    await expect(cards.first()).toBeVisible();
  });

  test('should show interactive buttons', async ({ page }) => {
    await page.goto('/agents');
    const buttons = page.getByRole('button');
    await expect(buttons.first()).toBeVisible();
  });

  test('should show action buttons', async ({ page }) => {
    await page.goto('/agents');
    const buttons = page.getByRole('button');
    await expect(buttons.first()).toBeVisible();
  });
});
