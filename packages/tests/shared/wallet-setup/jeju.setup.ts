/**
 * Unified Wallet Setup for All Jeju Apps
 *
 * This is the CANONICAL wallet setup that all apps should use.
 * It imports configuration from the shared synpress.config.base.ts
 * to ensure consistency across all E2E tests.
 *
 * Usage in app's wallet-setup/basic.setup.ts:
 * ```typescript
 * export { basicSetup as default, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests';
 * ```
 *
 * Or import in app synpress.config.ts:
 * ```typescript
 * import { createSynpressConfig, createWalletSetup, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests';
 * export default createSynpressConfig({ appName: 'myapp', port: 3000 });
 * export const basicSetup = createWalletSetup();
 * export { PASSWORD, SEED_PHRASE };
 * ```
 *
 * CLI commands:
 * ```bash
 * # Build wallet cache (do this once)
 * jeju test e2e --build-cache
 *
 * # Run e2e tests for an app
 * jeju test e2e --app myapp
 *
 * # Run all e2e tests
 * jeju test e2e
 * ```
 */

import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'
import { JEJU_CHAIN, PASSWORD, SEED_PHRASE } from '../utils'

/**
 * Default wallet setup for Jeju testing.
 *
 * This setup:
 * 1. Imports the standard test wallet using Anvil's default seed phrase
 * 2. Adds the Jeju Localnet network (chainId 1337)
 * 3. Switches to the Jeju network
 *
 * The test wallet address will be: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 */
export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)

  // Import the standard test wallet
  console.log('[Jeju Wallet Setup] Importing wallet...')
  await metamask.importWallet(SEED_PHRASE)

  // Add the Jeju Localnet network
  console.log(
    `[Jeju Wallet Setup] Adding network: ${JEJU_CHAIN.name} (chainId: ${JEJU_CHAIN.chainId})`,
  )
  await metamask.addNetwork({
    name: JEJU_CHAIN.name,
    rpcUrl: JEJU_CHAIN.rpcUrl,
    chainId: JEJU_CHAIN.chainId,
    symbol: JEJU_CHAIN.symbol,
  })

  // Switch to the Jeju network
  console.log(`[Jeju Wallet Setup] Switching to network: ${JEJU_CHAIN.name}`)
  await metamask.switchNetwork(JEJU_CHAIN.name)

  console.log('[Jeju Wallet Setup] Complete')
})
