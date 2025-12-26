import {
  type ChainId,
  getBazaarMarketplace,
  getUniswapV4,
  isValidAddress,
  ZERO_ADDRESS,
} from '@jejunetwork/contracts'
import type { Address } from 'viem'
import { JEJU_CHAIN_ID } from './chains'

/** Convert string to Address with validation, returns ZERO_ADDRESS if invalid */
function toAddress(value: string | undefined): Address {
  if (!value || !isValidAddress(value)) {
    return ZERO_ADDRESS
  }
  return value as Address
}

/** Convert string to optional Address */
function toOptionalAddress(value: string | undefined): Address | undefined {
  if (!value || !isValidAddress(value)) {
    return undefined
  }
  return value as Address
}

export interface V4Contracts {
  poolManager: Address
  weth: Address
  swapRouter?: Address
  positionManager?: Address
  quoterV4?: Address
  stateView?: Address
}

interface NFTContracts {
  marketplace?: Address
  tradeEscrow?: Address
}

function buildV4Contracts(chainId: ChainId): V4Contracts {
  const v4 = getUniswapV4(chainId)
  return {
    poolManager: toAddress(v4.poolManager),
    weth: toAddress(v4.weth),
    swapRouter: toOptionalAddress(v4.swapRouter),
    positionManager: toOptionalAddress(v4.positionManager),
    quoterV4: toOptionalAddress(v4.quoterV4),
    stateView: toOptionalAddress(v4.stateView),
  }
}

const V4_CONTRACTS: Record<number, V4Contracts> = {
  31337: buildV4Contracts(31337),
  ...(JEJU_CHAIN_ID !== 31337
    ? { [JEJU_CHAIN_ID]: buildV4Contracts(JEJU_CHAIN_ID as ChainId) }
    : {}),
}

function buildNFTContracts(chainId: ChainId): NFTContracts {
  const marketplaceAddr = toAddress(getBazaarMarketplace(chainId))
  return {
    marketplace: marketplaceAddr,
  }
}

const NFT_CONTRACTS: Record<number, NFTContracts> = {
  31337: buildNFTContracts(31337),
  ...(JEJU_CHAIN_ID !== 31337
    ? { [JEJU_CHAIN_ID]: buildNFTContracts(JEJU_CHAIN_ID as ChainId) }
    : {}),
}

export function getV4Contracts(chainId: number): V4Contracts {
  const contracts = V4_CONTRACTS[chainId]
  if (!contracts) {
    throw new Error(`V4 contracts not configured for chain ${chainId}`)
  }
  return contracts
}

function getNFTContracts(chainId: number): NFTContracts {
  const contracts = NFT_CONTRACTS[chainId]
  if (!contracts) {
    throw new Error(`NFT contracts not configured for chain ${chainId}`)
  }
  return contracts
}

export function hasNFTMarketplace(chainId: number): boolean {
  const contracts = getNFTContracts(chainId)
  return !!(contracts.marketplace && isValidAddress(contracts.marketplace))
}

export function getMarketplaceAddress(chainId: number): Address | undefined {
  const contracts = NFT_CONTRACTS[chainId]
  if (!contracts?.marketplace || !isValidAddress(contracts.marketplace)) {
    return undefined
  }
  return contracts.marketplace
}
