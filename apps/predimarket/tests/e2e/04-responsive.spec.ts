import { test, expect } from '@playwright/test';

test.describe('Responsive Design', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto('/');
    
    await expect(page.getByText('Predimarket')).toBeVisible();
    await expect(page.getByRole('button', { name: /Connect/i })).toBeVisible();
  });

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto('/');
    
    await expect(page.getByText('Decentralized Prediction Markets')).toBeVisible();
  });

  test('should work on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    
    await expect(page.getByRole('link', { name: /Portfolio/i })).toBeVisible();
  });
});



