/**
 * Decentralized wagmi configuration
 *
 * Uses only injected wallets (MetaMask, etc.) without WalletConnect
 * or other centralized dependencies.
 */

import { createDecentralizedWagmiConfig } from '@jejunetwork/ui'
import { CHAIN_ID, NETWORK, RPC_URL } from './config'

const jejuChain = {
  id: CHAIN_ID,
  name:
    NETWORK === 'mainnet'
      ? 'Jeju Network'
      : NETWORK === 'testnet'
        ? 'Jeju Testnet'
        : 'Jeju Localnet',
  rpcUrl: RPC_URL,
  testnet: NETWORK !== 'mainnet',
}

// Create decentralized config - no WalletConnect, no external dependencies
const config = createDecentralizedWagmiConfig({
  chains: [jejuChain],
  appName: 'Gateway',
})

export function getConfig() {
  return config
}

export { jejuChain, config }
