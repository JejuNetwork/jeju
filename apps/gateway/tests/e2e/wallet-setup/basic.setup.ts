/**
 * Gateway Wallet Setup - Uses shared Jeju test configuration
 */

import { JEJU_CHAIN, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests'
import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)
  await metamask.importWallet(SEED_PHRASE)
  await metamask.addNetwork({
    name: JEJU_CHAIN.name,
    rpcUrl: JEJU_CHAIN.rpcUrl,
    chainId: JEJU_CHAIN.chainId,
    symbol: JEJU_CHAIN.symbol,
  })
  await metamask.switchNetwork(JEJU_CHAIN.name)
})

export { PASSWORD, SEED_PHRASE, JEJU_CHAIN }
