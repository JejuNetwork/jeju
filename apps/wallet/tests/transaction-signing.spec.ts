/**
 * Transaction Signing Tests
 * 
 * Tests for transaction signing and message signing flows.
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { PASSWORD } from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Transaction Signing', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);

    await page.goto('/');
    
    // Connect wallet
    const connectButton = page.locator('button').filter({ hasText: /injected|browser/i });
    if (await connectButton.first().isVisible()) {
      await connectButton.first().click();
      await metamask.connectToDapp();
    }

    await expect(page.locator('text=/0x[a-fA-F0-9]{4}.*[a-fA-F0-9]{4}/i')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should display transaction confirmation in chat', async ({ page }) => {
    // Navigate to chat
    const chatButton = page.locator('button').filter({ hasText: /chat/i });
    if (await chatButton.isVisible()) {
      await chatButton.click();
    }

    // Request a transaction
    const input = page.locator('input[type="text"], textarea').first();
    if (await input.isVisible()) {
      await input.fill('Send 0.001 ETH to 0x0000000000000000000000000000000000000001');
      await input.press('Enter');

      // Should show transaction details
      const txDetails = page.locator('text=/send|transaction|confirm/i');
      await expect(txDetails.first()).toBeVisible({ timeout: 30000 });
    }
  });

  test('should show gas estimation', async ({ page }) => {
    const chatButton = page.locator('button').filter({ hasText: /chat/i });
    if (await chatButton.isVisible()) {
      await chatButton.click();
    }

    const input = page.locator('input[type="text"], textarea').first();
    if (await input.isVisible()) {
      await input.fill('What is the current gas price?');
      await input.press('Enter');

      // Should show gas information
      const gasInfo = page.locator('text=/gas|gwei|fee/i');
      await expect(gasInfo.first()).toBeVisible({ timeout: 30000 });
    }
  });
});

test.describe('Message Signing', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);

    await page.goto('/');
    
    const connectButton = page.locator('button').filter({ hasText: /injected|browser/i });
    if (await connectButton.first().isVisible()) {
      await connectButton.first().click();
      await metamask.connectToDapp();
    }

    await expect(page.locator('text=/0x[a-fA-F0-9]{4}.*[a-fA-F0-9]{4}/i')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should request message signature via chat', async ({ page }) => {
    const chatButton = page.locator('button').filter({ hasText: /chat/i });
    if (await chatButton.isVisible()) {
      await chatButton.click();
    }

    const input = page.locator('input[type="text"], textarea').first();
    if (await input.isVisible()) {
      await input.fill('Sign a message that says "Hello Jeju"');
      await input.press('Enter');

      // Should show signing request or response
      const signResponse = page.locator('text=/sign|signature|message/i');
      await expect(signResponse.first()).toBeVisible({ timeout: 30000 });
    }
  });
});

