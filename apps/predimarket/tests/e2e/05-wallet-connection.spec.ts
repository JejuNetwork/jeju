import { expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';
import { testWithWallet as test } from '../../../../tests/shared/fixtures/wallet';
import { connectWallet } from '../../../../tests/shared/helpers/contracts';

const PREDIMARKET_URL = process.env.PREDIMARKET_URL || `http://localhost:${process.env.PREDIMARKET_PORT || '4005'}`;

test.describe('Wallet Connection with Dappwright', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PREDIMARKET_URL);
  });

  test('should connect wallet via Rainbow Kit', async ({ wallet, page }) => {
    // Wait for page load
    await expect(page.getByText('Predimarket')).toBeVisible();

    // Connect wallet
    await connectWallet(page, wallet);

    // Wait for connection success
    await expect(page.getByText(/0x/)).toBeVisible({ timeout: 10000 });
  });

  test('should display connected wallet address', async ({ wallet, page }) => {
    // Connect wallet
    await connectWallet(page, wallet);

    // Should show connected address (truncated)
    const addressButton = page.getByRole('button', { name: /0x[a-fA-F0-9]{4}\.\.\./ });
    await expect(addressButton).toBeVisible();
  });

  test('should navigate to a market and show trading interface', async ({ wallet, page }) => {
    // Connect wallet first
    await connectWallet(page, wallet);

    // Wait for markets to load
    await page.waitForSelector('[data-testid="market-card"]', { timeout: 15000 });

    // Click on first market
    await page.locator('[data-testid="market-card"]').first().click();

    // Should show trading interface
    await expect(page.getByText('Place Bet')).toBeVisible();
    await expect(page.getByText('YES')).toBeVisible();
    await expect(page.getByText('NO')).toBeVisible();
  });
});
