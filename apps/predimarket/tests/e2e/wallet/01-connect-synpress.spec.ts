import { test, expect, connectWallet } from '../../../../../tests/shared/fixtures/synpress-wallet';
import { captureScreenshot } from '../../../../../tests/shared/helpers/screenshots';

test.describe('PrediMarket - Wallet Connection with Synpress', () => {
  test('should connect MetaMask wallet', async ({ page, metamask }) => {
    await page.goto('/');

    await captureScreenshot(page, {
      appName: 'predimarket',
      feature: 'wallet-synpress',
      step: '01-before-connect',
    });

    // Connect wallet using Synpress
    await connectWallet(page, metamask);

    await captureScreenshot(page, {
      appName: 'predimarket',
      feature: 'wallet-synpress',
      step: '02-after-connect',
    });

    // Verify wallet is connected
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 10000 });
  });

  test('should display market interface after wallet connection', async ({ page, metamask }) => {
    await page.goto('/');

    await connectWallet(page, metamask);

    // Check for market elements
    await expect(page.locator('text=/Market|Trade|Position/i')).toBeVisible();
  });
});
