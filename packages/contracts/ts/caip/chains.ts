/**
 * CAIP-2: Chain Identification
 *
 * Format: namespace:reference
 * Examples:
 *   - eip155:1 (Ethereum Mainnet)
 *   - eip155:8453 (Base)
 *   - solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp (Solana Mainnet)
 */

export type ChainNamespace =
  | 'eip155'
  | 'solana'
  | 'cosmos'
  | 'polkadot'
  | 'bip122'

export interface ChainId {
  namespace: ChainNamespace
  reference: string
}

export interface ChainInfo {
  id: ChainId
  name: string
  shortName: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  rpcUrls: string[]
  blockExplorerUrls?: string[]
  isTestnet: boolean
}

export const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
export const SOLANA_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
export const SOLANA_TESTNET_GENESIS = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'

export const CHAINS: Record<string, ChainInfo> = {
  'eip155:1': {
    id: { namespace: 'eip155', reference: '1' },
    name: 'Ethereum Mainnet',
    shortName: 'eth',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
    blockExplorerUrls: ['https://etherscan.io'],
    isTestnet: false,
  },
  'eip155:10': {
    id: { namespace: 'eip155', reference: '10' },
    name: 'Optimism',
    shortName: 'op',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.optimism.io'],
    blockExplorerUrls: ['https://optimistic.etherscan.io'],
    isTestnet: false,
  },
  'eip155:137': {
    id: { namespace: 'eip155', reference: '137' },
    name: 'Polygon',
    shortName: 'matic',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
    isTestnet: false,
  },
  'eip155:8453': {
    id: { namespace: 'eip155', reference: '8453' },
    name: 'Base',
    shortName: 'base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
    isTestnet: false,
  },
  'eip155:84532': {
    id: { namespace: 'eip155', reference: '84532' },
    name: 'Base Sepolia',
    shortName: 'base-sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
    isTestnet: true,
  },
  'eip155:42161': {
    id: { namespace: 'eip155', reference: '42161' },
    name: 'Arbitrum One',
    shortName: 'arb',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://arbiscan.io'],
    isTestnet: false,
  },
  'eip155:11155111': {
    id: { namespace: 'eip155', reference: '11155111' },
    name: 'Sepolia',
    shortName: 'sep',
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.sepolia.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
    isTestnet: true,
  },
  [`solana:${SOLANA_MAINNET_GENESIS}`]: {
    id: { namespace: 'solana', reference: SOLANA_MAINNET_GENESIS },
    name: 'Solana Mainnet',
    shortName: 'sol',
    nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
    rpcUrls: ['https://api.mainnet-beta.solana.com'],
    blockExplorerUrls: ['https://explorer.solana.com'],
    isTestnet: false,
  },
  [`solana:${SOLANA_DEVNET_GENESIS}`]: {
    id: { namespace: 'solana', reference: SOLANA_DEVNET_GENESIS },
    name: 'Solana Devnet',
    shortName: 'sol-dev',
    nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
    rpcUrls: ['https://api.devnet.solana.com'],
    blockExplorerUrls: ['https://explorer.solana.com?cluster=devnet'],
    isTestnet: true,
  },
}

export function parseChainId(caip2: string): ChainId {
  const parts = caip2.split(':')
  if (parts.length !== 2) {
    throw new Error(`Invalid CAIP-2 chain ID: ${caip2}`)
  }

  const [namespace, reference] = parts
  if (!isValidNamespace(namespace)) {
    throw new Error(`Invalid namespace: ${namespace}`)
  }

  return { namespace: namespace as ChainNamespace, reference }
}

export function formatChainId(chainId: ChainId): string {
  return `${chainId.namespace}:${chainId.reference}`
}

function isValidNamespace(namespace: string): boolean {
  return ['eip155', 'solana', 'cosmos', 'polkadot', 'bip122'].includes(
    namespace,
  )
}

export function getChainInfo(caip2: string): ChainInfo | undefined {
  return CHAINS[caip2]
}

export function evmChainIdToCAIP2(chainId: number): string {
  return `eip155:${chainId}`
}

export function caip2ToEvmChainId(caip2: string): number | undefined {
  const parsed = parseChainId(caip2)
  if (parsed.namespace !== 'eip155') {
    return undefined
  }
  return parseInt(parsed.reference, 10)
}

export function isEvmChain(caip2: string): boolean {
  return caip2.startsWith('eip155:')
}

export function isSolanaChain(caip2: string): boolean {
  return caip2.startsWith('solana:')
}

export function getSolanaCluster(
  caip2: string,
): 'mainnet-beta' | 'devnet' | 'testnet' | undefined {
  const parsed = parseChainId(caip2)
  if (parsed.namespace !== 'solana') {
    return undefined
  }

  switch (parsed.reference) {
    case SOLANA_MAINNET_GENESIS:
      return 'mainnet-beta'
    case SOLANA_DEVNET_GENESIS:
      return 'devnet'
    case SOLANA_TESTNET_GENESIS:
      return 'testnet'
    default:
      return undefined
  }
}

export function solanaClusterToCAIP2(
  cluster: 'mainnet-beta' | 'devnet' | 'testnet',
): string {
  const genesis = {
    'mainnet-beta': SOLANA_MAINNET_GENESIS,
    devnet: SOLANA_DEVNET_GENESIS,
    testnet: SOLANA_TESTNET_GENESIS,
  }[cluster]

  return `solana:${genesis}`
}

export function getAllChains(): ChainInfo[] {
  return Object.values(CHAINS)
}

export function getMainnetChains(): ChainInfo[] {
  return Object.values(CHAINS).filter((c) => !c.isTestnet)
}

export function getTestnetChains(): ChainInfo[] {
  return Object.values(CHAINS).filter((c) => c.isTestnet)
}
