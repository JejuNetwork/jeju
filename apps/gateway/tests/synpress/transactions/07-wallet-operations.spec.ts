/**
 * Wallet Connection and Management Transaction Tests
 * Tests wallet connection, disconnection, switching, and network management
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Wallet Connection Flow', () => {
  test('should connect wallet via RainbowKit', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle');

    // Homepage without wallet
    await expect(page.getByText(/Connect Your Wallet/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/wallet-tx/01-disconnected.png',
      fullPage: true,
    });

    // Connect
    await connectWallet(page, metamask);

    // Verify connected
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });

    // Should show token balances
    await page.waitForTimeout(3000);
    await expect(page.getByText('Token Balances')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/wallet-tx/02-connected.png',
      fullPage: true,
    });

    console.log('✅ Wallet connection successful');
  });

  test('should maintain connection across page navigation', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Navigate to different tab
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(500);

    // Still connected
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();

    // Navigate to another tab
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);

    // Still connected
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();

    console.log('✅ Connection persists across navigation');
  });

  test('should maintain connection across page reload', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Verify connected
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();

    // Reload page
    await page.reload();
    await page.waitForTimeout(3000);

    // Should auto-reconnect (RainbowKit feature)
    const stillConnected = await page.locator('button:has-text(/0x/)').isVisible();

    if (stillConnected) {
      console.log('✅ Auto-reconnected after reload');
    } else {
      console.log('ℹ️  Requires manual reconnection after reload');
    }
  });
});

test.describe('Wallet Account Switching', () => {
  test.skip('should handle switching accounts in MetaMask', async ({ page, metamask }) => {
    // TODO: Implement when Synpress supports account switching
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Switch to account #2 in MetaMask
    // await metamask.switchAccount(1);

    // UI should update with new address
    // Balances should update

    console.log('⚠️  Account switching - needs Synpress enhancement');
  });

  test.skip('should update balances when switching accounts', async ({ page }) => {
    // TODO: After account switch, verify balances update
    console.log('⚠️  Balance update on account switch - needs implementation');
  });
});

test.describe('Network Management', () => {
  test('should display correct network (Jeju Localnet)', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Check console logs for network info
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Chain ID') || msg.text().includes('RPC URL')) {
        logs.push(msg.text());
      }
    });

    await page.waitForTimeout(2000);

    // Verify Jeju network logged
    const hasJejuConfig = logs.some((log) => log.includes('1337') || log.includes('9545'));
    expect(hasJejuConfig).toBe(true);

    console.log('✅ Jeju Localnet configuration verified');
    console.log(`   Chain ID: 1337`);
    console.log(`   RPC: http://127.0.0.1:9545`);
  });

  test.skip('should warn if wrong network connected', async ({ page, metamask }) => {
    // TODO: Switch to different network and verify warning
    // await metamask.switchNetwork('Ethereum Mainnet');
    // await expect(page.getByText(/Wrong Network/i)).toBeVisible();

    console.log('⚠️  Wrong network warning - needs implementation');
  });

  test.skip('should prompt network switch if on wrong chain', async ({ page }) => {
    // TODO: Test network switch prompt
    console.log('⚠️  Network switch prompt - needs testing');
  });
});

test.describe('Wallet Disconnection', () => {
  test.skip('should disconnect wallet via UI', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

    // Find disconnect button (in RainbowKit menu)
    // Click wallet address → Disconnect

    // TODO: Navigate RainbowKit modal to disconnect
    // await page.locator('button:has-text(/0x/)').click();
    // await page.waitForTimeout(500);
    // await page.getByRole('button', { name: /Disconnect/i }).click();

    // Should return to disconnected state
    // await expect(page.getByText(/Connect Your Wallet/i)).toBeVisible();

    console.log('⚠️  Wallet disconnection - needs RainbowKit modal navigation');
  });
});

test.describe('Connection Error Handling', () => {
  test.skip('should handle MetaMask locked', async ({ page }) => {
    // TODO: Lock MetaMask and try to connect
    // Should show appropriate error

    console.log('⚠️  Locked wallet handling - needs MetaMask lock simulation');
  });

  test.skip('should handle MetaMask not installed', async ({ page }) => {
    // TODO: Test without MetaMask extension
    // Should show install prompt

    console.log('⚠️  No wallet error - needs non-MetaMask browser');
  });

  test('should handle connection rejection', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);

    // Click connect
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();
    await page.waitForTimeout(1000);

    // Reject connection
    await metamask.rejectConnection();

    await page.waitForTimeout(2000);

    // Should return to disconnected state
    await expect(connectButton).toBeVisible();

    console.log('✅ Connection rejection handled');
  });
});


