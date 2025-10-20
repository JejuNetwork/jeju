import { Address } from 'viem'
import { JEJU_CHAIN_ID } from './chains'

// Import deployment files
// NOTE: For localnet (chain 1337), use uniswap-v4-1337.json
// For testnet, use the chain-specific file (e.g., uniswap-v4-420691.json for Base Sepolia)
import v4Deployment from '../../../contracts/deployments/uniswap-v4-1337.json'
import factoryDeployment from '../../../contracts/deployments/erc20-factory-1337.json'
import marketplaceDeployment from '../../../contracts/deployments/bazaar-marketplace-1337.json'

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

export interface TokenFactoryContracts {
  erc20Factory: Address
}

export const V4_CONTRACTS: Record<number, V4Contracts> = {
  [JEJU_CHAIN_ID]: {
    poolManager: v4Deployment.poolManager as Address,
    weth: v4Deployment.weth as Address,
    // Periphery contracts deployed automatically during `bun run dev`
    swapRouter: v4Deployment.swapRouter as Address | undefined,
    positionManager: v4Deployment.positionManager as Address | undefined,
    quoterV4: v4Deployment.quoterV4 as Address | undefined,
    stateView: v4Deployment.stateView as Address | undefined,
  },
}

export const NFT_CONTRACTS: Record<number, NFTContracts> = {
  1337: {
    marketplace: marketplaceDeployment.marketplace as Address,
    hyperscapeGold: marketplaceDeployment.goldToken as Address,
  },
  [JEJU_CHAIN_ID]: {
    marketplace: marketplaceDeployment.marketplace as Address,
    hyperscapeGold: marketplaceDeployment.goldToken as Address,
  },
}

export const TOKEN_FACTORY_CONTRACTS: Record<number, TokenFactoryContracts> = {
  1337: {
    erc20Factory: factoryDeployment.factory as Address,
  },
  [JEJU_CHAIN_ID]: {
    erc20Factory: factoryDeployment.factory as Address,
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

export function getTokenFactoryContracts(chainId: number): TokenFactoryContracts | undefined {
  return TOKEN_FACTORY_CONTRACTS[chainId]
}

export function hasTokenFactory(chainId: number): boolean {
  const contracts = getTokenFactoryContracts(chainId)
  return !!contracts?.erc20Factory
}

