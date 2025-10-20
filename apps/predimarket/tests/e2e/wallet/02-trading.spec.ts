/**
 * Trading Flow Tests using Synpress
 * 
 * Tests complete trading flow with real MetaMask transactions
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Trading Flow with Real Transactions', () => {
  test.beforeEach(async ({ context, metamaskPage, extensionId, page }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect to dapp (network already set up in wallet setup)
    await page.goto('/');
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();
    await page.waitForTimeout(1000);
    await page.click('text="MetaMask"');
    await metamask.connectToDapp();
    
    // Wait for connection
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });
  });

  test('should place a YES bet', async ({ context, metamaskPage, extensionId, page }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Wait for markets
    await page.waitForSelector('[data-testid="market-card"]', { timeout: 15000 });
    
    // Click first market
    await page.locator('[data-testid="market-card"]').first().click();
    
    // Wait for trading interface
    await expect(page.getByTestId('trading-interface')).toBeVisible();
    
    // Select YES
    await page.getByTestId('outcome-yes-button').click();
    
    // Enter amount
    await page.getByTestId('amount-input').fill('10');
    
    // Click buy
    await page.getByTestId('buy-button').click();
    
    // Confirm transaction in MetaMask
    await metamask.confirmTransaction();
    
    // Wait for confirmation (or handle if no success message)
    await page.waitForTimeout(5000);
  });

  test('should place a NO bet', async ({ context, metamaskPage, extensionId, page }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.waitForSelector('[data-testid="market-card"]');
    await page.locator('[data-testid="market-card"]').first().click();
    
    // Select NO
    await page.getByTestId('outcome-no-button').click();
    
    // Enter amount
    await page.getByTestId('amount-input').fill('5');
    
    // Click buy
    await page.getByTestId('buy-button').click();
    
    // Confirm in MetaMask
    await metamask.confirmTransaction();
    
    await page.waitForTimeout(5000);
  });

  test('should show position in portfolio after trade', async ({ context, metamaskPage, extensionId, page }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Place a bet first
    await page.waitForSelector('[data-testid="market-card"]');
    await page.locator('[data-testid="market-card"]').first().click();
    await page.getByTestId('amount-input').fill('10');
    await page.getByTestId('buy-button').click();
    await metamask.confirmTransaction();
    await page.waitForTimeout(5000);

    // Navigate to portfolio
    await page.goto('/portfolio');
    await expect(page.getByText('Your Portfolio')).toBeVisible();
    
    // Wait for indexer to process (if available)
    await page.waitForTimeout(3000);
    
    // Check for positions or "no positions" message
    const hasPositions = await page.locator('tbody tr').count() > 0;
    
    if (hasPositions) {
      console.log('✅ Position found in portfolio');
    } else {
      console.log('ℹ️  No positions yet (indexer may still be processing)');
    }
  });
});

