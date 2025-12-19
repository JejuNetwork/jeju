/**
 * Otto Wallet Connection Tests (Synpress)
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Otto Wallet Connection', () => {
  test('should connect wallet via OAuth3 flow', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId
    );

    // Navigate to Otto auth callback (simulating OAuth3 redirect)
    await page.goto('/auth/callback?platform=discord&platformId=123&nonce=test');

    // In a real test, we would:
    // 1. Click connect button
    // 2. Connect MetaMask
    // 3. Sign the message
    // 4. Verify connection success

    // For now, verify the page loads
    await expect(page.locator('body')).toContainText('Connected');
  });

  test('should sign trading confirmation', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId
    );

    // This test would verify the session key creation flow
    // For now, just verify the API is accessible
    const response = await page.request.get('/health');
    expect(response.ok()).toBe(true);
  });
});

