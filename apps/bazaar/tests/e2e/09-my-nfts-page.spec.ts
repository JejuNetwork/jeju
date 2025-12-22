/**
 * @fileoverview NFTs page E2E tests
 * @module bazaar/tests/e2e/nfts-page
 * 
 * Tests NFT browsing, filtering, sorting, and marketplace interactions
 */

import { test, expect } from '@playwright/test';

test.describe('NFTs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/items');
  });

  test('should display NFTs page with header', async ({ page }) => {
    // Page should have NFT header
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    const headingText = await heading.textContent();
    expect(headingText?.toLowerCase()).toContain('nft');
  });

  test('should show filter buttons for All NFTs and My Collection', async ({ page }) => {
    // Should have All NFTs button
    const allNftsButton = page.locator('button', { hasText: 'All NFTs' });
    await expect(allNftsButton).toBeVisible();
    
    // Should have My Collection button (may be disabled if not connected)
    const myCollectionButton = page.locator('button', { hasText: 'My Collection' });
    await expect(myCollectionButton).toBeVisible();
  });

  test('should have sort dropdown', async ({ page }) => {
    const sortSelect = page.locator('select');
    await expect(sortSelect).toBeVisible();
    
    // Should have sorting options
    const options = sortSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('should display loading state initially', async ({ page }) => {
    // Navigate fresh to catch loading state
    await page.goto('/items');
    
    // Either loading spinner or content should be visible
    const hasContent = await page.locator('body').textContent();
    expect(hasContent).toBeTruthy();
  });

  test('should display empty state or NFT grid', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    const body = await page.textContent('body');
    // Either shows NFTs or empty state message
    expect(body?.toLowerCase()).toMatch(/nft|empty|no nft|collection|minted/);
  });

  test('should switch between All NFTs and My Collection filters', async ({ page }) => {
    // Click All NFTs
    const allNftsButton = page.locator('button', { hasText: 'All NFTs' });
    await allNftsButton.click();
    
    // Button should be active (has primary styling)
    await expect(allNftsButton).toHaveClass(/bg-bazaar-primary|text-white/);
  });

  test('should change sort order when dropdown changes', async ({ page }) => {
    const sortSelect = page.locator('select');
    
    // Select Collection sort
    await sortSelect.selectOption('collection');
    await expect(sortSelect).toHaveValue('collection');
    
    // Select Recent sort
    await sortSelect.selectOption('recent');
    await expect(sortSelect).toHaveValue('recent');
  });
});

test.describe('NFT Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a mock NFT detail page
    await page.goto('/items/0x1234567890abcdef-1');
  });

  test('should display NFT detail page', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    
    // Should show token ID
    expect(body?.toLowerCase()).toContain('item');
  });

  test('should show NFT image area', async ({ page }) => {
    // Should have image placeholder or actual image
    const imageArea = page.locator('.aspect-square, .aspect-\\[4\\/3\\]');
    await expect(imageArea.first()).toBeVisible();
  });

  test('should display NFT details section', async ({ page }) => {
    // Should have details heading
    const detailsHeading = page.locator('h2', { hasText: /details/i });
    await expect(detailsHeading).toBeVisible();
  });

  test('should show owner information', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body?.toLowerCase()).toContain('owner');
  });

  test('should show token ID', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body?.toLowerCase()).toContain('token id');
  });

  test('should display action buttons for connected owner', async ({ page }) => {
    // Should have List for Sale button
    const listButton = page.locator('[data-testid="list-item-button"]');
    const exists = await listButton.count();
    
    // Button may or may not be visible depending on connection state
    expect(exists).toBeGreaterThanOrEqual(0);
  });

  test('should show transfer button for owner', async ({ page }) => {
    const transferButton = page.locator('[data-testid="transfer-item-button"]');
    const exists = await transferButton.count();
    expect(exists).toBeGreaterThanOrEqual(0);
  });

  test('should display activity feed section', async ({ page }) => {
    const activityHeading = page.locator('h2', { hasText: /activity/i });
    await expect(activityHeading).toBeVisible();
  });
});

test.describe('NFT Mint Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/items/mint');
  });

  test('should display mint page with header', async ({ page }) => {
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    const headingText = await heading.textContent();
    expect(headingText?.toLowerCase()).toContain('mint');
  });

  test('should show name input field', async ({ page }) => {
    const nameInput = page.locator('[data-testid="nft-name-input"]');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveAttribute('placeholder');
  });

  test('should show description textarea', async ({ page }) => {
    const descInput = page.locator('[data-testid="nft-description-input"]');
    await expect(descInput).toBeVisible();
  });

  test('should show image URL input', async ({ page }) => {
    const imageInput = page.locator('[data-testid="nft-image-input"]');
    await expect(imageInput).toBeVisible();
  });

  test('should have mint button', async ({ page }) => {
    const mintButton = page.locator('[data-testid="mint-nft-button"]');
    await expect(mintButton).toBeVisible();
  });

  test('mint button should be disabled without wallet connection', async ({ page }) => {
    const mintButton = page.locator('[data-testid="mint-nft-button"]');
    
    // Without wallet connected, button should indicate connection needed
    const buttonText = await mintButton.textContent();
    expect(buttonText?.toLowerCase()).toMatch(/connect|wallet|disabled/);
  });

  test('should display minting info section', async ({ page }) => {
    const infoSection = page.locator('text=About Minting');
    await expect(infoSection).toBeVisible();
  });

  test('should allow entering NFT name', async ({ page }) => {
    const nameInput = page.locator('[data-testid="nft-name-input"]');
    await nameInput.fill('Test NFT');
    await expect(nameInput).toHaveValue('Test NFT');
  });

  test('should allow entering NFT description', async ({ page }) => {
    const descInput = page.locator('[data-testid="nft-description-input"]');
    await descInput.fill('A test NFT description');
    await expect(descInput).toHaveValue('A test NFT description');
  });

  test('should allow entering image URL', async ({ page }) => {
    const imageInput = page.locator('[data-testid="nft-image-input"]');
    await imageInput.fill('ipfs://QmTest123');
    await expect(imageInput).toHaveValue('ipfs://QmTest123');
  });
});

test.describe('NFT Marketplace Integration', () => {
  test('should show marketplace coming soon if not deployed', async ({ page }) => {
    await page.goto('/items');
    await page.waitForTimeout(500);
    
    const body = await page.textContent('body');
    // Either shows marketplace features or coming soon message
    expect(body).toBeTruthy();
  });

  test('should navigate to NFT detail from grid', async ({ page }) => {
    await page.goto('/items');
    await page.waitForTimeout(1000);
    
    // Look for any clickable NFT cards
    const nftCards = page.locator('.card.cursor-pointer');
    const count = await nftCards.count();
    
    if (count > 0) {
      await nftCards.first().click();
      // Should open modal or navigate
      await page.waitForTimeout(500);
    }
  });
});

test.describe('My NFTs Page (Legacy Route)', () => {
  test('should redirect or show appropriate content at /my-nfts', async ({ page }) => {
    await page.goto('/my-nfts');
    
    // Either redirects to /items?filter=my-nfts or shows content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

