/**
 * Deep tests for Header component - EVERY link, EVERY button
 */

import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Header Navigation - Complete Coverage', () => {
  test('should click EVERY navigation link and verify pages load', async ({ page }) => {
    const navLinks = [
      { name: 'Home', url: '/', heading: /Welcome to Bazaar/i },
      { name: 'Coins', url: '/coins', heading: /Coins/i },
      { name: 'Swap', url: '/swap', heading: /Swap/i },
      { name: 'Pools', url: '/pools', heading: /Pools/i },
      { name: 'Markets', url: '/markets', heading: /Markets/i },
      { name: 'Items', url: '/items', heading: /Items/i },
    ];
    
    for (const { name, url, heading } of navLinks) {
      await page.goto('/');
      await page.waitForTimeout(300);
      
      const link = page.getByRole('link', { name: new RegExp(`^${name}$`, 'i') });
      await link.first().click();
      await page.waitForTimeout(500);
      await assertNoPageErrors(page);
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    }
  });

  test('should test Connect Wallet button interactions', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const connectButton = page.getByRole('button', { name: /Connect Wallet/i });
    
    // Hover
    await connectButton.hover();
    await page.waitForTimeout(200);
    await assertNoPageErrors(page);
    
    // Click (will show MetaMask popup or error, shouldn't crash)
    await connectButton.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
  });

  test('should test logo click returns to home from all pages', async ({ page }) => {
    const pages = ['/coins', '/swap', '/markets', '/portfolio', '/items'];
    
    for (const pagePath of pages) {
      await page.goto(pagePath);
      await page.waitForTimeout(500);
      await assertNoPageErrors(page);
      
      const logo = page.getByRole('link', { name: /Bazaar/i }).first();
      await logo.click();
      await page.waitForTimeout(500);
      await assertNoPageErrors(page);
      await expect(page).toHaveURL('/');
    }
  });

  test('should test all header interactions from different pages', async ({ page }) => {
    const pages = ['/', '/coins', '/markets', '/portfolio'];
    
    for (const pagePath of pages) {
      await page.goto(pagePath);
      await page.waitForTimeout(500);
      await assertNoPageErrors(page);
      
      // Test that all nav links are visible
      const homeLink = page.getByRole('link', { name: /^Home$/i });
      const tokensLink = page.getByRole('link', { name: /^Coins$/i });
      const marketsLink = page.getByRole('link', { name: /^Markets$/i });
      
      await expect(homeLink).toBeVisible();
      await expect(tokensLink).toBeVisible();
      await expect(marketsLink).toBeVisible();
    }
  });
});

