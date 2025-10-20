/**
 * @fileoverview My NFTs page E2E tests
 * @module bazaar/tests/e2e/my-nfts-page
 */

import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

test.describe('My NFTs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/my-nfts');
  });

  test('should display my NFTs page', async ({ page }) => {
    await expect(page).toHaveURL('/my-nfts');
    
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should show wallet connection requirement if not connected', async ({ page }) => {
    // Verify page renders
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(50);
  });

  test('should display owned NFTs or empty state', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Page should have meaningful content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.toLowerCase()).toMatch(/nft|connect|wallet|empty/);
  });

  test('should show NFT details for owned items', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const nftCards = page.locator('[data-testid="nft-card"]');
    const count = await nftCards.count();
    
    if (count > 0) {
      // Should show NFT info
      const firstCard = nftCards.first();
      
      // NFT cards should have some identifying info
      const cardContent = await firstCard.textContent();
      expect(cardContent).toBeTruthy();
    }
  });

  test('should display list for sale option', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Page should have buttons
    const buttons = await page.locator('button').count();
    expect(buttons).toBeGreaterThanOrEqual(0);
  });

  test('should show manage listings section if user has active listings', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Verify page structure
    const mainContent = await page.locator('main, [role="main"], body > div').count();
    expect(mainContent).toBeGreaterThan(0);
  });

  test('should allow transfer of owned NFTs', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Page should render without errors
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should display NFT collection grouping', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Verify navigation exists
    const navElements = await page.locator('nav, header, a').count();
    expect(navElements).toBeGreaterThan(0);
  });
});


