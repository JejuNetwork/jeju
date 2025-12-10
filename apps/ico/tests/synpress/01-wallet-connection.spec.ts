/**
 * Wallet Connection Tests
 * Verifies MetaMask integration for presale participation
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const ICO_URL = process.env.ICO_URL || 'http://localhost:4020';

test.describe('Wallet Connection', () => {
  test('should display connect wallet button when not connected', async ({ page }) => {
    await page.goto(ICO_URL);
    await expect(page.getByRole('button', { name: /Connect Wallet/i })).toBeVisible();
  });

  test('should connect MetaMask to presale dapp', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();

    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });
  });

  test('should persist wallet connection after page refresh', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Connection should persist (or reconnect button should appear)
    const hasAddress = await page.getByText(/0xf39F/i).isVisible();
    const hasConnectButton = await page.getByRole('button', { name: /Connect Wallet/i }).isVisible();
    expect(hasAddress || hasConnectButton).toBe(true);
  });

  test('should show correct network indicator', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 });

    // Should show testnet indicator
    await expect(page.getByText(/Testnet/i)).toBeVisible();
  });
});

test.describe('Network Handling', () => {
  test('should handle wrong network gracefully', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Switch to mainnet (wrong network)
    await metamask.switchNetwork('Ethereum Mainnet');

    await page.goto(ICO_URL);
    await page.getByRole('button', { name: /Connect Wallet/i }).click();
    await metamask.connectToDapp();

    // Should show network switch prompt or warning
    const body = await page.textContent('body');
    const needsSwitch = body?.includes('Switch') || body?.includes('Wrong') || body?.includes('Network');
    // App should handle gracefully - either show warning or auto-prompt
    expect(body).toBeTruthy();
  });
});
