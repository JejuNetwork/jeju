/**
 * Browser-safe branding configuration
 *
 * This provides wallet-specific branding that doesn't rely on Node.js modules.
 * For browser builds, we use environment variables or defaults.
 */

// Network name from environment or default
const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME || 'Jeju'

// URLs from environment or defaults
const RPC_MAINNET =
  import.meta.env.VITE_RPC_MAINNET || 'https://rpc.jejunetwork.org'
const RPC_TESTNET =
  import.meta.env.VITE_RPC_TESTNET || 'https://rpc.testnet.jejunetwork.org'
const RPC_LOCALNET =
  import.meta.env.VITE_RPC_LOCALNET || 'http://localhost:6546'

export interface UrlsBranding {
  rpc: {
    mainnet: string
    testnet: string
    localnet: string
  }
  gateway: string
  indexer: string
  explorer: {
    mainnet: string
    testnet: string
  }
}

/**
 * Get the network name (browser-safe)
 */
export function getNetworkName(): string {
  return NETWORK_NAME
}

/**
 * Get the network display name
 */
export function getNetworkDisplayName(): string {
  return `the ${NETWORK_NAME} network`
}

/**
 * Get URLs configuration (browser-safe)
 */
export function getUrls(): UrlsBranding {
  return {
    rpc: {
      mainnet: RPC_MAINNET,
      testnet: RPC_TESTNET,
      localnet: RPC_LOCALNET,
    },
    gateway:
      import.meta.env.VITE_JEJU_GATEWAY_URL ||
      'https://compute.jejunetwork.org',
    indexer:
      import.meta.env.VITE_JEJU_INDEXER_URL ||
      'https://indexer.jejunetwork.org',
    explorer: {
      mainnet:
        import.meta.env.VITE_EXPLORER_MAINNET ||
        'https://explorer.jejunetwork.org',
      testnet:
        import.meta.env.VITE_EXPLORER_TESTNET ||
        'https://explorer.testnet.jejunetwork.org',
    },
  }
}

/**
 * Get RPC URL for a specific chain (browser-safe)
 */
export function getBrandingRpcUrl(chainId: number): string {
  const urls = getUrls()

  // Map chain IDs to RPC URLs
  switch (chainId) {
    // Mainnet chains
    case 1: // Ethereum
      return `${urls.rpc.mainnet}/eth`
    case 8453: // Base
      return `${urls.rpc.mainnet}/base`
    case 42161: // Arbitrum
      return `${urls.rpc.mainnet}/arbitrum`
    case 10: // Optimism
      return `${urls.rpc.mainnet}/optimism`
    case 56: // BSC
      return `${urls.rpc.mainnet}/bsc`
    case 137: // Polygon
      return `${urls.rpc.mainnet}/polygon`

    // Testnet
    case 84532: // Base Sepolia
      return urls.rpc.testnet

    // Localnet
    case 1337:
    case 31337:
      return urls.rpc.localnet

    // Network L2
    case 420690: // Testnet
      return urls.rpc.testnet
    case 420691: // Mainnet
      return urls.rpc.mainnet

    default:
      return urls.rpc.mainnet
  }
}

import type { Chain } from 'viem'

/**
 * Get the localnet chain definition (browser-safe)
 */
export function getLocalnetChain(): Chain {
  const urls = getUrls()
  return {
    id: 1337,
    name: `${NETWORK_NAME} Localnet`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [urls.rpc.localnet] },
    },
    blockExplorers: {
      default: { name: 'Local Explorer', url: 'http://localhost:4000' },
    },
  }
}

/**
 * Get the testnet chain definition (browser-safe)
 */
export function getTestnetChain(): Chain {
  const urls = getUrls()
  return {
    id: 420690,
    name: `${NETWORK_NAME} Testnet`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [urls.rpc.testnet] },
    },
    blockExplorers: {
      default: {
        name: `${NETWORK_NAME} Testnet Explorer`,
        url: urls.explorer.testnet,
      },
    },
  }
}

/**
 * Get the mainnet chain definition (browser-safe)
 */
export function getMainnetChain(): Chain {
  const urls = getUrls()
  return {
    id: 420691,
    name: `${NETWORK_NAME} Mainnet`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [urls.rpc.mainnet] },
    },
    blockExplorers: {
      default: { name: `${NETWORK_NAME} Explorer`, url: urls.explorer.mainnet },
    },
  }
}
