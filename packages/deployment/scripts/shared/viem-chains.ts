/**
 * Jeju viem chain definitions for deploy scripts
 *
 * Use these chains for ALL deployments to Jeju L2.
 * Base/Optimism/Arbitrum chains should only be used for cross-chain contracts (EIL, OIF).
 */

import type {
  Account,
  Chain,
  PublicClient,
  Transport,
  WalletClient,
} from 'viem'
import { sepolia } from 'viem/chains'

// Client Type Aliases

/**
 * Type alias for PublicClient that works with any chain.
 * Use this instead of ReturnType<typeof createPublicClient> for better type inference.
 */
export type DeployPublicClient = PublicClient<Transport, Chain>

/**
 * Type alias for WalletClient that works with any chain + account.
 * Use this instead of ReturnType<typeof createWalletClient> for better type inference.
 */
export type DeployWalletClient = WalletClient<Transport, Chain, Account>

// Jeju L2 Chains (PRIMARY - deploy apps here)

/** Jeju Testnet - L2 rolling up to Sepolia */
export const jejuTestnet: Chain = {
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jejunetwork.org'] },
    public: { http: ['https://testnet-rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: {
      name: 'Jeju Explorer',
      url: 'https://testnet-explorer.jejunetwork.org',
    },
  },
  testnet: true,
}

/** Jeju Mainnet - L2 rolling up to Ethereum */
export const jejuMainnet: Chain = {
  id: 420691,
  name: 'Jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.jejunetwork.org'] },
    public: { http: ['https://rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: { name: 'Jeju Explorer', url: 'https://explorer.jejunetwork.org' },
  },
}

/** Jeju Localnet - for local development */
export const jejuLocalnet: Chain = {
  id: 31337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:6546'] },
  },
  testnet: true,
}

// Chain Selection Helpers

export type JejuNetwork = 'localnet' | 'testnet' | 'mainnet'

/**
 * Get the Jeju chain for a network type
 * This is the PRIMARY function to use for deployments
 */
export function getJejuChain(network: JejuNetwork): Chain {
  switch (network) {
    case 'mainnet':
      return jejuMainnet
    case 'testnet':
      return jejuTestnet
    case 'localnet':
      return jejuLocalnet
  }
}

/**
 * Get the L1 chain for a Jeju network
 * Testnet/localnet uses Sepolia, mainnet uses Ethereum
 */
export function getL1Chain(network: JejuNetwork): Chain {
  if (network === 'mainnet') {
    // Ethereum mainnet - import from viem if needed
    return {
      id: 1,
      name: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: ['https://eth.llamarpc.com'] },
      },
      blockExplorers: {
        default: { name: 'Etherscan', url: 'https://etherscan.io' },
      },
    }
  }
  return sepolia
}

/**
 * Get RPC URL for a Jeju network with env override support
 */
export function getJejuRpcUrl(network: JejuNetwork): string {
  // Check env overrides first
  const envKey =
    network === 'mainnet'
      ? 'JEJU_RPC_URL'
      : network === 'testnet'
        ? 'JEJU_TESTNET_RPC_URL'
        : 'RPC_URL'

  const envUrl = process.env[envKey] || process.env.JEJU_RPC_URL
  if (envUrl) return envUrl

  // Use chain defaults
  const chain = getJejuChain(network)
  return chain.rpcUrls.default.http[0]
}

/**
 * Get L1 RPC URL for a Jeju network with env override support
 */
export function getL1RpcUrl(network: JejuNetwork): string {
  const envUrl = process.env.L1_RPC_URL || process.env.SEPOLIA_RPC_URL
  if (envUrl) return envUrl

  if (network === 'mainnet') {
    return process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com'
  }
  return 'https://ethereum-sepolia-rpc.publicnode.com'
}

// Chain ID Constants

export const JEJU_CHAIN_IDS = {
  localnet: 31337,
  testnet: 420690,
  mainnet: 420691,
} as const

export const L1_CHAIN_IDS = {
  localnet: 11155111, // Sepolia
  testnet: 11155111, // Sepolia
  mainnet: 1, // Ethereum
} as const
