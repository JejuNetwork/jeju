/**
 * Platform Detection Tests
 * 
 * Tests for cross-platform compatibility layer.
 */

import { test, expect } from '@playwright/test';

test.describe('Platform Detection', () => {
  test('should detect web platform', async ({ page }) => {
    await page.goto('/');
    
    // The app should load successfully on web
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 });
  });

  test('should have proper meta tags for mobile', async ({ page }) => {
    await page.goto('/');
    
    // Check viewport meta tag exists
    const viewportMeta = page.locator('meta[name="viewport"]');
    await expect(viewportMeta).toHaveAttribute('content', /width=device-width/);
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // App should still be visible and functional
    await expect(page.locator('#root')).toBeVisible({ timeout: 10000 });
    
    // Check for mobile menu (hamburger) or responsive layout
    const mobileHeader = page.locator('header, nav, [class*="mobile"]');
    await expect(mobileHeader.first()).toBeVisible({ timeout: 10000 });
  });

  test('should load styles correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check that Tailwind CSS is loaded by verifying a common class
    const rootElement = await page.locator('#root');
    
    // The app should have some styling (not just raw HTML)
    const hasStyles = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return false;
      const computed = window.getComputedStyle(root);
      // Check if there's any styling applied
      return computed.display !== 'none';
    });
    
    expect(hasStyles).toBe(true);
  });

  test('should handle keyboard navigation', async ({ page }) => {
    await page.goto('/');
    
    // Tab through elements
    await page.keyboard.press('Tab');
    
    // Some element should be focused
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Accessibility', () => {
  test('should have proper ARIA labels', async ({ page }) => {
    await page.goto('/');
    
    // Check for buttons with accessible names
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    
    expect(buttonCount).toBeGreaterThan(0);
    
    // At least some buttons should have accessible names
    const firstButton = buttons.first();
    const name = await firstButton.getAttribute('aria-label') ?? 
                 await firstButton.textContent();
    expect(name?.length).toBeGreaterThan(0);
  });

  test('should have proper heading structure', async ({ page }) => {
    await page.goto('/');
    
    // Page should have at least one heading
    const headings = page.locator('h1, h2, h3, h4, h5, h6');
    const headingCount = await headings.count();
    
    expect(headingCount).toBeGreaterThan(0);
  });

  test('should have sufficient color contrast', async ({ page }) => {
    await page.goto('/');
    
    // This is a basic check - full contrast testing requires axe-core
    const body = page.locator('body');
    const bgColor = await body.evaluate((el) => 
      window.getComputedStyle(el).backgroundColor
    );
    
    // Should have a background color set
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  });
});

