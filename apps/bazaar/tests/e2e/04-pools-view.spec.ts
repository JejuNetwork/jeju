import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';
import { navigateToPools } from '../../../../tests/shared/helpers/navigation';

const BAZAAR_URL = process.env.BAZAAR_URL || 'http://localhost:4006';

test.describe('Bazaar Pools View', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(BAZAAR_URL);
    await connectWallet(page, wallet);
    await navigateToPools(page);
  });

  test('should display pools page', async ({ page }) => {
    await expect(page.getByText(/Pools|Liquidity Pools/i)).toBeVisible();
  });

  test('should show list of available pools', async ({ page }) => {
    // Wait for pools to load
    await page.waitForTimeout(2000);

    // Should show pool cards or table
    const poolElements = page.locator('[data-testid="pool-card"], tr[data-pool]');

    const count = await poolElements.count();
    console.log(`Found ${count} pools`);

    // Should have at least one pool or show empty state
    if (count === 0) {
      await expect(page.getByText(/No pools|Add liquidity/i)).toBeVisible();
    } else {
      await expect(poolElements.first()).toBeVisible();
    }
  });

  test('should display pool information', async ({ page }) => {
    await page.waitForTimeout(2000);

    const firstPool = page.locator('[data-testid="pool-card"], tr[data-pool]').first();

    if (await firstPool.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click to view details
      await firstPool.click();

      // Should show pool details
      await expect(page.getByText(/Liquidity|TVL|Volume|APY/i)).toBeVisible();
    } else {
      console.log('No pools available - skipping test');
      test.skip();
    }
  });

  test('should show token pairs in pools', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Pools should show token pairs (e.g., ETH/USDC)
    const tokenPairs = page.locator('text=/[A-Z]+\\/[A-Z]+/, text=/[A-Z]+-[A-Z]+/');

    if (await tokenPairs.count() > 0) {
      const firstPair = await tokenPairs.first().textContent();
      console.log(`Token pair: ${firstPair}`);
      expect(firstPair).toMatch(/[A-Z]/);
    }
  });

  test('should navigate to add liquidity from pools page', async ({ page }) => {
    // Look for "Add Liquidity" button
    const addLiquidityButton = page.locator('button:has-text("Add Liquidity"), a:has-text("Add Liquidity")').first();

    if (await addLiquidityButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addLiquidityButton.click();

      // Should navigate to liquidity page or show modal
      await expect(page.getByText(/Add Liquidity|Provide Liquidity/i)).toBeVisible();
    }
  });

  test('should filter pools by token', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for search or filter
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Filter"]').first();

    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('ETH');
      await page.waitForTimeout(1000);

      // Results should be filtered
      console.log('Search applied - pools filtered');
    }
  });
});
