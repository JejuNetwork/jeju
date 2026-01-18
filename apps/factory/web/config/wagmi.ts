/**
 * Decentralized wagmi configuration
 *
 * Uses only injected wallets (MetaMask, etc.) without WalletConnect or other
 * centralized dependencies. No project IDs or external services required.
 */

import { getL2RpcUrl } from '@jejunetwork/config'
import {
  type ChainConfig,
  createDecentralizedWagmiConfig,
} from '@jejunetwork/ui'

// Network configurations
const NETWORK_CONFIGS: Record<string, ChainConfig> = {
  localnet: {
    id: 31337,
    name: 'Jeju Localnet',
    rpcUrl: getL2RpcUrl(),
    testnet: true,
  },
  testnet: {
    id: 8004,
    name: 'Jeju Testnet',
    rpcUrl: 'https://testnet-rpc.jejunetwork.io',
    blockExplorers: {
      default: {
        name: 'Explorer',
        url: 'https://testnet-explorer.jejunetwork.io',
      },
    },
    testnet: true,
  },
  mainnet: {
    id: 8004,
    name: 'Jeju Network',
    rpcUrl: 'https://rpc.jejunetwork.io',
    blockExplorers: {
      default: { name: 'Explorer', url: 'https://explorer.jejunetwork.io' },
    },
    testnet: false,
  },
}

type NetworkType = keyof typeof NETWORK_CONFIGS

function detectNetwork(): NetworkType {
  if (typeof window === 'undefined') return 'localnet'
  const hostname = window.location.hostname
  if (hostname.includes('testnet') || hostname.includes('sepolia'))
    return 'testnet'
  if (
    hostname === 'factory.jejunetwork.org' ||
    hostname === 'factory.jejunetwork.org'
  )
    return 'mainnet'
  return 'localnet'
}

const network = detectNetwork()
const chainConfig = NETWORK_CONFIGS[network]

// Create decentralized config - no WalletConnect, no external dependencies
export const wagmiConfig = createDecentralizedWagmiConfig({
  chains: [chainConfig],
  appName: 'Factory',
})

export const CHAIN_ID = chainConfig.id
export const RPC_URL = chainConfig.rpcUrl

export function getChainId(): number {
  return CHAIN_ID
}
