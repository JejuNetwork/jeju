import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'

const PASSWORD = 'Tester@1234'
const SEED_PHRASE = 'test test test test test test test test test test test junk'
const JEJU_CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337')
const JEJU_RPC_URL = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545'

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)

  await metamask.importWallet(SEED_PHRASE)

  await metamask.addNetwork({
    name: 'Jeju Local',
    rpcUrl: JEJU_RPC_URL,
    chainId: JEJU_CHAIN_ID,
    symbol: 'ETH',
  })

  await metamask.switchNetwork('Jeju Local')
})

export { PASSWORD, SEED_PHRASE }

