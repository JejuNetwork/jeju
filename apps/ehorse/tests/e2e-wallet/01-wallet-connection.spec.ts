import { test, expect, connectWallet } from '../../../../tests/shared/fixtures/synpress-wallet';
import { captureScreenshot } from '../../../../tests/shared/helpers/screenshots';

test.describe('eHorse - Wallet Connection', () => {
  test('should connect MetaMask wallet', async ({ page, metamask }) => {
    await page.goto('http://localhost:4002');

    await captureScreenshot(page, {
      appName: 'ehorse',
      feature: 'wallet',
      step: '01-before-connect',
    });

    // Connect wallet
    await connectWallet(page, metamask);

    await captureScreenshot(page, {
      appName: 'ehorse',
      feature: 'wallet',
      step: '02-after-connect',
    });

    // Verify wallet is connected
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 10000 });
  });

  test('should display game interface after wallet connection', async ({ page, metamask }) => {
    await page.goto('http://localhost:4002');

    await connectWallet(page, metamask);

    // Check for game elements
    await expect(page.locator('text=/Race|Game|Bet/i')).toBeVisible();
  });
});
