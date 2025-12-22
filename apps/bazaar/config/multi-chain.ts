import {
  CORE_PORTS,
  getExplorerUrl,
  getL2RpcUrl,
  INFRA_PORTS,
} from '@jejunetwork/config/ports'
import { type Chain, defineChain } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { NETWORK_NAME } from './index'

const networkName = NETWORK_NAME

// Chain IDs const for type safety
export const EvmChainIds = {
  EthereumMainnet: 1,
  EthereumSepolia: 11155111,
  mainnetChain: 420691,
  testnetChain: 420690,
  localnetChain: 1337,
} as const
export type EvmChainIds = (typeof EvmChainIds)[keyof typeof EvmChainIds]

export const SolanaNetworkIds = {
  Mainnet: 101,
  Devnet: 103,
} as const
export type SolanaNetworkIds =
  (typeof SolanaNetworkIds)[keyof typeof SolanaNetworkIds]

// network chain definitions
export const jejuMainnet = defineChain({
  id: 420691,
  name: 'Network',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: {
      name: 'Network Explorer',
      url: 'https://explorer.jejunetwork.org',
    },
  },
})

export const jejuTestnet = defineChain({
  id: 420690,
  name: 'Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: {
      name: 'Network Testnet Explorer',
      url: 'https://testnet-explorer.jejunetwork.org',
    },
  },
  testnet: true,
})

export const jejuLocalnet = defineChain({
  id: 1337,
  name: `${networkName} Localnet`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.PUBLIC_JEJU_RPC_URL ||
          getL2RpcUrl() ||
          `http://localhost:${INFRA_PORTS.L2_RPC.DEFAULT}`,
      ],
    },
  },
  blockExplorers: {
    default: {
      name: `${networkName} Explorer`,
      url:
        process.env.PUBLIC_EXPLORER_URL ||
        getExplorerUrl() ||
        `http://localhost:${CORE_PORTS.EXPLORER.DEFAULT}`,
    },
  },
  testnet: true,
})

// Chain ID to Viem Chain mapping
export const CHAINID_TO_VIEM_CHAIN: Record<EvmChainIds, Chain> = {
  [EvmChainIds.EthereumMainnet]: mainnet,
  [EvmChainIds.EthereumSepolia]: sepolia,
  [EvmChainIds.mainnetChain]: jejuMainnet,
  [EvmChainIds.testnetChain]: jejuTestnet,
  [EvmChainIds.localnetChain]: jejuLocalnet,
}

// RPC URLs per chain
export const EVM_RPC_URLS: Record<EvmChainIds, string[]> = {
  [EvmChainIds.EthereumMainnet]: [
    'https://eth.llamarpc.com',
    ...(process.env.PUBLIC_ALCHEMY_API_KEY
      ? [
          `https://eth-mainnet.g.alchemy.com/v2/${process.env.PUBLIC_ALCHEMY_API_KEY}`,
        ]
      : []),
  ],
  [EvmChainIds.EthereumSepolia]: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    ...(process.env.PUBLIC_ALCHEMY_API_KEY
      ? [
          `https://eth-sepolia.g.alchemy.com/v2/${process.env.PUBLIC_ALCHEMY_API_KEY}`,
        ]
      : []),
  ],
  [EvmChainIds.mainnetChain]: ['https://rpc.jejunetwork.org'],
  [EvmChainIds.testnetChain]: ['https://testnet-rpc.jejunetwork.org'],
  [EvmChainIds.localnetChain]: [
    process.env.PUBLIC_JEJU_RPC_URL ||
      getL2RpcUrl() ||
      `http://localhost:${INFRA_PORTS.L2_RPC.DEFAULT}`,
  ],
}

// Solana RPC URLs
export const SOLANA_RPC_URLS: Record<SolanaNetworkIds, string[]> = {
  [SolanaNetworkIds.Mainnet]: [
    ...(process.env.PUBLIC_HELIUS_API_KEY
      ? [
          `https://mainnet.helius-rpc.com/?api-key=${process.env.PUBLIC_HELIUS_API_KEY}`,
        ]
      : []),
  ],
  [SolanaNetworkIds.Devnet]: [
    ...(process.env.PUBLIC_HELIUS_API_KEY
      ? [
          `https://devnet.helius-rpc.com/?api-key=${process.env.PUBLIC_HELIUS_API_KEY}`,
        ]
      : []),
  ],
}

// Native currency symbols
export const CHAIN_NATIVE_SYMBOL: Record<EvmChainIds, string> = {
  [EvmChainIds.EthereumMainnet]: 'ETH',
  [EvmChainIds.EthereumSepolia]: 'ETH',
  [EvmChainIds.mainnetChain]: 'ETH',
  [EvmChainIds.testnetChain]: 'ETH',
  [EvmChainIds.localnetChain]: 'ETH',
}

// Block explorer URLs
export const CHAIN_BLOCK_EXPLORER: Record<EvmChainIds, string> = {
  [EvmChainIds.EthereumMainnet]: 'https://etherscan.io',
  [EvmChainIds.EthereumSepolia]: 'https://sepolia.etherscan.io',
  [EvmChainIds.mainnetChain]: 'https://explorer.jejunetwork.org',
  [EvmChainIds.testnetChain]: 'https://testnet-explorer.jejunetwork.org',
  [EvmChainIds.localnetChain]:
    process.env.PUBLIC_EXPLORER_URL ||
    getExplorerUrl() ||
    `http://localhost:${CORE_PORTS.EXPLORER.DEFAULT}`,
}

// Chain names (display)
export const CHAIN_NAMES: Record<EvmChainIds, string> = {
  [EvmChainIds.EthereumMainnet]: 'Ethereum',
  [EvmChainIds.EthereumSepolia]: 'Sepolia',
  [EvmChainIds.mainnetChain]: networkName,
  [EvmChainIds.testnetChain]: `${networkName} Testnet`,
  [EvmChainIds.localnetChain]: `${networkName} Localnet`,
}

// Chain availability helper
export function isChainAvailable(chainId: EvmChainIds): boolean {
  // network chains are always available
  if (
    chainId === EvmChainIds.mainnetChain ||
    chainId === EvmChainIds.testnetChain ||
    chainId === EvmChainIds.localnetChain
  ) {
    return true
  }

  // Ethereum chains always have fallback RPC
  if (
    chainId === EvmChainIds.EthereumMainnet ||
    chainId === EvmChainIds.EthereumSepolia
  ) {
    return true
  }

  return false
}

// Get all available chains
export function getAvailableChains(): Chain[] {
  return Object.values(CHAINID_TO_VIEM_CHAIN).filter((chain) =>
    isChainAvailable(chain.id as EvmChainIds),
  )
}

// Detect if running in localnet mode
export function isLocalnetMode(): boolean {
  const jejuRpc = process.env.PUBLIC_JEJU_RPC_URL || ''
  return jejuRpc.includes('localhost') || jejuRpc.includes('127.0.0.1')
}
