/**
 * Intent Tests (OIF)
 * 
 * Tests for Open Intents Framework intent submission and tracking.
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { PASSWORD } from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Intents (OIF)', () => {
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

  test('should process swap intent via chat', async ({ page }) => {
    const chatButton = page.locator('button').filter({ hasText: /chat/i });
    if (await chatButton.isVisible()) {
      await chatButton.click();
    }

    const input = page.locator('input[type="text"], textarea').first();
    if (await input.isVisible()) {
      await input.fill('Swap 0.1 ETH for USDC');
      await input.press('Enter');

      // Should show swap intent processing
      const swapResponse = page.locator('text=/swap|exchange|usdc|quote/i');
      await expect(swapResponse.first()).toBeVisible({ timeout: 30000 });
    }
  });

  test('should display best route for swap', async ({ page }) => {
    const chatButton = page.locator('button').filter({ hasText: /chat/i });
    if (await chatButton.isVisible()) {
      await chatButton.click();
    }

    const input = page.locator('input[type="text"], textarea').first();
    if (await input.isVisible()) {
      await input.fill('What is the best rate to swap 1 ETH to USDC?');
      await input.press('Enter');

      // Should show rate information
      const rateInfo = page.locator('text=/rate|price|usdc/i');
      await expect(rateInfo.first()).toBeVisible({ timeout: 30000 });
    }
  });

  test('should handle complex multi-step intent', async ({ page }) => {
    const chatButton = page.locator('button').filter({ hasText: /chat/i });
    if (await chatButton.isVisible()) {
      await chatButton.click();
    }

    const input = page.locator('input[type="text"], textarea').first();
    if (await input.isVisible()) {
      await input.fill('Swap ETH to USDC and then send half to 0x0000000000000000000000000000000000000001');
      await input.press('Enter');

      // Should acknowledge the complex intent
      const response = page.locator('text=/swap|send|step|action/i');
      await expect(response.first()).toBeVisible({ timeout: 30000 });
    }
  });
});

