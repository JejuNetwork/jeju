// Import necessary Synpress modules
import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'

// Define a test seed phrase and password
const SEED_PHRASE = 'test test test test test test test test test test test junk'
const PASSWORD = 'Tester@1234'

// Define the basic wallet setup
export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  // Create a new MetaMask instance
  const metamask = new MetaMask(context, walletPage, PASSWORD)

  // Import the wallet using the seed phrase
  await metamask.importWallet(SEED_PHRASE)

  // Add Jeju Local network
  await metamask.addNetwork({
    name: 'Jeju Local',
    rpcUrl: 'http://localhost:9545',
    chainId: 1337,
    symbol: 'ETH',
  })

  // Switch to Jeju network
  await metamask.switchNetwork('Jeju Local')
})
