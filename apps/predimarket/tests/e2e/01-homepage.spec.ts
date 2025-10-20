import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

test.describe('Predimarket Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the homepage', async ({ page }) => {
    await expect(page.getByText('Predimarket')).toBeVisible();
    await expect(page.getByText('Decentralized Prediction Markets')).toBeVisible();
  });

  test('should show total volume stat', async ({ page }) => {
    await expect(page.getByText('Total Volume')).toBeVisible();
  });

  test('should show active markets count', async ({ page }) => {
    await expect(page.getByText('Active Markets')).toBeVisible();
  });

  test('should show total markets count', async ({ page }) => {
    await expect(page.getByText('Total Markets')).toBeVisible();
  });

  test('should have navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Markets/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Portfolio/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Leaderboard/i })).toBeVisible();
  });

  test('should have wallet connect button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Connect/i })).toBeVisible();
  });
});



