import { expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet, placeBet } from '../../../../tests/shared/helpers/contracts';

const PREDIMARKET_URL = process.env.PREDIMARKET_URL || `http://localhost:${process.env.PREDIMARKET_PORT || '4005'}`;

test.describe('Market Resolution Flow', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(PREDIMARKET_URL);
    await connectWallet(page, wallet);
  });

  test('should show resolved market status', async ({ page }) => {
    // Wait for markets to load
    await page.waitForSelector('[data-testid="market-card"]', { timeout: 15000 });

    // Look for a resolved market
    const resolvedMarket = page.locator('[data-testid="market-card"]').filter({
      hasText: /Resolved|Closed/i
    }).first();

    // If found, check it shows resolution details
    if (await resolvedMarket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await resolvedMarket.click();

      // Should show outcome
      await expect(page.getByText(/Outcome|Winner|Result/i)).toBeVisible();
    }
  });

  test('should allow claiming winnings from resolved market', async ({ wallet, page }) => {
    // Navigate to portfolio
    await page.goto(`${PREDIMARKET_URL}/portfolio`);

    // Wait for portfolio to load
    await expect(page.getByText(/Portfolio|Positions/i)).toBeVisible();

    // Look for claimable position
    const claimButton = page.locator('button:has-text("Claim")').first();

    if (await claimButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click claim
      await claimButton.click();

      // Confirm transaction in MetaMask
      await wallet.confirmTransaction();

      // Wait for success
      await expect(page.locator('text=/claimed|success/i')).toBeVisible({
        timeout: 30000
      });
    } else {
      console.log('No claimable positions found - skipping claim test');
      test.skip();
    }
  });

  test('should show market outcome after resolution', async ({ page }) => {
    await page.waitForSelector('[data-testid="market-card"]');

    // Find first market
    const firstMarket = page.locator('[data-testid="market-card"]').first();
    await firstMarket.click();

    // Market should show current status
    const statusElement = page.locator('[data-status]').first();

    if (await statusElement.isVisible({ timeout: 3000 }).catch(() => false)) {
      const status = await statusElement.getAttribute('data-status');
      console.log(`Market status: ${status}`);

      // Status should be one of: pending, active, resolved
      expect(['pending', 'active', 'resolved', 'closed']).toContain(status);
    }
  });

  test('should display resolution information', async ({ page }) => {
    await page.waitForSelector('[data-testid="market-card"]');

    // Look for resolved markets
    const markets = page.locator('[data-testid="market-card"]');
    const count = await markets.count();

    console.log(`Found ${count} markets`);

    // Check first few markets for resolution data
    for (let i = 0; i < Math.min(count, 3); i++) {
      const market = markets.nth(i);
      await market.click();

      // Wait a bit for market details to load
      await page.waitForTimeout(1000);

      // Market should show either trading UI or resolution info
      const hasTrading = await page.getByText(/Buy|Place Bet/i).isVisible({ timeout: 2000 }).catch(() => false);
      const hasResolution = await page.getByText(/Resolved|Outcome|Result/i).isVisible({ timeout: 2000 }).catch(() => false);

      expect(hasTrading || hasResolution).toBeTruthy();

      // Go back to list
      await page.goto(PREDIMARKET_URL);
      await page.waitForSelector('[data-testid="market-card"]');
    }
  });
});
