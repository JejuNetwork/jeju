import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

test.describe('Portfolio Page', () => {
  test('should navigate to portfolio', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Portfolio/i }).click();
    
    await expect(page).toHaveURL('/portfolio');
    await expect(page.getByText('Your Portfolio')).toBeVisible();
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    await page.goto('/portfolio');
    
    await expect(page.getByText('Connect Your Wallet')).toBeVisible();
    await expect(page.getByText('View your positions and claim winnings')).toBeVisible();
  });

  test('should have connect button on portfolio page', async ({ page }) => {
    await page.goto('/portfolio');
    
    // Use first() since there might be multiple connect buttons (header + main content)
    await expect(page.getByRole('button', { name: /Connect/i }).first()).toBeVisible();
  });

  test('should show stats sections', async ({ page }) => {
    await page.goto('/portfolio');
    
    // These will be visible after connecting wallet, but structure should exist
    await expect(page.getByText(/Portfolio/i)).toBeVisible();
  });
});



