import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { expect } from '@playwright/test';
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup));

const { beforeEach, describe } = test;

const JEJU_NETWORK = {
  networkName: 'Jeju Network',
  rpcUrl: 'https://api.evm-alpha.atleta.network',
  chainId: 70124,
  symbol: 'JEJU',
  blockExplorerUrl: 'https://explorer.evm-alpha.atleta.network',
};

describe('Wallet Connection with Synpress', () => {
  beforeEach(async ({ page }) => {
    await page.goto('/');
    // Take screenshot of initial page
    await page.screenshot({
      path: 'test-results/screenshots/leaderboard/wallet/01-homepage-initial.png',
      fullPage: true
    });
  });

  test('should load homepage and take screenshot', async ({ page }) => {
    // Verify page loads
    await expect(page).toHaveTitle(/Jeju Network Leaderboard/i);

    // Take screenshot
    await page.screenshot({
      path: 'test-results/screenshots/leaderboard/wallet/01-homepage-loaded.png',
      fullPage: true
    });

    // Verify key elements are visible
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });

  test('should connect MetaMask wallet', async ({ page, metamask }) => {
    // Find Connect Wallet button
    const connectButton = page.getByRole('button', { name: /connect/i }).first();
    await expect(connectButton).toBeVisible({ timeout: 10000 });

    // Screenshot before connection
    await page.screenshot({
      path: 'test-results/screenshots/leaderboard/wallet/02-before-connect.png',
      fullPage: true
    });

    // Click connect button
    await connectButton.click();

    // MetaMask should request connection
    await metamask.connectToDapp();

    // Screenshot after connection
    await page.screenshot({
      path: 'test-results/screenshots/leaderboard/wallet/02-after-connect.png',
      fullPage: true
    });

    // Verify wallet address is displayed
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}/i')).toBeVisible({ timeout: 15000 });
  });

  test('should add Jeju network to MetaMask', async ({ page, metamask }) => {
    // Connect wallet first
    const connectButton = page.getByRole('button', { name: /connect/i }).first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
    }

    // Take screenshot of connected state
    await page.screenshot({
      path: 'test-results/screenshots/leaderboard/wallet/03-connected-state.png',
      fullPage: true
    });

    // Add Jeju network
    try {
      await metamask.addNetwork({
        name: JEJU_NETWORK.networkName,
        rpcUrl: JEJU_NETWORK.rpcUrl,
        chainId: JEJU_NETWORK.chainId,
        symbol: JEJU_NETWORK.symbol,
        blockExplorerUrl: JEJU_NETWORK.blockExplorerUrl,
      });
    } catch (error) {
      console.log('Network might already exist:', error);
    }

    // Switch to Jeju network
    await metamask.switchNetwork(JEJU_NETWORK.networkName);

    // Screenshot after network switch
    await page.screenshot({
      path: 'test-results/screenshots/leaderboard/wallet/03-jeju-network.png',
      fullPage: true
    });

    // Verify network switch
    const chainId = await page.evaluate(() => (window as any).ethereum?.chainId);
    expect(chainId).toBe(`0x${JEJU_NETWORK.chainId.toString(16)}`);
  });

  test('should display wallet info after connection', async ({ page, metamask }) => {
    // Connect wallet
    const connectButton = page.getByRole('button', { name: /connect/i }).first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
    }

    // Get wallet address
    const address = await metamask.getAccountAddress();

    // Verify address is displayed on page
    await expect(page.locator(`text=${address.slice(0, 6)}`)).toBeVisible({ timeout: 10000 });

    // Take screenshot of wallet info
    await page.screenshot({
      path: 'test-results/screenshots/leaderboard/wallet/04-wallet-info.png',
      fullPage: true
    });
  });
});
