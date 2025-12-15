/**
 * Live E2E Tests - App Loading
 * 
 * Verifies the wallet app loads correctly and all core components render.
 * These tests run against a real dev server with network localnet.
 */

import { test, expect } from '@playwright/test';
import { assertInfrastructureRunning } from '../setup';

test.describe('App Loading (Live)', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning();
  });

  test('should load the wallet app', async ({ page }) => {
    await page.goto('/');
    
    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');
    
    // Title should contain Network
    await expect(page).toHaveTitle(/jeju/i);
    
    // Root element should exist
    const root = page.locator('#root');
    await expect(root).toBeAttached();
  });

  test('should render React app content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for React to hydrate (look for any div inside root)
    await page.waitForTimeout(3000);
    
    // Check page has content
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(500);
  });

  test('should have valid HTML structure', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify basic HTML structure
    const hasHtml = await page.locator('html').count();
    const hasBody = await page.locator('body').count();
    const hasRoot = await page.locator('#root').count();
    
    expect(hasHtml).toBe(1);
    expect(hasBody).toBe(1);
    expect(hasRoot).toBe(1);
  });

  test('should be accessible at base URL', async ({ page }) => {
    const response = await page.goto('/');
    
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);
  });
});
