/**
 * Browser-safe branding configuration
 *
 * Uses @jejunetwork/config for defaults with PUBLIC_ env overrides.
 * All public env vars use PUBLIC_ prefix (not VITE_).
 */

import {
  getChainId as getConfigChainId,
  getRpcUrl as getConfigRpcUrl,
  getServicesConfig,
} from '@jejunetwork/config'
import type { Chain } from 'viem'

/** Get env var from import.meta.env (browser) or process.env (node) */
function getEnv(key: string): string | undefined {
  if (typeof import.meta?.env === 'object') {
    return import.meta.env[key] as string | undefined
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key]
  }
  return undefined
}

/** Get env var with fallback */
function getEnvOrDefault(key: string, fallback: string): string {
  return getEnv(key) || fallback
}

// Network name from environment or default
const NETWORK_NAME = getEnvOrDefault('PUBLIC_NETWORK_NAME', 'Jeju')

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
 * Uses @jejunetwork/config for defaults with PUBLIC_ env overrides.
 */
export function getUrls(): UrlsBranding {
  const mainnetServices = getServicesConfig('mainnet')
  const testnetServices = getServicesConfig('testnet')

  return {
    rpc: {
      mainnet: getEnv('PUBLIC_RPC_MAINNET') || getConfigRpcUrl('mainnet'),
      testnet: getEnv('PUBLIC_RPC_TESTNET') || getConfigRpcUrl('testnet'),
      localnet: getEnv('PUBLIC_RPC_LOCALNET') || getConfigRpcUrl('localnet'),
    },
    gateway:
      getEnv('PUBLIC_GATEWAY_URL') ||
      mainnetServices.gateway?.api ||
      'https://compute.jejunetwork.org',
    indexer:
      getEnv('PUBLIC_INDEXER_URL') ||
      mainnetServices.indexer?.graphql ||
      'https://indexer.jejunetwork.org',
    explorer: {
      mainnet:
        getEnv('PUBLIC_EXPLORER_MAINNET') ||
        mainnetServices.explorer ||
        'https://explorer.jejunetwork.org',
      testnet:
        getEnv('PUBLIC_EXPLORER_TESTNET') ||
        testnetServices.explorer ||
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
  const urls = getUrls()
  return {
    id: getConfigChainId('localnet'),
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
    id: getConfigChainId('testnet'),
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
    id: getConfigChainId('mainnet'),
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
