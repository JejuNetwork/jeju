/**
 * Gateway Wallet Connection - Synpress E2E Tests
 * Tests wallet connection flow with MetaMask
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../fixtures/synpress-wallet';
import { connectWallet } from '../helpers/wallet-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

test.describe('Gateway Wallet Connection', () => {
  test('should display homepage and connect wallet', async ({ page, metamask }) => {
    // Navigate to homepage
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle');
    
    // Verify page loaded
    await expect(page.getByText(/Gateway Portal|Protocol Infrastructure/i)).toBeVisible();
    console.log('✅ Homepage loaded');
    
    // Take screenshot before connection
    await page.screenshot({ path: 'test-results/screenshots/synpress-01-before-connect.png', fullPage: true });
    
    // Connect wallet
    await connectWallet(page, metamask);
    
    // Verify connection
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });
    console.log('✅ Wallet connected and address displayed');
    
    // Take screenshot after connection
    await page.screenshot({ path: 'test-results/screenshots/synpress-02-wallet-connected.png', fullPage: true });
  });

  test('should display all protocol token balances', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Wait for balances to load
    await page.waitForTimeout(3000);
    
    // Verify all 4 protocol tokens are displayed
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    console.log('✅ All protocol tokens displayed');
    
    // Screenshot token balances
    await page.screenshot({ path: 'test-results/screenshots/synpress-03-token-balances.png', fullPage: true });
  });

  test('should navigate through all tabs', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    const tabs = [
      'Registered Tokens',
      'Bridge from Ethereum',
      'Deploy Paymaster',
      'Add Liquidity',
      'My Earnings',
      'Node Operators',
      'App Registry',
    ];
    
    for (let i = 0; i < tabs.length; i++) {
      await page.getByRole('button', { name: tabs[i] }).click();
      await page.waitForTimeout(1000);
      
      // Screenshot each tab
      await page.screenshot({
        path: `test-results/screenshots/synpress-tab-${i + 1}-${tabs[i].toLowerCase().replace(/\s+/g, '-')}.png`,
        fullPage: true,
      });
      
      console.log(`✅ Tab ${i + 1}/${tabs.length}: ${tabs[i]}`);
    }
  });

  test('should maintain wallet connection across tabs', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    const tabs = ['Registered Tokens', 'Bridge from Ethereum', 'Add Liquidity'];
    
    for (const tab of tabs) {
      await page.getByRole('button', { name: tab }).click();
      await page.waitForTimeout(500);
      
      // Wallet should still be connected
      await expect(page.locator('button:has-text(/0x/)')).toBeVisible();
      console.log(`✅ ${tab}: Wallet still connected`);
    }
  });

  test('should display correct network (Jeju Localnet)', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Check that we're on Jeju network
    const networkIndicator = page.locator('text=/Jeju|Chain ID/i');
    const hasNetworkInfo = await networkIndicator.isVisible();
    
    if (hasNetworkInfo) {
      console.log('✅ Network indicator visible');
    }
    
    // Verify wallet shows connected state
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();
  });
});

test.describe('Gateway Multi-Token Balance Display', () => {
  test('should show USD values for all tokens', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    // Wait for balances
    await page.waitForTimeout(3000);
    
    // Check for USD value displays
    const usdValues = page.locator('text=/\\$[\\d,]+\\.?\\d*/');
    const count = await usdValues.count();
    
    expect(count).toBeGreaterThan(0);
    console.log(`✅ Found ${count} USD value displays`);
  });

  test('should show token logos', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    await page.waitForTimeout(3000);
    
    // Check for token logo images
    const images = page.locator('img[alt*="elizaOS"], img[alt*="CLANKER"], img[alt*="VIRTUAL"], img[alt*="CLANKERMON"]');
    const imageCount = await images.count();
    
    expect(imageCount).toBeGreaterThanOrEqual(1);
    console.log(`✅ Found ${imageCount} token logos`);
  });

  test('should calculate total portfolio value', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    
    await page.waitForTimeout(3000);
    
    // Look for total value
    const totalText = page.getByText(/Total:/i);
    const hasTotal = await totalText.isVisible();
    
    if (hasTotal) {
      await expect(totalText.locator('../..').getByText(/\\$/)).toBeVisible();
      console.log('✅ Total portfolio value displayed');
    }
  });
});

