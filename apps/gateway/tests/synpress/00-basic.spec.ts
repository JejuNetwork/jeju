/**
 * Gateway Basic Tests - Standalone Synpress
 * Uses local Synpress installation only (no shared fixtures to avoid Playwright conflicts)
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Gateway Basic Tests', () => {
  test('complete smoke test', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // 1. Navigate to Gateway
    await page.goto('http://localhost:4001');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/screenshots/gateway/smoke/01-homepage.png', fullPage: true });
    await expect(page.getByText(/Gateway Portal/i)).toBeVisible();
    console.log('✅ 1/8: Homepage loaded');

    // 2. Connect wallet
    await page.locator('button:has-text("Connect")').first().click();
    await page.waitForTimeout(1000);
    await metamask.connectToDapp();
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/screenshots/gateway/smoke/02-wallet-connected.png', fullPage: true });
    console.log('✅ 2/8: Wallet connected');

    // 3. Verify tokens
    await page.waitForTimeout(3000);
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/gateway/smoke/03-tokens-loaded.png', fullPage: true });
    console.log('✅ 3/8: Tokens loaded');

    // 4-8. Navigate tabs
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.screenshot({ path: 'test-results/screenshots/gateway/smoke/04-bridge-tab.png', fullPage: true });
    console.log('✅ 4/8: Bridge');

    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.screenshot({ path: 'test-results/screenshots/gateway/smoke/05-liquidity-tab.png', fullPage: true });
    console.log('✅ 5/8: Liquidity');

    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.screenshot({ path: 'test-results/screenshots/gateway/smoke/06-nodes-tab.png', fullPage: true });
    console.log('✅ 6/8: Nodes');

    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.screenshot({ path: 'test-results/screenshots/gateway/smoke/07-registry-tab.png', fullPage: true });
    console.log('✅ 7/8: Registry');

    // Verify wallet still connected
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/gateway/smoke/08-final-state.png', fullPage: true });
    console.log('✅ 8/8: Connection persists');

    console.log('🎉 ALL CHECKS PASSED');
  });
});

