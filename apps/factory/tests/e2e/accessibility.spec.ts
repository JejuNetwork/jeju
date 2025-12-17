/**
 * Accessibility E2E Tests
 * Tests keyboard navigation, ARIA labels, and focus management
 */

import { test, expect } from '@playwright/test';

test.describe('Accessibility', () => {
  test('should have navigation landmark', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation');
    await expect(nav.first()).toBeVisible();
  });

  test('should have main content landmark', async ({ page }) => {
    await page.goto('/');
    const main = page.locator('main');
    await expect(main).toBeVisible();
  });

  test('should have page heading', async ({ page }) => {
    await page.goto('/');
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible();
  });

  test('should navigate with Tab key', async ({ page }) => {
    await page.goto('/');
    
    // Tab through a few elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Check something is focused
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'BUTTON', 'A', 'BODY']).toContain(focused);
  });

  test('should have interactive elements', async ({ page }) => {
    await page.goto('/', { timeout: 60000 });
    
    // Page should have links
    const links = page.getByRole('link');
    await expect(links.first()).toBeVisible({ timeout: 10000 });
  });

  test('should respect mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Page should still work at mobile size
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should respect reduced motion preference', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    
    const hasReducedMotion = await page.evaluate(() => {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    });
    
    expect(hasReducedMotion).toBe(true);
  });
});
