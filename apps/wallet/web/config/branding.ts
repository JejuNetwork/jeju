/**
 * Browser-safe branding configuration
 *
 * Uses @jejunetwork/config for all configuration.
 */

import { getChainId, getRpcUrl, getServicesConfig } from '@jejunetwork/config'
import type { Chain } from 'viem'

// Network name constant
const NETWORK_NAME = 'Jeju'

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

// Pre-compute URLs from config
const mainnetServices = getServicesConfig('mainnet')
const testnetServices = getServicesConfig('testnet')

const URLS: UrlsBranding = {
  rpc: {
    mainnet: getRpcUrl('mainnet'),
    testnet: getRpcUrl('testnet'),
    localnet: getRpcUrl('localnet'),
  },
  gateway: mainnetServices.gateway?.api || 'https://compute.jejunetwork.org',
  indexer:
    mainnetServices.indexer?.graphql || 'https://indexer.jejunetwork.org',
  explorer: {
    mainnet: mainnetServices.explorer || 'https://explorer.jejunetwork.org',
    testnet:
      testnetServices.explorer || 'https://explorer.testnet.jejunetwork.org',
  },
}

/**
 * Get URLs configuration (browser-safe)
 */
export function getUrls(): UrlsBranding {
  return URLS
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

/**
 * Get the localnet chain definition (browser-safe)
 */
export function getLocalnetChain(): Chain {
  return {
    id: getChainId('localnet'),
    name: `${NETWORK_NAME} Localnet`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [URLS.rpc.localnet] },
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
  return {
    id: getChainId('testnet'),
    name: `${NETWORK_NAME} Testnet`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [URLS.rpc.testnet] },
    },
    blockExplorers: {
      default: {
        name: `${NETWORK_NAME} Testnet Explorer`,
        url: URLS.explorer.testnet,
      },
    },
  }
}

/**
 * Get the mainnet chain definition (browser-safe)
 */
export function getMainnetChain(): Chain {
  return {
    id: getChainId('mainnet'),
    name: `${NETWORK_NAME} Mainnet`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [URLS.rpc.mainnet] },
    },
    blockExplorers: {
      default: { name: `${NETWORK_NAME} Explorer`, url: URLS.explorer.mainnet },
    },
  }
}
