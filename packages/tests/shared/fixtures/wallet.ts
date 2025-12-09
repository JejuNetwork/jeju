import { test as base } from '@playwright/test';
import { BrowserContext } from 'playwright-core';
import { bootstrap, Dappwright, getWallet } from '@tenkeylabs/dappwright';

/**
 * Shared wallet fixture configuration for Jeju network
 *
 * This provides standardized wallet testing across all Jeju apps.
 * Uses @tenkeylabs/dappwright with Playwright's fixture system.
 */

export const JEJU_TEST_WALLET = {
  seed: 'test test test test test test test test test test test junk',
  password: 'Tester@1234',
  // Hardhat/Anvil default account
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

export const JEJU_NETWORK = {
  networkName: 'Jeju Local',
  rpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545',
  chainId: parseInt(process.env.CHAIN_ID || '1337'),
  symbol: 'ETH',
};

/**
 * Extended Playwright test with wallet fixture
 *
 * Usage:
 * ```typescript
 * import { testWithWallet as test } from '@/tests/shared/fixtures/wallet';
 *
 * test('should connect wallet', async ({ wallet, page }) => {
 *   await page.goto('http://localhost:4005');
 *   await page.click('#connect-button');
 *   await wallet.approve();
 *   await expect(page.getByText(/0x/)).toBeVisible();
 * });
 * ```
 */
export const testWithWallet = base.extend<
  { wallet: Dappwright },
  { walletContext: BrowserContext }
>({
  walletContext: [
    async ({}, use, info) => {
      // Bootstrap wallet with MetaMask extension
      const [wallet, _, context] = await bootstrap("", {
        wallet: "metamask",
        version: "11.16.17",
        seed: JEJU_TEST_WALLET.seed,
        headless: false, // MetaMask requires headful mode
      });

      // Add Jeju network to MetaMask
      await wallet.addNetwork({
        networkName: JEJU_NETWORK.networkName,
        rpc: JEJU_NETWORK.rpcUrl,
        chainId: JEJU_NETWORK.chainId,
        symbol: JEJU_NETWORK.symbol,
      });

      // Switch to Jeju network
      await wallet.switchNetwork(JEJU_NETWORK.networkName);

      await use(context);
      await context.close();
    },
    { scope: 'worker' }, // Reuse wallet across all tests in worker
  ],

  context: async ({ walletContext }, use) => {
    await use(walletContext);
  },

  wallet: async ({ walletContext }, use) => {
    const wallet = await getWallet("metamask", walletContext);
    await use(wallet);
  },
});

/**
 * Test with wallet that auto-connects to the app
 *
 * This is a convenience fixture that automatically connects the wallet
 * to your dApp, saving boilerplate in every test.
 *
 * Usage for apps with RainbowKit/wagmi:
 * ```typescript
 * import { testWithConnectedWallet as test } from '@/tests/shared/fixtures/wallet';
 *
 * test('should trade', async ({ wallet, page }) => {
 *   // Wallet is already connected to the app
 *   await page.getByText('Your Balance').isVisible();
 * });
 * ```
 */
export const testWithConnectedWallet = testWithWallet.extend({
  page: async ({ page, wallet }, use) => {
    // Auto-connect wallet to app
    // This assumes a "Connect" button exists
    try {
      // Wait for connect button
      const connectButton = page.locator('button:has-text("Connect")');
      const isVisible = await connectButton.isVisible({ timeout: 5000 });

      if (isVisible) {
        await connectButton.click();

        // Wait for MetaMask option
        await page.waitForSelector('text="MetaMask"', { timeout: 3000 });
        await page.click('text="MetaMask"');

        // Approve in MetaMask
        await wallet.approve();

        // Wait for connection success
        // Look for connected indicator (address, balance, etc.)
        await page.waitForSelector('[data-connected="true"], button:has-text(/0x/)', {
          timeout: 10000,
        });

        console.log('✅ Wallet auto-connected successfully');
      }
    } catch (e) {
      console.warn('Auto-connect failed or wallet already connected:', e);
      // Continue anyway - wallet might already be connected
    }

    await use(page);
  },
});

/**
 * Test fixture with custom wallet (non-default account)
 *
 * Usage for testing with different accounts (e.g., agent wallets):
 * ```typescript
 * import { testWithCustomWallet as test } from '@/tests/shared/fixtures/wallet';
 *
 * test.use({ customPrivateKey: '0x...' });
 * test('agent should place bet', async ({ wallet, page }) => {
 *   // Use wallet fixture with custom account
 * });
 * ```
 */
export const testWithCustomWallet = base.extend<
  { wallet: Dappwright; customPrivateKey: string },
  { walletContext: BrowserContext }
>({
  customPrivateKey: async ({}, use) => {
    // Override this in your test file
    await use('');
  },

  walletContext: [
    async ({}, use) => {
      const [wallet, _, context] = await bootstrap("", {
        wallet: "metamask",
        version: "11.16.17",
        seed: JEJU_TEST_WALLET.seed,
        headless: false,
      });

      // Add Jeju network
      await wallet.addNetwork({
        networkName: JEJU_NETWORK.networkName,
        rpc: JEJU_NETWORK.rpcUrl,
        chainId: JEJU_NETWORK.chainId,
        symbol: JEJU_NETWORK.symbol,
      });

      await wallet.switchNetwork(JEJU_NETWORK.networkName);

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  context: async ({ walletContext }: { walletContext: BrowserContext }, use) => {
    await use(walletContext);
  },

  wallet: async ({ walletContext, customPrivateKey }: { walletContext: BrowserContext; customPrivateKey: string }, use) => {
    const wallet = await getWallet("metamask", walletContext);
    
    // Import custom account if provided
    if (customPrivateKey) {
      await wallet.importPK(customPrivateKey);
    }
    
    await use(wallet);
  },
});
