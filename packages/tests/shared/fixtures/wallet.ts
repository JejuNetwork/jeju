import { test as base } from '@playwright/test'
import { bootstrap, type Dappwright, getWallet } from '@tenkeylabs/dappwright'
import type { BrowserContext } from 'playwright-core'
import {
  JEJU_CHAIN,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  PASSWORD,
  SEED_PHRASE,
  TEST_ACCOUNTS,
} from '../utils'

/**
 * Shared wallet fixture configuration for network
 *
 * This provides standardized wallet testing across all network apps.
 * Uses @tenkeylabs/dappwright with Playwright's fixture system.
 */

export const JEJU_TEST_WALLET = {
  seed: SEED_PHRASE,
  password: PASSWORD,
  address: TEST_ACCOUNTS.deployer.address,
  privateKey: TEST_ACCOUNTS.deployer.privateKey,
} as const

import { getChainId, getL2RpcUrl } from '@jejunetwork/config'

export const JEJU_NETWORK = {
  name: JEJU_CHAIN.name,
  networkName: JEJU_CHAIN.name,
  rpcUrl:
    (typeof process !== 'undefined' ? process.env.L2_RPC_URL : undefined) ||
    (typeof process !== 'undefined' ? process.env.JEJU_RPC_URL : undefined) ||
    getL2RpcUrl() ||
    JEJU_RPC_URL,
  chainId: parseInt(
    (typeof process !== 'undefined' ? process.env.CHAIN_ID : undefined) ??
      String(getChainId() ?? JEJU_CHAIN_ID),
    10,
  ),
  symbol: JEJU_CHAIN.symbol,
} as const

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
    async (_fixtures, use, _info) => {
      // Bootstrap wallet with MetaMask extension
      const [wallet, _, context] = await bootstrap('', {
        wallet: 'metamask',
        version: '11.16.17',
        seed: JEJU_TEST_WALLET.seed,
        headless: false, // MetaMask requires headful mode
      })

      // Add network to MetaMask
      await wallet.addNetwork({
        networkName: JEJU_NETWORK.networkName,
        rpc: JEJU_NETWORK.rpcUrl,
        chainId: JEJU_NETWORK.chainId,
        symbol: JEJU_NETWORK.symbol,
      })

      // Switch to the network network
      await wallet.switchNetwork(JEJU_NETWORK.networkName)

      await use(context)
      await context.close()
    },
    { scope: 'worker' }, // Reuse wallet across all tests in worker
  ],

  context: async ({ walletContext }, use) => {
    await use(walletContext)
  },

  wallet: async ({ walletContext }, use) => {
    const wallet = await getWallet('metamask', walletContext)
    await use(wallet)
  },
})

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
    const connectButton = page.locator('button:has-text("Connect")')
    const isVisible = await connectButton.isVisible({ timeout: 5000 })

    if (isVisible) {
      await connectButton.click()

      // Wait for MetaMask option
      await page.waitForSelector('text="MetaMask"', { timeout: 3000 })
      await page.click('text="MetaMask"')

      // Approve in MetaMask
      await wallet.approve()

      // Wait for connection success
      // Look for connected indicator (address, balance, etc.)
      await page.waitForSelector(
        '[data-connected="true"], button:has-text(/0x/)',
        {
          timeout: 10000,
        },
      )

      console.log('✅ Wallet auto-connected successfully')
    } else {
      // Check if wallet is already connected (no connect button visible)
      const alreadyConnected = await page
        .locator('[data-connected="true"], button:has-text(/0x/)')
        .isVisible({ timeout: 2000 })
      if (!alreadyConnected) {
        throw new Error(
          'No connect button found and wallet does not appear connected',
        )
      }
      console.log('✅ Wallet already connected')
    }

    await use(page)
  },
})

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
  customPrivateKey: async (_fixtures, use) => {
    // Override this in your test file
    await use('')
  },

  walletContext: [
    async (_fixtures, use) => {
      const [wallet, _, context] = await bootstrap('', {
        wallet: 'metamask',
        version: '11.16.17',
        seed: JEJU_TEST_WALLET.seed,
        headless: false,
      })

      // Add network
      await wallet.addNetwork({
        networkName: JEJU_NETWORK.networkName,
        rpc: JEJU_NETWORK.rpcUrl,
        chainId: JEJU_NETWORK.chainId,
        symbol: JEJU_NETWORK.symbol,
      })

      await wallet.switchNetwork(JEJU_NETWORK.networkName)

      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],

  context: async (
    { walletContext }: { walletContext: BrowserContext },
    use,
  ) => {
    await use(walletContext)
  },

  wallet: async (
    {
      walletContext,
      customPrivateKey,
    }: { walletContext: BrowserContext; customPrivateKey: string },
    use,
  ) => {
    const wallet = await getWallet('metamask', walletContext)

    // Import custom account if provided
    if (customPrivateKey) {
      await wallet.importPK(customPrivateKey)
    }

    await use(wallet)
  },
})
