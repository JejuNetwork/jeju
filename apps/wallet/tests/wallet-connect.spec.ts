/**
 * Wallet Connection Tests
 * 
 * Tests for wallet connection flows across different connectors.
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { PASSWORD } from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Wallet Connection', () => {
  test('should display connect button when not connected', async ({ page }) => {
    await page.goto('/');
    
    // Should show at least one connect button
    const connectButtons = page.locator('button').filter({ hasText: /connect|wallet/i });
    await expect(connectButtons.first()).toBeVisible({ timeout: 10000 });
  });

  test('should connect wallet via injected connector', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);

    await page.goto('/');
    
    // Click connect button
    const connectButton = page.locator('button').filter({ hasText: /injected|browser/i });
    await connectButton.first().click();

    // Approve connection in MetaMask
    await metamask.connectToDapp();

    // Verify connected state
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}.*[a-fA-F0-9]{4}/i')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should display connected address after connection', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);

    await page.goto('/');
    
    // Connect wallet
    const connectButton = page.locator('button').filter({ hasText: /injected|browser/i });
    await connectButton.first().click();
    await metamask.connectToDapp();

    // Verify address format (0x followed by first few and last few chars)
    const addressDisplay = page.locator('text=/0x[a-fA-F0-9]{4}.*[a-fA-F0-9]{4}/i');
    await expect(addressDisplay).toBeVisible({ timeout: 10000 });
    
    // Should contain the test address (from seed phrase)
    const addressText = await addressDisplay.textContent();
    expect(addressText?.toLowerCase()).toContain('0xf39f');
  });

  test('should disconnect wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);

    await page.goto('/');
    
    // Connect first
    const connectButton = page.locator('button').filter({ hasText: /injected|browser/i });
    await connectButton.first().click();
    await metamask.connectToDapp();

    // Wait for connection
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}.*[a-fA-F0-9]{4}/i')).toBeVisible({
      timeout: 10000,
    });

    // Click disconnect
    const disconnectButton = page.locator('button').filter({ hasText: /disconnect/i });
    await disconnectButton.click();

    // Verify disconnected - connect button should reappear
    await expect(page.locator('button').filter({ hasText: /connect/i }).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should persist connection on page reload', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);

    await page.goto('/');
    
    // Connect wallet
    const connectButton = page.locator('button').filter({ hasText: /injected|browser/i });
    await connectButton.first().click();
    await metamask.connectToDapp();

    // Wait for connection
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}.*[a-fA-F0-9]{4}/i')).toBeVisible({
      timeout: 10000,
    });

    // Reload page
    await page.reload();

    // Should still be connected (or reconnect automatically)
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}.*[a-fA-F0-9]{4}/i')).toBeVisible({
      timeout: 10000,
    });
  });
});
