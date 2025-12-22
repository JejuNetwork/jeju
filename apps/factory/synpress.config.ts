/**
 * Synpress Configuration
 * Wallet setup for E2E tests
 */

import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'

const SEED_PHRASE =
  'test test test test test test test test test test test junk'
const PASSWORD = 'Tester@1234'

export const basicSetup = defineWalletSetup(
  PASSWORD,
  async (context, walletPage) => {
    const metamask = new MetaMask(context, walletPage, PASSWORD)

    await metamask.importWallet(SEED_PHRASE)

    await metamask.addNetwork({
      name: 'Jeju Localnet',
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      symbol: 'ETH',
    })
  },
)

export default basicSetup
