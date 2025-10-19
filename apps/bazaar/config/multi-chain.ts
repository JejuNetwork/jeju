import { defineChain, type Chain } from 'viem'
import { base, baseSepolia, mainnet, sepolia, bsc, bscTestnet } from 'viem/chains'

// Chain IDs enum for type safety
export enum EvmChainIds {
  EthereumMainnet = 1,
  EthereumSepolia = 11155111,
  BaseMainnet = 8453,
  BaseSepolia = 84532,
  JejuMainnet = 420691,
  JejuTestnet = 420690,
  JejuLocalnet = 1337,
  BSCMainnet = 56,
  BSCTestnet = 97,
}

export enum SolanaNetworkIds {
  Mainnet = 101,
  Devnet = 103,
}

// Jeju chain definitions
export const jejuMainnet = defineChain({
  id: 420691,
  name: 'Jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.jeju.network'] },
  },
  blockExplorers: {
    default: { name: 'Jeju Explorer', url: 'https://explorer.jeju.network' },
  },
})

export const jejuTestnet = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jeju.network'] },
  },
  blockExplorers: {
    default: { name: 'Jeju Testnet Explorer', url: 'https://testnet-explorer.jeju.network' },
  },
  testnet: true,
})

export const jejuLocalnet = defineChain({
  id: 1337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_JEJU_RPC_URL || 'http://localhost:9545'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'http://localhost:4004' },
  },
  testnet: true,
})

// Chain ID to Viem Chain mapping
export const CHAINID_TO_VIEM_CHAIN: Record<EvmChainIds, Chain> = {
  [EvmChainIds.EthereumMainnet]: mainnet,
  [EvmChainIds.EthereumSepolia]: sepolia,
  [EvmChainIds.BaseMainnet]: base,
  [EvmChainIds.BaseSepolia]: baseSepolia,
  [EvmChainIds.JejuMainnet]: jejuMainnet,
  [EvmChainIds.JejuTestnet]: jejuTestnet,
  [EvmChainIds.JejuLocalnet]: jejuLocalnet,
  [EvmChainIds.BSCMainnet]: bsc,
  [EvmChainIds.BSCTestnet]: bscTestnet,
}

// RPC URLs per chain
export const EVM_RPC_URLS: Record<EvmChainIds, string[]> = {
  [EvmChainIds.EthereumMainnet]: [
    ...(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
      ? [`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`]
      : []),
  ],
  [EvmChainIds.EthereumSepolia]: [
    ...(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
      ? [`https://eth-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`]
      : []),
  ],
  [EvmChainIds.BaseMainnet]: [
    ...(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
      ? [`https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`]
      : []),
  ],
  [EvmChainIds.BaseSepolia]: [
    ...(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
      ? [`https://base-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`]
      : []),
  ],
  [EvmChainIds.JejuMainnet]: ['https://rpc.jeju.network'],
  [EvmChainIds.JejuTestnet]: ['https://testnet-rpc.jeju.network'],
  [EvmChainIds.JejuLocalnet]: [process.env.NEXT_PUBLIC_JEJU_RPC_URL || 'http://localhost:9545'],
  [EvmChainIds.BSCMainnet]: [
    ...(process.env.NEXT_PUBLIC_BSC_RPC_URL
      ? [process.env.NEXT_PUBLIC_BSC_RPC_URL]
      : ['https://bsc-dataseed1.binance.org']),
  ],
  [EvmChainIds.BSCTestnet]: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
}

// Solana RPC URLs
export const SOLANA_RPC_URLS: Record<SolanaNetworkIds, string[]> = {
  [SolanaNetworkIds.Mainnet]: [
    ...(process.env.NEXT_PUBLIC_HELIUS_API_KEY
      ? [`https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`]
      : []),
  ],
  [SolanaNetworkIds.Devnet]: [
    ...(process.env.NEXT_PUBLIC_HELIUS_API_KEY
      ? [`https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`]
      : []),
  ],
}

// Native currency symbols
export const CHAIN_NATIVE_SYMBOL: Record<EvmChainIds, string> = {
  [EvmChainIds.EthereumMainnet]: 'ETH',
  [EvmChainIds.EthereumSepolia]: 'ETH',
  [EvmChainIds.BaseMainnet]: 'ETH',
  [EvmChainIds.BaseSepolia]: 'ETH',
  [EvmChainIds.JejuMainnet]: 'ETH',
  [EvmChainIds.JejuTestnet]: 'ETH',
  [EvmChainIds.JejuLocalnet]: 'ETH',
  [EvmChainIds.BSCMainnet]: 'BNB',
  [EvmChainIds.BSCTestnet]: 'BNB',
}

// Block explorer URLs
export const CHAIN_BLOCK_EXPLORER: Record<EvmChainIds, string> = {
  [EvmChainIds.EthereumMainnet]: 'https://etherscan.io',
  [EvmChainIds.EthereumSepolia]: 'https://sepolia.etherscan.io',
  [EvmChainIds.BaseMainnet]: 'https://basescan.org',
  [EvmChainIds.BaseSepolia]: 'https://sepolia.basescan.org',
  [EvmChainIds.JejuMainnet]: 'https://explorer.jeju.network',
  [EvmChainIds.JejuTestnet]: 'https://testnet-explorer.jeju.network',
  [EvmChainIds.JejuLocalnet]: 'http://localhost:4004',
  [EvmChainIds.BSCMainnet]: 'https://bscscan.com',
  [EvmChainIds.BSCTestnet]: 'https://testnet.bscscan.com',
}

// Chain names (display)
export const CHAIN_NAMES: Record<EvmChainIds, string> = {
  [EvmChainIds.EthereumMainnet]: 'Ethereum',
  [EvmChainIds.EthereumSepolia]: 'Sepolia',
  [EvmChainIds.BaseMainnet]: 'Base',
  [EvmChainIds.BaseSepolia]: 'Base Sepolia',
  [EvmChainIds.JejuMainnet]: 'Jeju',
  [EvmChainIds.JejuTestnet]: 'Jeju Testnet',
  [EvmChainIds.JejuLocalnet]: 'Jeju Localnet',
  [EvmChainIds.BSCMainnet]: 'BSC',
  [EvmChainIds.BSCTestnet]: 'BSC Testnet',
}

// Chain availability helper
export function isChainAvailable(chainId: EvmChainIds): boolean {
  // Jeju chains are always available
  if (
    chainId === EvmChainIds.JejuMainnet ||
    chainId === EvmChainIds.JejuTestnet ||
    chainId === EvmChainIds.JejuLocalnet
  ) {
    return true
  }

  // Ethereum/Base require Alchemy API key
  if (
    chainId === EvmChainIds.EthereumMainnet ||
    chainId === EvmChainIds.EthereumSepolia ||
    chainId === EvmChainIds.BaseMainnet ||
    chainId === EvmChainIds.BaseSepolia
  ) {
    return !!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
  }

  // BSC requires RPC URL
  if (chainId === EvmChainIds.BSCMainnet || chainId === EvmChainIds.BSCTestnet) {
    return !!process.env.NEXT_PUBLIC_BSC_RPC_URL
  }

  return false
}

// Get all available chains
export function getAvailableChains(): Chain[] {
  return Object.values(CHAINID_TO_VIEM_CHAIN).filter((chain) => isChainAvailable(chain.id as EvmChainIds))
}

// Detect if running in localnet mode
export function isLocalnetMode(): boolean {
  const jejuRpc = process.env.NEXT_PUBLIC_JEJU_RPC_URL || ''
  return jejuRpc.includes('localhost') || jejuRpc.includes('127.0.0.1')
}



