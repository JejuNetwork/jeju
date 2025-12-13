/**
 * Gateway Smoke Tests with Synpress
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Gateway Smoke Tests', () => {
  test('should connect to Gateway Portal', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Navigate to Gateway
    await page.goto('http://localhost:4001');
    await page.waitForLoadState('networkidle');

    // Verify page loaded
    await expect(page.getByText(/Gateway Portal/i)).toBeVisible();
    console.log('✅ 1/7: Homepage loaded');

    // Click Connect
    await page.locator('button:has-text("Connect")').first().click();
    await page.waitForTimeout(1000);

    // Connect MetaMask
    await metamask.connectToDapp();

    // Verify connected
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });
    console.log('✅ 2/7: Wallet connected');

    // Verify tokens load
    await page.waitForTimeout(3000);
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();
    console.log('✅ 3/7: All protocol tokens loaded');

    // Navigate tabs
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(500);
    console.log('✅ 4/7: Bridge tab');

    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(500);
    console.log('✅ 5/7: Liquidity tab');

    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    console.log('✅ 6/7: Node Operators tab');

    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);
    console.log('✅ 7/7: App Registry tab');

    // Wallet should still be connected
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();
    console.log('✅ SMOKE TEST PASSED');
  });

  test('should verify RPC connectivity', async ({ page }) => {
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

  test('should verify A2A server', async ({ page }) => {
    const response = await page.request.get('http://localhost:4003/.well-known/agent-card.json');
    expect(response.status()).toBe(200);
    
    const agentCard = await response.json();
    expect(agentCard.name).toBe('Gateway Portal - Protocol Infrastructure Hub');
    
    console.log('✅ A2A server responding');
  });
});

