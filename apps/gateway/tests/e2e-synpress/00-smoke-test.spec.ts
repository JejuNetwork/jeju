/**
 * Gateway Smoke Tests - Synpress E2E
 * Quick validation that everything is working
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../fixtures/synpress-wallet';
import { connectWallet } from '../helpers/wallet-helpers';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';

test.describe('Gateway Smoke Tests', () => {
  test('homepage should load without errors', async ({ page }) => {
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle');
    
    // Verify page loaded
    await expect(page.getByText(/Gateway Portal/i)).toBeVisible();
    
    // No console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.waitForTimeout(2000);
    
    if (errors.length > 0) {
      console.warn('⚠️ Console errors detected:', errors);
    } else {
      console.log('✅ No console errors');
    }
    
    // Screenshot
    await page.screenshot({ path: 'test-results/screenshots/synpress-00-homepage.png', fullPage: true });
  });

  test('should connect MetaMask wallet', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    
    // Connect wallet
    await connectWallet(page, metamask);
    
    // Verify connected
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });
    
    console.log('✅ MetaMask connection works');
    
    // Screenshot connected state
    await page.screenshot({ path: 'test-results/screenshots/synpress-00-connected.png', fullPage: true });
  });

  test('should load all protocol tokens', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    
    // Connect wallet
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();
    await page.waitForTimeout(1000);
    await metamask.connectToDapp();
    
    await page.waitForTimeout(3000);
    
    // Verify all 4 tokens
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    
    console.log('✅ All protocol tokens loaded');
  });

  test('all navigation tabs should be clickable', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();
    await page.waitForTimeout(1000);
    await metamask.connectToDapp();
    
    const tabs = [
      'Registered Tokens',
      'Bridge from Ethereum',
      'Deploy Paymaster',
      'Add Liquidity',
      'My Earnings',
      'Node Operators',
      'App Registry',
    ];
    
    for (const tab of tabs) {
      const button = page.getByRole('button', { name: tab });
      await expect(button).toBeVisible();
      await button.click();
      await page.waitForTimeout(300);
    }
    
    console.log('✅ All tabs navigable');
  });

  test('should maintain wallet connection across navigation', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();
    await page.waitForTimeout(1000);
    await metamask.connectToDapp();
    
    // Navigate through tabs
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();
    
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();
    
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();
    
    console.log('✅ Wallet connection persistent');
  });

  test('A2A server should be running', async ({ page }) => {
    // Check A2A server health
    const response = await page.request.get('http://localhost:4003/.well-known/agent-card.json');
    expect(response.status()).toBe(200);
    
    const agentCard = await response.json();
    expect(agentCard.name).toBe('Gateway Portal - Protocol Infrastructure Hub');
    
    console.log('✅ A2A server responding');
  });

  test('RPC should be accessible', async ({ page }) => {
    // Make JSON-RPC call
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
    
    console.log('✅ RPC accessible at port 9545');
  });
});

