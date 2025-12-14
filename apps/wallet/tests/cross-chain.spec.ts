/**
 * Cross-Chain Transfer Tests (EIL)
 * 
 * Tests for Ethereum Interop Layer cross-chain transfer flows.
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { PASSWORD } from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Cross-Chain Transfers (EIL)', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);

    await page.goto('/');
    
    // Connect wallet first
    const connectButton = page.locator('button').filter({ hasText: /injected|browser/i });
    if (await connectButton.first().isVisible()) {
      await connectButton.first().click();
      await metamask.connectToDapp();
    }

    // Wait for connection
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}.*[a-fA-F0-9]{4}/i')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should display unified balance across chains', async ({ page }) => {
    // Navigate to portfolio view
    const portfolioButton = page.locator('button').filter({ hasText: /portfolio/i });
    if (await portfolioButton.isVisible()) {
      await portfolioButton.click();
    }

    // Should show unified balance or total value
    const balanceDisplay = page.locator('text=/total|balance/i');
    await expect(balanceDisplay.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show chain breakdown for tokens', async ({ page }) => {
    // Navigate to portfolio
    const portfolioButton = page.locator('button').filter({ hasText: /portfolio/i });
    if (await portfolioButton.isVisible()) {
      await portfolioButton.click();
    }

    // Should show chain information
    const chainIndicator = page.locator('text=/chain|network/i');
    // This test checks that chain info is present somewhere
    await expect(chainIndicator.first()).toBeVisible({ timeout: 10000 });
  });

  test('should initiate cross-chain transfer via chat', async ({ page }) => {
    // Go to chat view
    const chatButton = page.locator('button').filter({ hasText: /chat/i });
    if (await chatButton.isVisible()) {
      await chatButton.click();
    }

    // Type a cross-chain transfer request
    const input = page.locator('input[type="text"], textarea').first();
    if (await input.isVisible()) {
      await input.fill('Send 0.01 ETH from Base to Arbitrum');
      await input.press('Enter');

      // Should show some response indicating the action
      const response = page.locator('text=/transfer|cross-chain|bridge/i');
      await expect(response.first()).toBeVisible({ timeout: 30000 });
    }
  });
});

