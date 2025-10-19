import { expect } from '@playwright/test';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet, placeBet } from '../../../../tests/shared/helpers/contracts';

const PREDIMARKET_URL = process.env.PREDIMARKET_URL || `http://localhost:${process.env.PREDIMARKET_PORT || '4005'}`;

test.describe('Complete Trading Flow with Wallet', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(PREDIMARKET_URL);
    // Connect wallet before each test
    await connectWallet(page, wallet);
  });

  test('should approve elizaOS token spending', async ({ wallet, page }) => {
    // Navigate to a market
    await page.waitForSelector('[data-testid="market-card"]', { timeout: 15000 });
    await page.locator('[data-testid="market-card"]').first().click();

    // Wait for trading interface
    await expect(page.getByText('Place Bet')).toBeVisible();

    // Enter amount
    await page.getByPlaceholder('100').fill('10');

    // Click buy button
    await page.getByRole('button', { name: /Buy YES/i }).click();

    // First transaction should be approval
    await wallet.confirmTransaction();

    // Wait for approval confirmation
    await expect(page.getByText('Approved')).toBeVisible({ timeout: 20000 });
  });

  test('should buy YES shares', async ({ wallet, page }) => {
    await page.waitForSelector('[data-testid="market-card"]');
    await page.locator('[data-testid="market-card"]').first().click();

    // Use helper to place bet
    await placeBet(page, wallet, {
      outcome: 'YES',
      amount: '50',
    });
  });

  test('should buy NO shares', async ({ wallet, page }) => {
    await page.waitForSelector('[data-testid="market-card"]');
    await page.locator('[data-testid="market-card"]').first().click();

    // Use helper to place bet
    await placeBet(page, wallet, {
      outcome: 'NO',
      amount: '25',
    });
  });

  test('should display user position in portfolio', async ({ page }) => {
    // Navigate to portfolio
    await page.goto(`${PREDIMARKET_URL}/portfolio`);

    // Should show positions
    await expect(page.getByText('Your Portfolio')).toBeVisible();
    await expect(page.getByText('Positions')).toBeVisible();

    // Should have at least one position
    const positionRows = page.locator('tbody tr');
    await expect(positionRows).not.toHaveCount(0);
  });

  test('should show price updates after trades', async ({ wallet, page }) => {
    await page.waitForSelector('[data-testid="market-card"]');
    const firstMarket = page.locator('[data-testid="market-card"]').first();

    // Get initial YES price
    const initialYesPrice = await firstMarket.getByText(/YES/).textContent();

    // Click market
    await firstMarket.click();

    // Place a large bet to move price
    await placeBet(page, wallet, {
      outcome: 'YES',
      amount: '100',
    });

    // Wait for trade to complete
    await page.waitForTimeout(5000);

    // Go back to homepage
    await page.goto(PREDIMARKET_URL);
    await page.waitForSelector('[data-testid="market-card"]');

    // Check that price has changed
    const newMarket = page.locator('[data-testid="market-card"]').first();
    const newYesPrice = await newMarket.getByText(/YES/).textContent();

    expect(newYesPrice).not.toEqual(initialYesPrice);
  });
});
