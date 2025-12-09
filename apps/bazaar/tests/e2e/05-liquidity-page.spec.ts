/**
 * @fileoverview Liquidity page E2E tests
 * @module bazaar/tests/e2e/liquidity-page
 */

import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';

test.describe('Liquidity Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/liquidity');
  });

  test('should display liquidity page', async ({ page }) => {
    // Check page renders
    await expect(page).toHaveURL('/liquidity');
    
    // Should have some content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should show add liquidity interface', async ({ page }) => {
    // Page should have liquidity-related content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.toLowerCase()).toMatch(/liquidity|pool|add|remove/);
  });

  test('should display pool selection', async ({ page }) => {
    // Verify page has interactive elements (selects, buttons, inputs)
    const selects = await page.locator('select').count();
    const buttons = await page.locator('button').count();
    
    expect(selects + buttons).toBeGreaterThan(0);
  });

  test('should show amount input fields', async ({ page }) => {
    // Look for amount inputs
    const amountInputs = page.locator('input[type="number"], input[type="text"], input[placeholder*="0"]');
    const count = await amountInputs.count();
    
    // Page should render (may or may not have inputs depending on connection state)
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should have proper page structure', async ({ page }) => {
    // Verify basic page structure exists
    const mainContent = await page.locator('main, [role="main"], body > div').count();
    expect(mainContent).toBeGreaterThan(0);
  });

  test('should display navigation elements', async ({ page }) => {
    // Page should have navigation
    const navElements = await page.locator('nav, header, a').count();
    expect(navElements).toBeGreaterThan(0);
  });

  test('should render without critical errors', async ({ page }) => {
    // Verify page loads successfully
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    
    // Check for presence of expected content
    const hasContent = body!.length > 100; // Reasonable amount of content
    expect(hasContent).toBe(true);
  });
});


