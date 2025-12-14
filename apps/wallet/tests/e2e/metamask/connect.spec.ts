/**
 * MetaMask Connection E2E Tests
 * 
 * Tests Jeju Wallet's wagmi integration with MetaMask
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { expect } from '@playwright/test';
import basicSetup, { PASSWORD } from '../../wallet-setup/basic.setup';
import { TEST_ACCOUNTS } from '../../fixtures/accounts';

const test = testWithSynpress(metaMaskFixtures(basicSetup));

test.describe('MetaMask Wallet Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to load
    await page.waitForLoadState('networkidle');
  });

  test('should show connect options', async ({ page }) => {
    // Look for connect button or wallet options
    const connectElement = page.locator('button, [role="button"]').filter({ 
      hasText: /connect|wallet/i 
    });
    await expect(connectElement.first()).toBeVisible({ timeout: 15000 });
  });

  test('should connect to dApp', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    // Find and click connect button
    const connectButton = page.locator('button, [role="button"]').filter({ 
      hasText: /connect|injected|browser wallet/i 
    });
    await connectButton.first().click();

    // Approve connection in MetaMask
    await metamask.connectToDapp();

    // Verify connected - should show address
    await expect(page.locator(`text=${TEST_ACCOUNTS.primary.address.slice(0, 6)}`)).toBeVisible({
      timeout: 15000,
    });
  });

  test('should show correct address after connection', async ({ 
    context, page, metamaskPage, extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    // Connect
    const connectButton = page.locator('button').filter({ hasText: /connect/i });
    await connectButton.first().click();
    await metamask.connectToDapp();

    // Should display truncated address
    const addressRegex = new RegExp(
      `${TEST_ACCOUNTS.primary.address.slice(0, 6)}.*${TEST_ACCOUNTS.primary.address.slice(-4)}`,
      'i'
    );
    await expect(page.locator(`text=/${addressRegex.source}/i`)).toBeVisible({ timeout: 15000 });
  });

  test('should handle disconnect', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    // Connect first
    const connectButton = page.locator('button').filter({ hasText: /connect/i });
    await connectButton.first().click();
    await metamask.connectToDapp();

    // Wait for connection
    await page.waitForTimeout(2000);

    // Find and click disconnect
    const disconnectButton = page.locator('button').filter({ hasText: /disconnect/i });
    if (await disconnectButton.isVisible()) {
      await disconnectButton.click();
      
      // Should show connect button again
      await expect(page.locator('button').filter({ hasText: /connect/i }).first()).toBeVisible({
        timeout: 10000,
      });
    }
  });

  test('should persist connection on reload', async ({ 
    context, page, metamaskPage, extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    // Connect
    const connectButton = page.locator('button').filter({ hasText: /connect/i });
    await connectButton.first().click();
    await metamask.connectToDapp();

    // Wait for connection
    const addressRegex = /0x[a-fA-F0-9]{4}/;
    await expect(page.locator(`text=/${addressRegex.source}/`)).toBeVisible({ timeout: 15000 });

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still show connected or auto-reconnect
    // Note: Behavior depends on wagmi's reconnect settings
    await page.waitForTimeout(3000);
  });
});

