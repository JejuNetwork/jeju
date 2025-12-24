import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'

const SEED_PHRASE =
  'test test test test test test test test test test test junk'
const PASSWORD = 'Tester@1234'

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)
  await metamask.importWallet(SEED_PHRASE)

  await metamask.addNetwork({
    name: 'Jeju Localnet',
    rpcUrl: 'http://127.0.0.1:6546',
    chainId: 1337,
    symbol: 'ETH',
  })
})
