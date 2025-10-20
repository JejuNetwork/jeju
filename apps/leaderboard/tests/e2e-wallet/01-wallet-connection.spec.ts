import { test, expect, connectWallet } from '../../../../tests/shared/fixtures/synpress-wallet';
import { captureScreenshot } from '../../../../tests/shared/helpers/screenshots';

test.describe('Leaderboard - Wallet Connection', () => {
  test('should connect MetaMask wallet to leaderboard', async ({ page, metamask }) => {
    await page.goto('/');

    await captureScreenshot(page, {
      appName: 'leaderboard',
      feature: 'wallet',
      step: '01-before-connect',
    });

    // Connect wallet
    await connectWallet(page, metamask);

    await captureScreenshot(page, {
      appName: 'leaderboard',
      feature: 'wallet',
      step: '02-after-connect',
    });

    // Verify wallet is connected
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 10000 });
  });

  test('should display user stats after wallet connection', async ({ page, metamask }) => {
    await page.goto('/');

    await connectWallet(page, metamask);

    // Check for user-specific elements
    await expect(page.getByRole('heading', { name: /Stats/i })).toBeVisible();
  });
});
