import { test, expect, BrowserContext } from '@playwright/test';
import { MetaMask, getMetaMask, setupMetaMask } from '@tenkeylabs/dappwright';

const JEJU_NETWORK = {
  networkName: 'Jeju',
  rpcUrl: 'https://api.evm-alpha.atleta.network',
  chainId: 70124,
  symbol: 'JEJU',
};

let metamask: MetaMask;

test.describe('Wallet Connection and Jeju Network', () => {
  test.beforeEach(async ({ context }: { context: BrowserContext }) => {
    metamask = await setupMetaMask(context as any, {
      seed: 'test test test test test test test test test test test junk',
      password: 'password1234',
    });
  });

  test('should connect MetaMask wallet', async ({ page }) => {
    await page.goto('/');

    // Find and click the Connect Wallet button
    const connectButton = page.locator('button:has-text("Connect")').first();
    await expect(connectButton).toBeVisible({ timeout: 10000 });
    await connectButton.click();

    // Wait for MetaMask popup and accept connection
    await metamask.approve();

    // Verify wallet is connected
    await expect(page.locator('text=/0x[a-fA-F0-9]{4,}/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should add and connect to Jeju network', async ({ page }) => {
    await page.goto('/');

    // Connect wallet first
    const connectButton = page.locator('button:has-text("Connect")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.approve();
    }

    // Add Jeju network to MetaMask
    try {
      await metamask.addNetwork(JEJU_NETWORK);
    } catch (e) {
      // Network might already be added
      console.log('Network already added or error:', e);
    }

    // Switch to Jeju network
    await metamask.switchNetwork(JEJU_NETWORK.networkName);

    // Verify we're on the Jeju network
    const currentNetwork = await page.evaluate(() => {
      return (window as any).ethereum?.chainId;
    });
    expect(currentNetwork).toBe(`0x${JEJU_NETWORK.chainId.toString(16)}`);
  });

  test('should display wallet address after connection', async ({ page }) => {
    await page.goto('/');

    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.approve();
    }

    // Verify wallet address is displayed
    const walletAddress = await page.locator('text=/0x[a-fA-F0-9]{4,}/i').first().textContent();
    expect(walletAddress).toBeTruthy();
    expect(walletAddress).toMatch(/0x[a-fA-F0-9]/);
  });
});
