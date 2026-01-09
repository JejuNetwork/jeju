/**
 * Browser stub for @jejunetwork/contracts
 *
 * In browser builds, deployment data should be fetched via API
 * rather than loaded from the filesystem.
 */

import { type Address, isAddress } from 'viem'

export const ZERO_ADDRESS: Address =
  '0x0000000000000000000000000000000000000000'

/**
 * Validates that an address is a proper Ethereum address.
 * Returns false for null, undefined, empty, and ZERO_ADDRESS.
 * Matches the behavior of @jejunetwork/types isValidAddress.
 */
export function isValidAddress(
  address: Address | string | undefined | null,
): address is Address {
  return (
    typeof address === 'string' &&
    address.length === 42 &&
    address !== ZERO_ADDRESS &&
    isAddress(address)
  )
}

// Chain IDs
export const CHAIN_IDS = {
  localnet: 31337,
  testnet: 420690,
  mainnet: 42069,
} as const

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS]

// Deployment interfaces
export interface BazaarMarketplaceDeployment {
  address: Address
  chainId: ChainId
  deployedAt: number
}

export interface SimpleCollectibleDeployment {
  address: Address
  chainId: ChainId
  deployedAt: number
}

export interface UniswapV4Deployment {
  poolManager: Address
  weth: Address
  swapRouter?: Address
  positionManager?: Address
  quoterV4?: Address
  stateView?: Address
}

// Window config for browser deployment data
interface WindowConfig {
  __JEJU_CONTRACTS__?: Record<string, Address>
}

function getWindowConfig(): Record<string, Address> {
  if (typeof window !== 'undefined') {
    return (window as WindowConfig).__JEJU_CONTRACTS__ ?? {}
  }
  return {}
}

// Deployment getters
export function getBazaarMarketplace(
  chainId: ChainId,
): BazaarMarketplaceDeployment | undefined {
  const config = getWindowConfig()
  if (config.bazaarMarketplace) {
    return {
      address: config.bazaarMarketplace,
      chainId,
      deployedAt: 0,
    }
  }
  return undefined
}

export function getSimpleCollectible(
  chainId: ChainId,
): SimpleCollectibleDeployment | undefined {
  const config = getWindowConfig()
  if (config.simpleCollectible) {
    return {
      address: config.simpleCollectible,
      chainId,
      deployedAt: 0,
    }
  }
  return undefined
}

export function getContractAddresses(
  _chainId: ChainId,
): Record<string, Address> {
  return getWindowConfig()
}

export function getUniswapV4(_chainId: ChainId): UniswapV4Deployment {
  const config = getWindowConfig()
  return {
    poolManager: config.poolManager ?? ZERO_ADDRESS,
    weth: config.weth ?? ZERO_ADDRESS,
    swapRouter: config.swapRouter ?? undefined,
    positionManager: config.positionManager ?? undefined,
    quoterV4: config.quoterV4 ?? undefined,
    stateView: config.stateView ?? undefined,
  }
}
