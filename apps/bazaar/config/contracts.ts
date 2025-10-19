import { Address } from 'viem'
import { JEJU_CHAIN_ID } from './chains'

// Import deployment files
import v4Deployment from '../../../contracts/deployments/uniswap-v4-420691.json'

export interface V4Contracts {
  poolManager: Address
  weth: Address
  swapRouter?: Address
  positionManager?: Address
  quoterV4?: Address
  stateView?: Address
}

export interface NFTContracts {
  hyperscapeItems?: Address
  hyperscapeGold?: Address
  marketplace?: Address
}

export const V4_CONTRACTS: Record<number, V4Contracts> = {
  [JEJU_CHAIN_ID]: {
    poolManager: v4Deployment.poolManager as Address,
    weth: v4Deployment.weth as Address,
    // TODO: Add after periphery deployment
    // swapRouter: '0x...',
    // positionManager: '0x...',
    // quoterV4: '0x...',
    // stateView: '0x...',
  },
}

export const NFT_CONTRACTS: Record<number, NFTContracts> = {
  [JEJU_CHAIN_ID]: {
    // TODO: Add NFT contract addresses after deployment
    // hyperscapeItems: '0x...',
    // hyperscapeGold: '0x...',
    // marketplace: '0x...',
  },
}

export function getV4Contracts(chainId: number): V4Contracts {
  const contracts = V4_CONTRACTS[chainId]
  if (!contracts) {
    throw new Error(`V4 contracts not configured for chain ${chainId}`)
  }
  return contracts
}

export function getNFTContracts(chainId: number): NFTContracts {
  return NFT_CONTRACTS[chainId] || {}
}

export function hasV4Periphery(chainId: number): boolean {
  const contracts = getV4Contracts(chainId)
  return !!(contracts.swapRouter && contracts.positionManager && contracts.quoterV4)
}

export function hasNFTMarketplace(chainId: number): boolean {
  const contracts = getNFTContracts(chainId)
  return !!(contracts.marketplace && contracts.hyperscapeItems)
}

