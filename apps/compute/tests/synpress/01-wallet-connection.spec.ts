/**
 * Wallet Connection Tests
 * Tests MetaMask connection, disconnection, and account switching
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Wallet Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display connect wallet button when not connected', async ({ page }) => {
    const connectBtn = page.getByTestId('connect-wallet');
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toContainText('Connect Wallet');
  });

  test('should connect wallet via MetaMask', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Click connect
    const connectBtn = page.getByTestId('connect-wallet');
    await connectBtn.click();

    // Approve connection in MetaMask
    await metamask.connectToDapp();

    // Verify wallet info is displayed
    const walletInfo = page.getByTestId('wallet-info');
    await expect(walletInfo).toBeVisible({ timeout: 10000 });

    // Verify address is shown
    const walletAddress = page.locator('#wallet-address');
    await expect(walletAddress).toContainText('0x');
  });

  test('should show disconnect button after connecting', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.getByTestId('connect-wallet').click();
    await metamask.connectToDapp();

    const disconnectBtn = page.getByTestId('disconnect-wallet');
    await expect(disconnectBtn).toBeVisible({ timeout: 10000 });
  });

  test('should disconnect wallet', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect first
    await page.getByTestId('connect-wallet').click();
    await metamask.connectToDapp();
    await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });

    // Disconnect
    await page.getByTestId('disconnect-wallet').click();

    // Verify connect button is back
    const connectBtn = page.getByTestId('connect-wallet');
    await expect(connectBtn).toBeVisible();
  });

  test('should show network badge', async ({ page }) => {
    const networkBadge = page.getByTestId('network-badge');
    await expect(networkBadge).toBeVisible();
    await expect(networkBadge).toContainText('Sepolia');
  });

  test('should handle wallet not installed', async ({ page }) => {
    // Remove ethereum from window
    await page.evaluate(() => {
      (window as Window & { ethereum?: unknown }).ethereum = undefined;
    });

    await page.getByTestId('connect-wallet').click();

    // Should show toast error
    const toast = page.locator('.toast.error');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });
});

