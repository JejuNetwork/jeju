/**
 * Decentralized-first wagmi configuration
 *
 * This config uses ONLY injected wallets (MetaMask, etc.) without any
 * centralized dependencies like WalletConnect or external project IDs.
 *
 * For apps that need wallet connection without centralized dependencies,
 * use this instead of RainbowKit's getDefaultConfig.
 */

import { getL2RpcUrl } from '@jejunetwork/config'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'

export interface ChainConfig {
  id: number
  name: string
  rpcUrl: string
  nativeCurrency?: {
    name: string
    symbol: string
    decimals: number
  }
  blockExplorers?: {
    default: { name: string; url: string }
  }
  testnet?: boolean
}

export interface CreateWagmiConfigOptions {
  chains: ChainConfig[]
  appName?: string
}

/**
 * Creates a wagmi config with only injected wallet support
 * No WalletConnect, no centralized dependencies
 */
export function createDecentralizedWagmiConfig({
  chains,
  appName = 'Jeju Network',
}: CreateWagmiConfigOptions) {
  if (chains.length === 0) {
    throw new Error('At least one chain config is required')
  }

  // Convert chain configs to wagmi chain format
  const wagmiChains = chains.map((chain) => ({
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency ?? {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [chain.rpcUrl] },
      public: { http: [chain.rpcUrl] },
    },
    blockExplorers: chain.blockExplorers,
    testnet: chain.testnet,
  }))

  // Build transports map
  const transports: Record<number, ReturnType<typeof http>> = {}
  for (const chain of chains) {
    transports[chain.id] = http(chain.rpcUrl)
  }

  return createConfig({
    chains: wagmiChains as [(typeof wagmiChains)[0], ...typeof wagmiChains],
    connectors: [
      injected({
        shimDisconnect: true,
        target: {
          id: 'injected',
          name: appName,
          provider: typeof window !== 'undefined' ? window.ethereum : undefined,
        },
      }),
    ],
    transports,
    ssr: false,
  })
}

/**
 * Default Jeju chain configurations
 */
export const JEJU_CHAINS = {
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
} as const satisfies Record<string, ChainConfig>

/**
 * Ethereum mainnet for ENS resolution (optional, can be excluded for fully decentralized setup)
 */
export const ETHEREUM_MAINNET: ChainConfig = {
  id: 1,
  name: 'Ethereum',
  rpcUrl: 'https://eth.merkle.io',
  testnet: false,
}
