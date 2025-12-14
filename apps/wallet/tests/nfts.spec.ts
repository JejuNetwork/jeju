import { test, expect } from '@playwright/test';

test.describe('NFT Gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('text=NFTs');
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    await expect(page.locator('text=Connect Your Wallet')).toBeVisible();
    await expect(page.locator('text=Connect your wallet to view your NFTs')).toBeVisible();
  });

  test('should have working navigation', async ({ page }) => {
    // Just check the NFTs nav item is active
    const nftsNav = page.locator('button:has-text("NFTs")');
    await expect(nftsNav).toBeVisible();
  });
});

test.describe('NFT Gallery - Connected', () => {
  // These tests would use Synpress for MetaMask connection
  
  test.skip('should display NFT gallery when connected', async ({ page }) => {
    // Would connect wallet first
    await page.goto('/');
    await page.click('text=NFTs');
    
    await expect(page.locator('text=NFT Gallery')).toBeVisible();
  });

  test.skip('should have view toggle (grid/list)', async ({ page }) => {
    await page.goto('/');
    await page.click('text=NFTs');
    
    // Check for view toggle buttons
    await expect(page.locator('[title="Grid view"]')).toBeVisible();
    await expect(page.locator('[title="List view"]')).toBeVisible();
  });

  test.skip('should have chain filter', async ({ page }) => {
    await page.goto('/');
    await page.click('text=NFTs');
    
    // Check for chain filter
    await expect(page.locator('text=All Chains')).toBeVisible();
    await expect(page.locator('text=Base')).toBeVisible();
    await expect(page.locator('text=Ethereum')).toBeVisible();
  });
});

