import { getContractsConfig } from '@jejunetwork/config'
import {
  type ChainId,
  getUniswapV4,
  isValidAddress,
  ZERO_ADDRESS,
} from '@jejunetwork/contracts'
import type { Address } from 'viem'
import { CHAIN_ID, NETWORK } from './network'

const JEJU_CHAIN_ID = CHAIN_ID

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

function buildV4Contracts(chainId: ChainId): V4Contracts | null {
  try {
    const v4 = getUniswapV4(chainId)
    return {
      poolManager: toAddress(v4.poolManager),
      weth: toAddress(v4.weth),
      swapRouter: toOptionalAddress(v4.swapRouter),
      positionManager: toOptionalAddress(v4.positionManager),
      quoterV4: toOptionalAddress(v4.quoterV4),
      stateView: toOptionalAddress(v4.stateView),
    }
  } catch {
    console.warn(`Uniswap V4 not deployed on chain ${chainId}`)
    return null
  }
}

function getV4ContractsMap(): Record<number, V4Contracts> {
  const contracts: Record<number, V4Contracts> = {}
  const localnetContracts = buildV4Contracts(31337)
  if (localnetContracts) {
    contracts[31337] = localnetContracts
  }
  if (JEJU_CHAIN_ID !== 31337) {
    const jejuContracts = buildV4Contracts(JEJU_CHAIN_ID as ChainId)
    if (jejuContracts) {
      contracts[JEJU_CHAIN_ID] = jejuContracts
    }
  }
  return contracts
}

const V4_CONTRACTS: Record<number, V4Contracts> = getV4ContractsMap()

function buildNFTContracts(): NFTContracts {
  // Get marketplace from contracts.json config (updated by deploy scripts)
  const contracts = getContractsConfig(NETWORK)
  const marketplaceAddr =
    toAddress(contracts.commerce?.nftMarketplace) ||
    toAddress(contracts.bazaar?.marketplace)
  return {
    marketplace: marketplaceAddr,
  }
}

// Build contracts once based on detected network
const nftContracts = buildNFTContracts()
const NFT_CONTRACTS: Record<number, NFTContracts> = {
  31337: nftContracts,
  [JEJU_CHAIN_ID]: nftContracts,
}

export function getV4Contracts(chainId: number): V4Contracts | null {
  return V4_CONTRACTS[chainId] ?? null
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
  if (!contracts.marketplace || !isValidAddress(contracts.marketplace)) {
    return undefined
  }
  return contracts.marketplace
}
