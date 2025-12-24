/**
 * RPC Chain Configuration
 * Transforms chain metadata from lib/config/networks into simplified ChainConfig for RPC module.
 */

import { CHAINS as ChainMeta } from '../../../lib/config/networks'

export interface ChainConfig {
  chainId: number
  name: string
  shortName: string
  isTestnet: boolean
}

// Transform chain metadata into ChainConfig records
export const CHAINS: Record<number, ChainConfig> = Object.fromEntries(
  Object.entries(ChainMeta).map(([idStr, meta]) => {
    const chainId = Number(idStr)
    return [
      chainId,
      {
        chainId,
        name: meta.name,
        shortName: meta.shortName,
        isTestnet: meta.isTestnet,
      },
    ]
  }),
)

export function getChain(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId]
}

export function isChainSupported(chainId: number): boolean {
  return chainId in CHAINS
}

export function getMainnetChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => !c.isTestnet)
}

export function getTestnetChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => c.isTestnet)
}
