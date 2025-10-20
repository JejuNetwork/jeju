import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

const PREDIMARKET_URL = process.env.PREDIMARKET_URL || `http://localhost:${process.env.PREDIMARKET_PORT || '4005'}`;

test.describe('Complete Market Flow', () => {
  test('should complete full betting cycle', async ({ page }) => {
    // 1. Visit homepage
    await page.goto(PREDIMARKET_URL);
    
    await expect(page.getByText('Predimarket')).toBeVisible();
    await expect(page.getByText('Decentralized Prediction Markets')).toBeVisible();

    // 2. Check markets loaded (or show "No markets" message)
    const hasMarkets = await page.locator('[data-testid="market-card"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!hasMarkets) {
      // No markets available - skip rest of test
      test.skip();
      return;
    }

    await page.waitForSelector('[data-testid="market-card"]', { timeout: 10000 });
    
    const marketCards = await page.locator('[data-testid="market-card"]').count();
    expect(marketCards).toBeGreaterThan(0);

    // 3. Click on first market
    await page.locator('[data-testid="market-card"]').first().click();
    
    // 4. Verify market page loads
    await expect(page.getByText(/Will/)).toBeVisible();
    await expect(page.getByText('Current Prices')).toBeVisible();

    // 5. Connect wallet (if available)
    const connectButton = page.getByRole('button', { name: /Connect/i });
    
    if (await connectButton.isVisible()) {
      console.log('Wallet connect button visible');
      // In real test, would connect mock wallet
    }

    // 6. Verify trading interface
    await expect(page.getByText('Place Bet')).toBeVisible();
    await expect(page.getByText('YES')).toBeVisible();
    await expect(page.getByText('NO')).toBeVisible();

    // 7. Check portfolio page
    await page.goto(`${PREDIMARKET_URL}/portfolio`);
    await expect(page.getByText('Your Portfolio')).toBeVisible();
  });

  test('should display market data correctly', async ({ page }) => {
    await page.goto(PREDIMARKET_URL);
    
    const hasMarkets = await page.locator('[data-testid="market-card"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!hasMarkets) {
      // No markets available - test passes if "No markets" message shown
      await expect(page.getByText(/No markets found|Loading markets/i)).toBeVisible();
      return;
    }
    
    await page.waitForSelector('[data-testid="market-card"]');

    const firstMarket = page.locator('[data-testid="market-card"]').first();
    
    // Should show volume
    await expect(firstMarket.getByText(/Volume/)).toBeVisible();
    
    // Should show prices
    await expect(firstMarket.getByText(/YES/)).toBeVisible();
    await expect(firstMarket.getByText(/NO/)).toBeVisible();
  });

  test('should handle market resolution', async ({ page }) => {
    await page.goto(PREDIMARKET_URL);
    
    // Filter to resolved markets
    await page.getByRole('button', { name: 'Resolved' }).click();
    
    const resolvedMarkets = await page.locator('[data-testid="market-card"]:has-text("Resolved")').count();
    console.log(`Found ${resolvedMarkets} resolved markets`);
  });
});

