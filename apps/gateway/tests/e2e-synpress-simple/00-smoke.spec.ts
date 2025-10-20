/**
 * Gateway Smoke Test - Simple Synpress Pattern
 * Based on official Synpress examples
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const GATEWAY_URL = 'http://localhost:4001';

test.describe('Gateway Smoke Tests', () => {
  test('should connect to Gateway Portal', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Navigate to Gateway
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle');

    // Verify page loaded
    await expect(page.getByText(/Gateway Portal/i)).toBeVisible();
    console.log('✅ Homepage loaded');

    // Click connect button
    await page.locator('button:has-text("Connect")').first().click();
    await page.waitForTimeout(1000);

    // Connect MetaMask to dApp
    await metamask.connectToDapp();

    // Verify connection
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });
    console.log('✅ Wallet connected');

    // Verify tokens load
    await page.waitForTimeout(3000);
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    console.log('✅ Protocol tokens loaded');
  });

  test('should navigate all tabs', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(GATEWAY_URL);
    
    // Connect wallet
    await page.locator('button:has-text("Connect")').first().click();
    await page.waitForTimeout(1000);
    await metamask.connectToDapp();
    
    // Wait for connection
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });

    // Test navigation
    const tabs = ['Bridge from Base', 'Add Liquidity', 'Node Operators'];
    
    for (const tab of tabs) {
      await page.getByRole('button', { name: tab }).click();
      await page.waitForTimeout(500);
      console.log(`✅ Navigated to ${tab}`);
    }
  });

  test('RPC should be accessible', async ({ page }) => {
    const response = await page.request.post('http://127.0.0.1:9545', {
      data: {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      },
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.result).toBeDefined();
    
    console.log('✅ RPC accessible');
  });
});

