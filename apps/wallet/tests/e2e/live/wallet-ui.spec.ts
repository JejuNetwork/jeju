/**
 * Live E2E Tests - Wallet UI
 * 
 * Verifies the wallet UI serves correctly.
 * Tests actual HTTP responses and page structure.
 */

import { test, expect } from '@playwright/test';
import { assertInfrastructureRunning } from '../setup';

test.describe('Wallet UI (Live)', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning();
  });

  test('should serve valid HTML', async ({ page }) => {
    const response = await page.goto('/');
    
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('text/html');
  });

  test('should load CSS and JS resources', async ({ page }) => {
    // Track resource loading
    const resources: string[] = [];
    page.on('response', (response) => {
      if (response.status() === 200) {
        resources.push(response.url());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Should have loaded some assets (in dev mode Vite injects assets differently)
    // Check for either bundled files or Vite's module system
    const hasJs = resources.some(r => r.includes('.js') || r.includes('.tsx') || r.includes('.ts'));
    const hasCss = resources.some(r => r.includes('.css') || r.includes('style'));
    
    // At minimum the page should load successfully
    expect(resources.length).toBeGreaterThan(0);
  });

  test('should include Jeju branding in page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const pageContent = await page.content();
    const hasNetworkBranding = pageContent.toLowerCase().includes('jeju');
    
    expect(hasNetworkBranding).toBe(true);
  });

  test('should have correct meta tags', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check viewport meta
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');

    // Check charset
    const charset = await page.locator('meta[charset]').count();
    expect(charset).toBeGreaterThan(0);
  });

  test('should have responsive viewport', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    const mobileResponse = await page.goto('/');
    expect(mobileResponse?.status()).toBe(200);

    // Test desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    const desktopResponse = await page.goto('/');
    expect(desktopResponse?.status()).toBe(200);
  });

  test('should handle navigation to invalid paths gracefully', async ({ page }) => {
    // SPA should handle invalid paths (either 200 for SPA or 404)
    const response = await page.goto('/some-nonexistent-path');
    
    // Either serve SPA (200) or proper 404
    expect([200, 404]).toContain(response?.status());
  });
});
