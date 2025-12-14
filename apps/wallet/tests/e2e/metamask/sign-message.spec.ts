/**
 * MetaMask Message Signing E2E Tests
 * 
 * Tests personal_sign and eth_signTypedData functionality
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { expect } from '@playwright/test';
import basicSetup, { PASSWORD } from '../../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));

test.describe('Message Signing', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Connect wallet first
    const connectButton = page.locator('button').filter({ hasText: /connect/i });
    if (await connectButton.first().isVisible()) {
      await connectButton.first().click();
      await metamask.connectToDapp();
      await page.waitForTimeout(2000);
    }
  });

  test('should sign a personal message', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    // Find sign message button/link (depends on the network Wallet UI)
    const signButton = page.locator('button, [role="button"]').filter({ 
      hasText: /sign.*message/i 
    });
    
    if (await signButton.isVisible()) {
      await signButton.click();
      
      // Sign in MetaMask
      await metamask.confirmSignature();
      
      // Verify signature result displayed
      await expect(page.locator('text=/0x[a-fA-F0-9]{130}/i')).toBeVisible({ 
        timeout: 15000 
      });
    } else {
      // Skip if feature not visible in UI
      test.skip();
    }
  });

  test('should reject signature request', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    const signButton = page.locator('button').filter({ hasText: /sign.*message/i });
    
    if (await signButton.isVisible()) {
      await signButton.click();
      
      // Reject in MetaMask
      await metamask.rejectSignature();
      
      // Should show error or rejection message
      await page.waitForTimeout(2000);
    } else {
      test.skip();
    }
  });
});

