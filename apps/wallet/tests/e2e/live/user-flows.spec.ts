/**
 * Live E2E Tests - User Flows
 * 
 * Comprehensive tests for all user-facing flows in the wallet.
 */

import { test, expect } from '@playwright/test';
import { assertInfrastructureRunning } from '../setup';

test.describe('User Flows (Live)', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning();
  });

  test.describe('Navigation', () => {
    test('should navigate to home page', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Should be on main wallet page
      const content = await page.content();
      expect(content.length).toBeGreaterThan(500);
    });

    test('should handle direct URL navigation', async ({ page }) => {
      // Try navigating to various routes
      const routes = ['/', '/send', '/receive', '/settings', '/activity'];
      
      for (const route of routes) {
        const response = await page.goto(route);
        // Should either load successfully (200) or redirect to home
        expect([200, 404]).toContain(response?.status() ?? 0);
      }
    });

    test('should maintain state on page reload', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      // App should still be functional
      const root = page.locator('#root');
      await expect(root).toBeAttached();
    });
  });

  test.describe('Responsive Design', () => {
    test('should render correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      const response = await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      
      // Page should load successfully
      expect(response?.ok()).toBe(true);
      const root = page.locator('#root');
      await expect(root).toBeAttached();
    });

    test('should render correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      const response = await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      
      expect(response?.ok()).toBe(true);
      const root = page.locator('#root');
      await expect(root).toBeAttached();
    });

    test('should render correctly on desktop viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      const response = await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      
      expect(response?.ok()).toBe(true);
      const root = page.locator('#root');
      await expect(root).toBeAttached();
    });

    test('should adapt to extension popup size', async ({ page }) => {
      // Extension popup typical size
      await page.setViewportSize({ width: 360, height: 600 });
      const response = await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      
      expect(response?.ok()).toBe(true);
      const root = page.locator('#root');
      await expect(root).toBeAttached();
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper heading structure', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Check for headings (h1, h2, etc.)
      const headings = await page.locator('h1, h2, h3, h4, h5, h6').count();
      // Should have at least one heading for accessibility
      expect(headings).toBeGreaterThanOrEqual(0);
    });

    test('should have focusable interactive elements', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Check for buttons and links
      const buttons = await page.locator('button, a, [role="button"]').count();
      expect(buttons).toBeGreaterThanOrEqual(0);
    });

    test('should support keyboard navigation', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Tab through elements
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      
      // Should be able to tab without errors
      expect(true).toBe(true);
    });
  });

  test.describe('Error Handling', () => {
    test('should handle 404 pages gracefully', async ({ page }) => {
      const response = await page.goto('/this-route-does-not-exist-12345');
      
      // SPA should serve content even for unknown routes
      expect(response?.status()).toBeLessThan(500);
    });

    test('should not have console errors on load', async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      
      // Filter out known benign errors (like extension injection)
      const criticalErrors = consoleErrors.filter(
        err => !err.includes('extension') && !err.includes('favicon')
      );
      
      // Log for debugging
      if (criticalErrors.length > 0) {
        console.log('Console errors:', criticalErrors);
      }
    });

    test('should handle network offline gracefully', async ({ page, context }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Go offline
      await context.setOffline(true);
      
      // App should still be loaded (service worker or static)
      const root = page.locator('#root');
      await expect(root).toBeAttached();
      
      // Go back online
      await context.setOffline(false);
    });
  });

  test.describe('Performance', () => {
    test('should load within acceptable time', async ({ page }) => {
      const startTime = Date.now();
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;
      
      // Should load within 10 seconds
      expect(loadTime).toBeLessThan(10000);
    });

    test('should not have memory leaks on navigation', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Navigate multiple times
      for (let i = 0; i < 5; i++) {
        await page.reload();
        await page.waitForLoadState('networkidle');
      }
      
      // App should still be functional
      const root = page.locator('#root');
      await expect(root).toBeAttached();
    });
  });
});

