import { Page, expect } from '@playwright/test';

/**
 * Navigation helpers for Jeju dApp testing
 */

export async function navigateToMarket(page: Page, marketId?: string) {
  if (marketId) {
    await page.goto(`/market/${marketId}`);
  } else {
    // Navigate to first available market
    await page.goto('/');
    await page.waitForSelector('[data-testid="market-card"]', { timeout: 15000 });
    await page.locator('[data-testid="market-card"]').first().click();
  }

  // Wait for market page to load
  await expect(page.locator('text=/Place Bet|Buy|Trade/i')).toBeVisible();
}

export async function navigateToPortfolio(page: Page) {
  await page.goto('/portfolio');
  await expect(page.locator('text=/Portfolio|Your Positions/i')).toBeVisible();
}

export async function navigateToSwap(page: Page) {
  await page.goto('/swap');
  await expect(page.locator('text=/Swap/i')).toBeVisible();
}

export async function navigateToLiquidity(page: Page) {
  await page.goto('/liquidity');
  await expect(page.locator('text=/Liquidity|Add Liquidity/i')).toBeVisible();
}

export async function navigateToPools(page: Page) {
  await page.goto('/pools');
  await expect(page.locator('text=/Pools/i')).toBeVisible();
}

export async function navigateToNFTs(page: Page) {
  await page.goto('/nfts');
  await expect(page.locator('text=/NFT|Marketplace/i')).toBeVisible();
}

export async function navigateToBridge(page: Page) {
  await page.goto('/bridge');
  await expect(page.locator('text=/Bridge/i')).toBeVisible();
}
