import type { Address } from 'viem'
import { JEJU_CHAIN_ID } from './chains'
import {
  getUniswapV4,
  getBazaarMarketplace,
  getERC20Factory,
  getXLPDeployment,
  getLaunchpadDeployment,
  getTokenLaunchpad,
  bazaarMarketplaceDeployments,
  erc20FactoryDeployments,
  launchpadDeployments,
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

export interface XLPContracts {
  v2Factory?: Address
  v3Factory?: Address
  router?: Address
  positionManager?: Address
  weth?: Address
}

export interface NFTContracts {
  /** @deprecated Use gameItems instead */
  hyperscapeItems?: Address
  /** @deprecated Use gameGold instead */
  hyperscapeGold?: Address
  gameItems?: Address
  gameGold?: Address
  marketplace?: Address
  tradeEscrow?: Address
  gameAgentId?: number
}

export interface GameContracts {
  items?: Address
  gold?: Address
  marketplace?: Address
  tradeEscrow?: Address
  sponsoredPaymaster?: Address
  gameAgentId?: number
}

export interface TokenFactoryContracts {
  erc20Factory: Address
}

export interface LaunchpadContracts {
  tokenLaunchpad: Address
  lpLocker?: Address
  weth?: Address
  xlpV2Factory?: Address
  communityVault?: Address
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
  // Only build for JEJU_CHAIN_ID if it's different from 1337
  ...(JEJU_CHAIN_ID !== 1337 ? { [JEJU_CHAIN_ID]: buildV4Contracts(JEJU_CHAIN_ID as ChainId) } : {}),
}

function buildNFTContracts(chainId: ChainId): NFTContracts {
  const marketplace = bazaarMarketplaceDeployments[chainId]
  const marketplaceAddr = getBazaarMarketplace(chainId) || ZERO_ADDRESS
  const goldAddr = (marketplace?.goldToken || ZERO_ADDRESS) as Address
  const itemsAddr = marketplaceAddr as Address
  return {
    marketplace: marketplaceAddr as Address,
    // Generic names
    gameGold: goldAddr,
    gameItems: itemsAddr,
    // Legacy names (deprecated)
    hyperscapeGold: goldAddr,
    hyperscapeItems: itemsAddr,
  }
}

export const NFT_CONTRACTS: Record<number, NFTContracts> = {
  1337: buildNFTContracts(1337),
  ...(JEJU_CHAIN_ID !== 1337 ? { [JEJU_CHAIN_ID]: buildNFTContracts(JEJU_CHAIN_ID as ChainId) } : {}),
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

function buildLaunchpadContracts(chainId: ChainId): LaunchpadContracts {
  const launchpad = getLaunchpadDeployment(chainId)
  return {
    tokenLaunchpad: (getTokenLaunchpad(chainId) || ZERO_ADDRESS) as Address,
    lpLocker: launchpad.lpLockerTemplate as Address | undefined,
    weth: launchpad.weth as Address | undefined,
    xlpV2Factory: launchpad.xlpV2Factory as Address | undefined,
    communityVault: launchpad.defaultCommunityVault as Address | undefined,
  }
}

export const LAUNCHPAD_CONTRACTS: Record<number, LaunchpadContracts> = {
  1337: buildLaunchpadContracts(1337),
  ...(JEJU_CHAIN_ID !== 1337 ? { [JEJU_CHAIN_ID]: buildLaunchpadContracts(JEJU_CHAIN_ID as ChainId) } : {}),
}

export function getV4Contracts(chainId: number): V4Contracts {
  const contracts = V4_CONTRACTS[chainId]
  if (!contracts) {
    throw new Error(`V4 contracts not configured for chain ${chainId}`)
  }
  return contracts
}

export function getNFTContracts(chainId: number): NFTContracts {
  const contracts = NFT_CONTRACTS[chainId]
  if (!contracts) {
    throw new Error(`NFT contracts not configured for chain ${chainId}`)
  }
  return contracts
}

export function hasV4Periphery(chainId: number): boolean {
  const contracts = getV4Contracts(chainId)
  return !!(contracts.swapRouter && contracts.positionManager && contracts.quoterV4)
}

export function hasNFTMarketplace(chainId: number): boolean {
  const contracts = getNFTContracts(chainId)
  const items = contracts.gameItems || contracts.hyperscapeItems
  return !!(contracts.marketplace && items && isValidAddress(contracts.marketplace))
}

export function getTokenFactoryContracts(chainId: number): TokenFactoryContracts | undefined {
  return TOKEN_FACTORY_CONTRACTS[chainId]
}

export function hasTokenFactory(chainId: number): boolean {
  const contracts = getTokenFactoryContracts(chainId)
  return !!contracts?.erc20Factory && isValidAddress(contracts.erc20Factory)
}

export function getLaunchpadContracts(chainId: number): LaunchpadContracts | undefined {
  return LAUNCHPAD_CONTRACTS[chainId]
}

export function hasLaunchpad(chainId: number): boolean {
  const contracts = getLaunchpadContracts(chainId)
  return !!contracts?.tokenLaunchpad && isValidAddress(contracts.tokenLaunchpad)
}

// XLP AMM Contracts (V2 + V3) - loaded from deployments
function buildXLPContracts(chainId: ChainId): XLPContracts {
  const xlp = getXLPDeployment(chainId)
  return {
    v2Factory: xlp.v2Factory as Address | undefined,
    v3Factory: xlp.v3Factory as Address | undefined,
    router: xlp.router as Address | undefined,
    positionManager: xlp.positionManager as Address | undefined,
    weth: xlp.weth as Address | undefined,
  }
}

export const XLP_CONTRACTS: Record<number, XLPContracts> = {
  1337: buildXLPContracts(1337),
  ...(JEJU_CHAIN_ID !== 1337 ? { [JEJU_CHAIN_ID]: buildXLPContracts(JEJU_CHAIN_ID as ChainId) } : {}),
}

export function getXLPContracts(chainId: number): XLPContracts | undefined {
  return XLP_CONTRACTS[chainId]
}

export function hasXLPV2(chainId: number): boolean {
  const contracts = getXLPContracts(chainId)
  return !!contracts?.v2Factory && isValidAddress(contracts.v2Factory)
}

export function hasXLPV3(chainId: number): boolean {
  const contracts = getXLPContracts(chainId)
  return !!contracts?.v3Factory && isValidAddress(contracts.v3Factory)
}

export function hasXLPRouter(chainId: number): boolean {
  const contracts = getXLPContracts(chainId)
  return !!contracts?.router && isValidAddress(contracts.router)
}

// Game Contracts (Hyperscape etc.)
function buildGameContracts(chainId: ChainId): GameContracts {
  const nft = buildNFTContracts(chainId)
  return {
    items: nft.gameItems || nft.hyperscapeItems,
    gold: nft.gameGold || nft.hyperscapeGold,
    marketplace: nft.marketplace,
    tradeEscrow: nft.tradeEscrow,
    sponsoredPaymaster: ZERO_ADDRESS as Address,
    gameAgentId: nft.gameAgentId,
  }
}

export const GAME_CONTRACTS: Record<number, GameContracts> = {
  1337: buildGameContracts(1337),
  ...(JEJU_CHAIN_ID !== 1337 ? { [JEJU_CHAIN_ID]: buildGameContracts(JEJU_CHAIN_ID as ChainId) } : {}),
}

export function getGameContracts(chainId: number): GameContracts {
  const contracts = GAME_CONTRACTS[chainId]
  if (!contracts) {
    throw new Error(`Game contracts not configured for chain ${chainId}`)
  }
  return contracts
}
