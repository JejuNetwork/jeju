export interface ChainExplorerConfig {
  chainId: number
  chainName: string
  displayName: string
  explorerType: 'blockscout' | 'etherscan'
  explorerUrl: string
  explorerApiUrl?: string
}

export const CHAIN_REGISTRY: ChainExplorerConfig[] = [
  {
    chainId: 8453,
    chainName: 'base',
    displayName: 'Base',
    explorerType: 'blockscout',
    explorerUrl: 'https://base.blockscout.com',
  },
  {
    chainId: 10,
    chainName: 'optimism',
    displayName: 'Optimism',
    explorerType: 'blockscout',
    explorerUrl: 'https://optimism.blockscout.com',
  },
  {
    chainId: 42161,
    chainName: 'arbitrum',
    displayName: 'Arbitrum One',
    explorerType: 'blockscout',
    explorerUrl: 'https://arbitrum.blockscout.com',
  },
]

export function getChainConfig(chainId: number): ChainExplorerConfig | undefined {
  return CHAIN_REGISTRY.find(c => c.chainId === chainId)
}

export function getSupportedChains(): ChainExplorerConfig[] {
  return CHAIN_REGISTRY
}
