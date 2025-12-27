import { JEJU_CHAIN, PASSWORD, SEED_PHRASE } from '@jejunetwork/tests'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { defineWalletSetup } from '@synthetixio/synpress'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { MetaMask } from '@synthetixio/synpress/playwright'

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)

  // Import wallet
  await metamask.importWallet(SEED_PHRASE)

  // Add and switch to Jeju localnet
  await metamask.addNetwork({
    name: JEJU_CHAIN.name,
    rpcUrl: JEJU_CHAIN.rpcUrl,
    chainId: JEJU_CHAIN.chainId,
    symbol: JEJU_CHAIN.symbol,
    blockExplorerUrl: JEJU_CHAIN.blockExplorerUrl || '',
  })
  await metamask.switchNetwork(JEJU_CHAIN.name)
})

export { PASSWORD }

