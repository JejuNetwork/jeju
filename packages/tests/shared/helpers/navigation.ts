import { Page, expect } from '@playwright/test';

/**
 * Navigation helpers for network dApp testing
 */

export async function navigateToRoute(
  page: Page,
  route: string,
  options: { waitForText?: string | RegExp; timeout?: number } = {}
): Promise<void> {
  const { waitForText, timeout = 15000 } = options;
  await page.goto(route);
  if (waitForText) {
    await expect(page.getByText(waitForText)).toBeVisible({ timeout });
  }
}

export async function navigateToMarket(page: Page, marketId?: string): Promise<void> {
  if (marketId) {
    await page.goto(`/market/${marketId}`);
  } else {
    await page.goto('/');
    await page.waitForSelector('[data-testid="market-card"]', { timeout: 15000 });
    await page.locator('[data-testid="market-card"]').first().click();
  }
  await expect(page.locator('text=/Place Bet|Buy|Trade/i')).toBeVisible();
}

export async function navigateToPortfolio(page: Page): Promise<void> {
  await navigateToRoute(page, '/portfolio', { waitForText: /Portfolio|Your Positions/i });
}

export async function navigateToSwap(page: Page): Promise<void> {
  await navigateToRoute(page, '/swap', { waitForText: /Swap/i });
}

export async function navigateToLiquidity(page: Page): Promise<void> {
  await navigateToRoute(page, '/liquidity', { waitForText: /Liquidity|Add Liquidity/i });
}
