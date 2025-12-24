import {
  bazaarMarketplaceDeployments,
  type ChainId,
  erc20FactoryDeployments,
  getBazaarMarketplace,
  getERC20Factory,
  getLaunchpadDeployment,
  getTokenLaunchpad,
  getUniswapV4,
  getXLPDeployment,
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

export interface XLPContracts {
  v2Factory?: Address
  v3Factory?: Address
  router?: Address
  positionManager?: Address
  weth?: Address
}

export interface NFTContracts {
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
    poolManager: toAddress(v4.poolManager),
    weth: toAddress(v4.weth),
    swapRouter: toOptionalAddress(v4.swapRouter),
    positionManager: toOptionalAddress(v4.positionManager),
    quoterV4: toOptionalAddress(v4.quoterV4),
    stateView: toOptionalAddress(v4.stateView),
  }
}

export const V4_CONTRACTS: Record<number, V4Contracts> = {
  1337: buildV4Contracts(1337),
  // Only build for JEJU_CHAIN_ID if it's different from 1337
  ...(JEJU_CHAIN_ID !== 1337
    ? { [JEJU_CHAIN_ID]: buildV4Contracts(JEJU_CHAIN_ID as ChainId) }
    : {}),
}

function buildNFTContracts(chainId: ChainId): NFTContracts {
  const marketplace = bazaarMarketplaceDeployments[chainId]
  const marketplaceAddr = toAddress(getBazaarMarketplace(chainId))
  const goldAddr = toAddress(marketplace?.goldToken)
  return {
    marketplace: marketplaceAddr,
    gameGold: goldAddr,
    gameItems: marketplaceAddr,
  }
}

export const NFT_CONTRACTS: Record<number, NFTContracts> = {
  1337: buildNFTContracts(1337),
  ...(JEJU_CHAIN_ID !== 1337
    ? { [JEJU_CHAIN_ID]: buildNFTContracts(JEJU_CHAIN_ID as ChainId) }
    : {}),
}

function buildTokenFactoryContracts(chainId: ChainId): TokenFactoryContracts {
  const factory = erc20FactoryDeployments[chainId]
  return {
    erc20Factory: toAddress(getERC20Factory(chainId) || factory?.at),
  }
}

export const TOKEN_FACTORY_CONTRACTS: Record<number, TokenFactoryContracts> = {
  1337: buildTokenFactoryContracts(1337),
  [JEJU_CHAIN_ID]: buildTokenFactoryContracts(420691),
}

function buildLaunchpadContracts(chainId: ChainId): LaunchpadContracts {
  const launchpad = getLaunchpadDeployment(chainId)
  return {
    tokenLaunchpad: toAddress(getTokenLaunchpad(chainId)),
    lpLocker: toOptionalAddress(launchpad.lpLockerTemplate),
    weth: toOptionalAddress(launchpad.weth),
    xlpV2Factory: toOptionalAddress(launchpad.xlpV2Factory),
    communityVault: toOptionalAddress(launchpad.defaultCommunityVault),
  }
}

export const LAUNCHPAD_CONTRACTS: Record<number, LaunchpadContracts> = {
  1337: buildLaunchpadContracts(1337),
  ...(JEJU_CHAIN_ID !== 1337
    ? { [JEJU_CHAIN_ID]: buildLaunchpadContracts(JEJU_CHAIN_ID as ChainId) }
    : {}),
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
  return !!(
    contracts.swapRouter &&
    contracts.positionManager &&
    contracts.quoterV4
  )
}

export function hasNFTMarketplace(chainId: number): boolean {
  const contracts = getNFTContracts(chainId)
  return !!(
    contracts.marketplace &&
    contracts.gameItems &&
    isValidAddress(contracts.marketplace)
  )
}

export function getTokenFactoryContracts(
  chainId: number,
): TokenFactoryContracts | undefined {
  return TOKEN_FACTORY_CONTRACTS[chainId]
}

export function hasTokenFactory(chainId: number): boolean {
  const contracts = getTokenFactoryContracts(chainId)
  return !!contracts?.erc20Factory && isValidAddress(contracts.erc20Factory)
}

export function getLaunchpadContracts(
  chainId: number,
): LaunchpadContracts | undefined {
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
    v2Factory: toOptionalAddress(xlp.v2Factory),
    v3Factory: toOptionalAddress(xlp.v3Factory),
    router: toOptionalAddress(xlp.router),
    positionManager: toOptionalAddress(xlp.positionManager),
    weth: toOptionalAddress(xlp.weth),
  }
}

export const XLP_CONTRACTS: Record<number, XLPContracts> = {
  1337: buildXLPContracts(1337),
  ...(JEJU_CHAIN_ID !== 1337
    ? { [JEJU_CHAIN_ID]: buildXLPContracts(JEJU_CHAIN_ID as ChainId) }
    : {}),
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

// Game Contracts
function buildGameContracts(chainId: ChainId): GameContracts {
  const nft = buildNFTContracts(chainId)
  return {
    items: nft.gameItems,
    gold: nft.gameGold,
    marketplace: nft.marketplace,
    tradeEscrow: nft.tradeEscrow,
    sponsoredPaymaster: ZERO_ADDRESS,
    gameAgentId: nft.gameAgentId,
  }
}

export const GAME_CONTRACTS: Record<number, GameContracts> = {
  1337: buildGameContracts(1337),
  ...(JEJU_CHAIN_ID !== 1337
    ? { [JEJU_CHAIN_ID]: buildGameContracts(JEJU_CHAIN_ID as ChainId) }
    : {}),
}

export function getGameContracts(chainId: number): GameContracts {
  const contracts = GAME_CONTRACTS[chainId]
  if (!contracts) {
    throw new Error(`Game contracts not configured for chain ${chainId}`)
  }
  return contracts
}
