import type { Address } from 'viem'
import { JEJU_CHAIN_ID } from './chains'
import {
  getUniswapV4,
  getBazaarMarketplace,
  getERC20Factory,
  bazaarMarketplaceDeployments,
  erc20FactoryDeployments,
  ZERO_ADDRESS,
  isValidAddress,
  type ChainId,
} from '@jejunetwork/contracts'

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
  tradeEscrow?: Address
  gameAgentId?: number
}

export interface TokenFactoryContracts {
  erc20Factory: Address
}

function buildV4Contracts(chainId: ChainId): V4Contracts {
  const v4 = getUniswapV4(chainId)
  return {
    poolManager: (v4.poolManager || ZERO_ADDRESS) as Address,
    weth: (v4.weth || ZERO_ADDRESS) as Address,
    swapRouter: v4.swapRouter as Address | undefined,
    positionManager: v4.positionManager as Address | undefined,
    quoterV4: v4.quoterV4 as Address | undefined,
    stateView: v4.stateView as Address | undefined,
  }
}

export const V4_CONTRACTS: Record<number, V4Contracts> = {
  1337: buildV4Contracts(1337),
  420691: buildV4Contracts(420691),
}

function buildNFTContracts(chainId: ChainId): NFTContracts {
  const marketplace = bazaarMarketplaceDeployments[chainId]
  const marketplaceAddr = getBazaarMarketplace(chainId) || ZERO_ADDRESS
  return {
    marketplace: marketplaceAddr as Address,
    hyperscapeGold: (marketplace?.goldToken || ZERO_ADDRESS) as Address,
    hyperscapeItems: marketplaceAddr as Address,
  }
}

export const NFT_CONTRACTS: Record<number, NFTContracts> = {
  1337: buildNFTContracts(1337),
  [JEJU_CHAIN_ID]: buildNFTContracts(420691),
}

function buildTokenFactoryContracts(chainId: ChainId): TokenFactoryContracts {
  const factory = erc20FactoryDeployments[chainId]
  return {
    erc20Factory: (getERC20Factory(chainId) || factory?.at || ZERO_ADDRESS) as Address,
  }
}

export const TOKEN_FACTORY_CONTRACTS: Record<number, TokenFactoryContracts> = {
  1337: buildTokenFactoryContracts(1337),
  [JEJU_CHAIN_ID]: buildTokenFactoryContracts(420691),
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
  return !!(contracts.marketplace && contracts.hyperscapeItems && isValidAddress(contracts.marketplace))
}

export function getTokenFactoryContracts(chainId: number): TokenFactoryContracts | undefined {
  return TOKEN_FACTORY_CONTRACTS[chainId]
}

export function hasTokenFactory(chainId: number): boolean {
  const contracts = getTokenFactoryContracts(chainId)
  return !!contracts?.erc20Factory && isValidAddress(contracts.erc20Factory)
}
