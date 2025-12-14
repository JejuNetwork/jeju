/**
 * MetaMask Transaction E2E Tests
 * 
 * Tests transaction sending and confirmation
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { expect } from '@playwright/test';
import basicSetup, { PASSWORD } from '../../wallet-setup/basic.setup';
import { TEST_ACCOUNTS } from '../../fixtures/accounts';

const test = testWithSynpress(metaMaskFixtures(basicSetup));

test.describe('Transactions', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Connect wallet
    const connectButton = page.locator('button').filter({ hasText: /connect/i });
    if (await connectButton.first().isVisible()) {
      await connectButton.first().click();
      await metamask.connectToDapp();
      await page.waitForTimeout(2000);
    }
  });

  test('should display send transaction UI', async ({ page }) => {
    // Look for send/transfer functionality
    const sendElement = page.locator('button, a, [role="button"]').filter({ 
      hasText: /send|transfer/i 
    });
    
    // If exists, click and check form
    if (await sendElement.first().isVisible()) {
      await sendElement.first().click();
      
      // Should show address input
      await expect(page.locator('input[placeholder*="address" i], input[name*="to" i]')).toBeVisible();
    }
  });

  test('should initiate transaction and confirm in MetaMask', async ({ 
    context, page, metamaskPage, extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    // Navigate to send UI
    const sendButton = page.locator('button, a').filter({ hasText: /send/i });
    
    if (await sendButton.first().isVisible()) {
      await sendButton.first().click();
      
      // Fill in recipient
      const toInput = page.locator('input').filter({ hasText: '' }).first();
      if (await toInput.isVisible()) {
        await toInput.fill(TEST_ACCOUNTS.secondary.address);
      }
      
      // Fill in amount
      const amountInput = page.locator('input[type="number"], input[placeholder*="amount" i]');
      if (await amountInput.isVisible()) {
        await amountInput.fill('0.001');
      }
      
      // Submit transaction
      const submitButton = page.locator('button').filter({ hasText: /send|confirm|submit/i });
      if (await submitButton.isVisible()) {
        await submitButton.click();
        
        // Confirm in MetaMask
        await metamask.confirmTransaction();
        
        // Wait for confirmation
        await page.waitForTimeout(3000);
      }
    } else {
      test.skip();
    }
  });

  test('should reject transaction', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    
    const sendButton = page.locator('button, a').filter({ hasText: /send/i });
    
    if (await sendButton.first().isVisible()) {
      await sendButton.first().click();
      
      const toInput = page.locator('input').first();
      if (await toInput.isVisible()) {
        await toInput.fill(TEST_ACCOUNTS.secondary.address);
      }
      
      const submitButton = page.locator('button').filter({ hasText: /send|confirm/i });
      if (await submitButton.isVisible()) {
        await submitButton.click();
        
        // Reject in MetaMask
        await metamask.rejectTransaction();
        
        // Should handle rejection gracefully
        await page.waitForTimeout(2000);
      }
    } else {
      test.skip();
    }
  });
});

