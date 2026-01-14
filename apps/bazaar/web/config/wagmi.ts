import {
  getChainId,
  getLocalhostHost,
  getRpcUrl,
  getServicesConfig,
  type NetworkType,
} from '@jejunetwork/config'
import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { NETWORK_NAME } from './index'

/**
 * Detect network from browser hostname at RUNTIME
 * This is critical for deployed apps where the build might have wrong env vars
 */
function detectNetworkRuntime(): NetworkType {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname

    // Localhost or local IP → localnet
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.')
    ) {
      return 'localnet'
    }

    // Check for localnet subdomain FIRST (before mainnet check)
    if (hostname.includes('.local.jejunetwork.org')) {
      return 'localnet'
    }

    // Check for testnet subdomain
    if (
      hostname.includes('.testnet.jejunetwork.org') ||
      hostname === 'testnet.jejunetwork.org'
    ) {
      return 'testnet'
    }

    // Production jejunetwork.org domains → mainnet (only if not localnet/testnet)
    if (hostname.endsWith('.jejunetwork.org')) {
      return 'mainnet'
    }
  }

  // Fallback to localnet for SSR or unknown
  return 'localnet'
}

// Detect network at RUNTIME, not build time
const RUNTIME_NETWORK = detectNetworkRuntime()
const RUNTIME_RPC_URL = getRpcUrl(RUNTIME_NETWORK)

const services = getServicesConfig(RUNTIME_NETWORK)

const localnet = defineChain({
  id: getChainId('localnet'),
  name: `${NETWORK_NAME} Localnet`,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [getRpcUrl('localnet')],
    },
  },
  blockExplorers: {
    default: {
      name: `${NETWORK_NAME} Explorer`,
      url: services.explorer || `http://${getLocalhostHost()}:4000`,
    },
  },
  testnet: true,
})

const mainnetServices = getServicesConfig('mainnet')
const testnetServices = getServicesConfig('testnet')

const mainnet = defineChain({
  id: getChainId('mainnet'),
  name: `${NETWORK_NAME} Mainnet`,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [getRpcUrl('mainnet')],
    },
  },
  blockExplorers: {
    default: {
      name: `${NETWORK_NAME} Explorer`,
      url: mainnetServices.explorer || 'https://explorer.jejunetwork.org',
    },
  },
})

const testnet = defineChain({
  id: getChainId('testnet'),
  name: `${NETWORK_NAME} Testnet`,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [getRpcUrl('testnet')],
    },
  },
  blockExplorers: {
    default: {
      name: `${NETWORK_NAME} Testnet Explorer`,
      url:
        testnetServices.explorer || 'https://testnet-explorer.jejunetwork.org',
    },
  },
  testnet: true,
})

const activeChain =
  RUNTIME_NETWORK === 'mainnet'
    ? mainnet
    : RUNTIME_NETWORK === 'testnet'
      ? testnet
      : localnet

// Include all chains so wagmi can properly detect the connected chain
// This ensures chain detection works correctly even when MetaMask is on a different chain initially
const allChains = [localnet, testnet, mainnet]

export const wagmiConfig = createConfig({
  chains: allChains,
  connectors: [
    injected({
      shimDisconnect: true, // Enable shim disconnect to prevent caching issues
    }),
  ],
  transports: {
    [localnet.id]: http(getRpcUrl('localnet'), {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
    [testnet.id]: http(getRpcUrl('testnet'), {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
    [mainnet.id]: http(getRpcUrl('mainnet'), {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
  ssr: true,
  // Disable auto-connect to prevent connecting to wrong account
  // Users must explicitly connect with the account they want to use
  // This prevents issues where wagmi caches a different account than MetaMask's current selection
})

// Export for OAuth3 provider
export const chainId = activeChain.id
export const rpcUrl = RUNTIME_RPC_URL
