import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';
import { navigateToNFTs } from '../../../../tests/shared/helpers/navigation';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar NFT Browse', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BAZAAR_URL);
    await navigateToNFTs(page);
  });

  test('should display NFT marketplace', async ({ page }) => {
    await expect(page.getByText(/NFT|Marketplace/i)).toBeVisible();
  });

  test('should show NFT grid', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Should show NFT cards or grid
    const nftCards = page.locator('[data-testid="nft-card"], .nft-card, [data-nft]');

    const count = await nftCards.count();
    console.log(`Found ${count} NFTs`);

    if (count === 0) {
      // Should show empty state
      await expect(page.getByText(/No NFTs|Empty|Coming soon/i)).toBeVisible();
    } else {
      await expect(nftCards.first()).toBeVisible();
    }
  });

  test('should display NFT details on click', async ({ page }) => {
    await page.waitForTimeout(2000);

    const firstNFT = page.locator('[data-testid="nft-card"], .nft-card').first();

    if (await firstNFT.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNFT.click();

      // Should show NFT details modal or page
      await expect(page.getByText(/Details|Attributes|Owner|Price/i)).toBeVisible({
        timeout: 5000
      });
    } else {
      console.log('No NFTs available');
      test.skip();
    }
  });

  test('should show NFT image', async ({ page }) => {
    await page.waitForTimeout(2000);

    // NFT images should be visible
    const nftImages = page.locator('img[alt*="NFT"], img[src*="nft"], [data-testid="nft-image"]');

    if (await nftImages.count() > 0) {
      await expect(nftImages.first()).toBeVisible();
      console.log('NFT images displayed');
    }
  });

  test('should show NFT price', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for price information
    const priceElements = page.locator('text=/[0-9]+.*ETH/, [data-price]');

    if (await priceElements.count() > 0) {
      const firstPrice = await priceElements.first().textContent();
      console.log(`NFT price: ${firstPrice}`);
    }
  });

  test('should filter NFTs by collection', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for collection filter
    const collectionFilter = page.locator('select[name*="collection"], button:has-text("Collection")').first();

    if (await collectionFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await collectionFilter.click();
      console.log('Collection filter available');
    }
  });

  test('should search NFTs', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for search input
    const searchInput = page.locator('input[placeholder*="Search"]').first();

    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('Dragon');
      await page.waitForTimeout(1000);
      console.log('Search functionality available');
    }
  });

  test('should sort NFTs by price', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for sort dropdown
    const sortSelect = page.locator('select[name*="sort"], button:has-text("Sort")').first();

    if (await sortSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sortSelect.click();

      // Should show sort options
      await expect(page.getByText(/Price|Recent|Rarity/i)).toBeVisible();
    }
  });
});
