/**
 * Perps Service - Perpetual Futures Trading
 * Open/close positions, manage margin, view PnL
 */

import { asTuple } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  type Hex,
  http,
  type PublicClient,
  parseUnits,
} from 'viem'
import { getChainContracts, getNetworkRpcUrl } from '../../sdk/chains'
import { isSupportedChainId, rpcService } from '../rpc'

const PERP_MARKET_ABI = [
  // Position management
  {
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'size', type: 'uint256' },
      { name: 'side', type: 'uint8' },
      { name: 'marginType', type: 'uint8' },
      { name: 'marginToken', type: 'address' },
      { name: 'marginAmount', type: 'uint256' },
      { name: 'maxPrice', type: 'uint256' },
    ],
    name: 'openPosition',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'sizeToClose', type: 'uint256' },
      { name: 'minPrice', type: 'uint256' },
    ],
    name: 'closePosition',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'marginAmount', type: 'uint256' },
    ],
    name: 'addMargin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'marginAmount', type: 'uint256' },
    ],
    name: 'removeMargin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // View functions
  {
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    name: 'positions',
    outputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'trader', type: 'address' },
      { name: 'marketId', type: 'bytes32' },
      { name: 'side', type: 'uint8' },
      { name: 'marginType', type: 'uint8' },
      { name: 'size', type: 'uint256' },
      { name: 'margin', type: 'uint256' },
      { name: 'marginToken', type: 'address' },
      { name: 'entryPrice', type: 'uint256' },
      { name: 'entryFundingIndex', type: 'int256' },
      { name: 'lastUpdateTime', type: 'uint256' },
      { name: 'isOpen', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'markets',
    outputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'symbol', type: 'string' },
      { name: 'baseAsset', type: 'address' },
      { name: 'maxLeverage', type: 'uint256' },
      { name: 'maintenanceMarginBps', type: 'uint256' },
      { name: 'takerFeeBps', type: 'uint256' },
      { name: 'makerFeeBps', type: 'uint256' },
      { name: 'maxOpenInterest', type: 'uint256' },
      { name: 'currentOpenInterest', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'fundingStates',
    outputs: [
      { name: 'fundingRate', type: 'int256' },
      { name: 'cumulativeFundingIndex', type: 'int256' },
      { name: 'lastFundingTime', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'trader', type: 'address' }],
    name: 'traderPositions',
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'getMarkPrice',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'allMarketIds',
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const MARGIN_MANAGER_ABI = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'trader', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    name: 'getBalance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'trader', type: 'address' }],
    name: 'getTotalCollateralValue',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const PositionSide = {
  Long: 0,
  Short: 1,
} as const
export type PositionSide = (typeof PositionSide)[keyof typeof PositionSide]

// Type guard for PositionSide
function isPositionSide(value: number): value is PositionSide {
  return value === PositionSide.Long || value === PositionSide.Short
}

export const MarginType = {
  Isolated: 0,
  Cross: 1,
} as const
export type MarginType = (typeof MarginType)[keyof typeof MarginType]

// Type guard for MarginType
function isMarginType(value: number): value is MarginType {
  return value === MarginType.Isolated || value === MarginType.Cross
}

export interface PerpMarket {
  marketId: Hex
  symbol: string
  baseAsset: Address
  maxLeverage: number
  maintenanceMarginBps: number
  takerFeeBps: number
  makerFeeBps: number
  maxOpenInterest: bigint
  currentOpenInterest: bigint
  isActive: boolean
  // Live data
  markPrice?: bigint
  fundingRate?: bigint
  chainId: number
}

export interface PerpPosition {
  positionId: Hex
  trader: Address
  marketId: Hex
  symbol: string
  side: PositionSide
  marginType: MarginType
  size: bigint
  margin: bigint
  marginToken: Address
  entryPrice: bigint
  isOpen: boolean
  // Computed
  markPrice: bigint
  unrealizedPnl: bigint
  leverage: number
  liquidationPrice: bigint
  chainId: number
}

export interface OpenPositionParams {
  marketId: Hex
  size: bigint
  side: PositionSide
  marginType: MarginType
  marginToken: Address
  marginAmount: bigint
  slippageBps: number
}

export interface ClosePositionParams {
  positionId: Hex
  sizeToClose: bigint
  slippageBps: number
}

const PRICE_PRECISION = 10n ** 8n
const BPS_DENOMINATOR = 10000n

// Helper to convert string to hex (browser-safe, no Buffer)
function stringToHex(str: string): string {
  return [...str]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
}

// Common market IDs
export const MARKET_IDS: Record<string, Hex> = {
  'BTC-PERP': `0x${stringToHex('BTC-PERP').padEnd(64, '0')}`,
  'ETH-PERP': `0x${stringToHex('ETH-PERP').padEnd(64, '0')}`,
}

export class PerpsService {
  private chainId: number
  private clientCache = new Map<number, PublicClient>()

  constructor(chainId: number = 8453) {
    this.chainId = chainId
  }

  setChain(chainId: number) {
    this.chainId = chainId
  }

  private getContracts() {
    return getChainContracts(this.chainId)
  }

  private getClient(): PublicClient {
    if (isSupportedChainId(this.chainId)) {
      return rpcService.getClient(this.chainId)
    }
    const cached = this.clientCache.get(this.chainId)
    if (cached) {
      return cached
    }
    const rpcUrl = getNetworkRpcUrl(this.chainId) || 'http://localhost:6546'
    const client = createPublicClient({ transport: http(rpcUrl) })
    this.clientCache.set(this.chainId, client)
    return client
  }

  /**
   * Get all available markets
   */
  async getMarkets(): Promise<PerpMarket[]> {
    const perpMarket = this.getContracts().perpetualMarket
    if (!perpMarket) return []

    const client = this.getClient()

    // Get all market IDs
    const marketIds = await client.readContract({
      address: perpMarket,
      abi: PERP_MARKET_ABI,
      functionName: 'allMarketIds',
      args: [],
    })

    const markets: PerpMarket[] = []

    for (const marketId of marketIds) {
      const [marketResult, fundingResult, markPrice] = await Promise.all([
        client.readContract({
          address: perpMarket,
          abi: PERP_MARKET_ABI,
          functionName: 'markets',
          args: [marketId],
        }),
        client.readContract({
          address: perpMarket,
          abi: PERP_MARKET_ABI,
          functionName: 'fundingStates',
          args: [marketId],
        }),
        client.readContract({
          address: perpMarket,
          abi: PERP_MARKET_ABI,
          functionName: 'getMarkPrice',
          args: [marketId],
        }),
      ])

      // Destructure market tuple: [marketId, symbol, baseAsset, maxLeverage, maintenanceMarginBps, takerFeeBps, makerFeeBps, maxOpenInterest, currentOpenInterest, isActive]
      type MarketTuple = [
        Hex,
        string,
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        boolean,
      ]
      const [
        mktId,
        symbol,
        baseAsset,
        maxLev,
        maintMargin,
        takerFee,
        makerFee,
        maxOI,
        currOI,
        isActive,
      ] = asTuple<MarketTuple>(marketResult, 10)

      // Destructure funding tuple: [fundingRate, cumulativeFundingIndex, lastFundingTime]
      type FundingTuple = [bigint, bigint, bigint]
      const [fundingRate, _cumFunding, _lastTime] = asTuple<FundingTuple>(
        fundingResult,
        3,
      )

      markets.push({
        marketId: mktId,
        symbol,
        baseAsset,
        maxLeverage: Number(maxLev),
        maintenanceMarginBps: Number(maintMargin),
        takerFeeBps: Number(takerFee),
        makerFeeBps: Number(makerFee),
        maxOpenInterest: maxOI,
        currentOpenInterest: currOI,
        isActive,
        markPrice,
        fundingRate,
        chainId: this.chainId,
      })
    }

    return markets
  }

  /**
   * Get a specific market
   */
  async getMarket(marketId: Hex): Promise<PerpMarket | null> {
    const perpMarket = this.getContracts().perpetualMarket
    if (!perpMarket) return null

    const client = this.getClient()

    const [marketResult, fundingResult, markPrice] = await Promise.all([
      client.readContract({
        address: perpMarket,
        abi: PERP_MARKET_ABI,
        functionName: 'markets',
        args: [marketId],
      }),
      client.readContract({
        address: perpMarket,
        abi: PERP_MARKET_ABI,
        functionName: 'fundingStates',
        args: [marketId],
      }),
      client.readContract({
        address: perpMarket,
        abi: PERP_MARKET_ABI,
        functionName: 'getMarkPrice',
        args: [marketId],
      }),
    ])

    // Destructure tuples using type-safe helpers
    type MarketTuple = [
      Hex,
      string,
      Address,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ]
    const [
      mktId,
      symbol,
      baseAsset,
      maxLev,
      maintMargin,
      takerFee,
      makerFee,
      maxOI,
      currOI,
      isActive,
    ] = asTuple<MarketTuple>(marketResult, 10)

    type FundingTuple = [bigint, bigint, bigint]
    const [fundingRate, _cumFunding, _lastTime] = asTuple<FundingTuple>(
      fundingResult,
      3,
    )

    if (!isActive) return null

    return {
      marketId: mktId,
      symbol,
      baseAsset,
      maxLeverage: Number(maxLev),
      maintenanceMarginBps: Number(maintMargin),
      takerFeeBps: Number(takerFee),
      makerFeeBps: Number(makerFee),
      maxOpenInterest: maxOI,
      currentOpenInterest: currOI,
      isActive,
      markPrice,
      fundingRate,
      chainId: this.chainId,
    }
  }

  /**
   * Get all positions for a trader
   */
  async getPositions(trader: Address): Promise<PerpPosition[]> {
    const perpMarket = this.getContracts().perpetualMarket
    if (!perpMarket) return []

    const client = this.getClient()

    const positionIds = await client.readContract({
      address: perpMarket,
      abi: PERP_MARKET_ABI,
      functionName: 'traderPositions',
      args: [trader],
    })

    const positions: PerpPosition[] = []

    for (const positionId of positionIds) {
      const position = await this.getPosition(positionId)
      if (position?.isOpen) {
        positions.push(position)
      }
    }

    return positions
  }

  /**
   * Get a specific position
   */
  async getPosition(positionId: Hex): Promise<PerpPosition | null> {
    const perpMarket = this.getContracts().perpetualMarket
    if (!perpMarket) return null

    const client = this.getClient()

    // Returns tuple: [positionId, trader, marketId, side, marginType, size, margin, marginToken, entryPrice, entryFundingIndex, lastUpdateTime, isOpen]
    const result = await client.readContract({
      address: perpMarket,
      abi: PERP_MARKET_ABI,
      functionName: 'positions',
      args: [positionId],
    })

    // Destructure tuple result with type-safe helper
    type PositionTuple = [
      Hex,
      Address,
      Hex,
      number,
      number,
      bigint,
      bigint,
      Address,
      bigint,
      bigint,
      bigint,
      boolean,
    ]
    const [
      posId,
      trader,
      marketId,
      side,
      marginType,
      size,
      margin,
      marginToken,
      entryPrice,
      _fundingIdx,
      _lastUpdate,
      isOpen,
    ] = asTuple<PositionTuple>(result, 12)

    if (!isOpen) return null

    const [market, markPrice] = await Promise.all([
      this.getMarket(marketId),
      client.readContract({
        address: perpMarket,
        abi: PERP_MARKET_ABI,
        functionName: 'getMarkPrice',
        args: [marketId],
      }),
    ])

    // Calculate unrealized PnL
    const priceDiff =
      side === PositionSide.Long
        ? markPrice - entryPrice
        : entryPrice - markPrice
    const unrealizedPnl = (priceDiff * size) / PRICE_PRECISION

    // Calculate leverage
    const notionalValue = (size * markPrice) / PRICE_PRECISION
    const leverage =
      margin > 0n ? Number((notionalValue * 100n) / margin) / 100 : 0

    // Calculate liquidation price
    const maintenanceMarginBps = market?.maintenanceMarginBps || 500
    const maintenanceMargin =
      (notionalValue * BigInt(maintenanceMarginBps)) / BPS_DENOMINATOR
    const marginBuffer = margin - maintenanceMargin
    const liquidationPrice =
      side === PositionSide.Long
        ? entryPrice - (marginBuffer * PRICE_PRECISION) / size
        : entryPrice + (marginBuffer * PRICE_PRECISION) / size

    // Validate enum values from contract
    if (!isPositionSide(side)) {
      throw new Error(`Invalid position side: ${side}`)
    }
    if (!isMarginType(marginType)) {
      throw new Error(`Invalid margin type: ${marginType}`)
    }

    return {
      positionId: posId,
      trader,
      marketId,
      symbol: market?.symbol || 'Unknown',
      side,
      marginType,
      size,
      margin,
      marginToken,
      entryPrice,
      isOpen,
      markPrice,
      unrealizedPnl,
      leverage,
      liquidationPrice: liquidationPrice > 0n ? liquidationPrice : 0n,
      chainId: this.chainId,
    }
  }

  /**
   * Build open position transaction
   */
  async buildOpenPositionTx(
    params: OpenPositionParams,
  ): Promise<{ to: Address; data: Hex } | null> {
    const perpMarket = this.getContracts().perpetualMarket
    if (!perpMarket) return null

    const market = await this.getMarket(params.marketId)
    if (!market || !market.markPrice) return null

    // Calculate max/min price with slippage
    const slippageMultiplier =
      params.side === PositionSide.Long
        ? 10000n + BigInt(params.slippageBps)
        : 10000n - BigInt(params.slippageBps)
    const maxPrice = (market.markPrice * slippageMultiplier) / 10000n

    const data = encodeFunctionData({
      abi: PERP_MARKET_ABI,
      functionName: 'openPosition',
      args: [
        params.marketId,
        params.size,
        params.side,
        params.marginType,
        params.marginToken,
        params.marginAmount,
        maxPrice,
      ],
    })

    return { to: perpMarket, data }
  }

  /**
   * Build close position transaction
   */
  async buildClosePositionTx(
    params: ClosePositionParams,
  ): Promise<{ to: Address; data: Hex } | null> {
    const perpMarket = this.getContracts().perpetualMarket
    if (!perpMarket) return null

    const position = await this.getPosition(params.positionId)
    if (!position) return null

    // Calculate min price with slippage
    const slippageMultiplier =
      position.side === PositionSide.Long
        ? 10000n - BigInt(params.slippageBps)
        : 10000n + BigInt(params.slippageBps)
    const minPrice = (position.markPrice * slippageMultiplier) / 10000n

    const data = encodeFunctionData({
      abi: PERP_MARKET_ABI,
      functionName: 'closePosition',
      args: [params.positionId, params.sizeToClose, minPrice],
    })

    return { to: perpMarket, data }
  }

  /**
   * Build add margin transaction
   */
  buildAddMarginTx(
    positionId: Hex,
    amount: bigint,
  ): { to: Address; data: Hex } | null {
    const perpMarket = this.getContracts().perpetualMarket
    if (!perpMarket) return null

    const data = encodeFunctionData({
      abi: PERP_MARKET_ABI,
      functionName: 'addMargin',
      args: [positionId, amount],
    })

    return { to: perpMarket, data }
  }

  /**
   * Build remove margin transaction
   */
  buildRemoveMarginTx(
    positionId: Hex,
    amount: bigint,
  ): { to: Address; data: Hex } | null {
    const perpMarket = this.getContracts().perpetualMarket
    if (!perpMarket) return null

    const data = encodeFunctionData({
      abi: PERP_MARKET_ABI,
      functionName: 'removeMargin',
      args: [positionId, amount],
    })

    return { to: perpMarket, data }
  }

  /**
   * Get margin balance
   */
  async getMarginBalance(trader: Address, token: Address): Promise<bigint> {
    const marginManager = this.getContracts().marginManager
    if (!marginManager) return 0n

    const client = this.getClient()
    return client.readContract({
      address: marginManager,
      abi: MARGIN_MANAGER_ABI,
      functionName: 'getBalance',
      args: [trader, token],
    })
  }

  /**
   * Build deposit margin transaction
   */
  buildDepositMarginTx(
    token: Address,
    amount: bigint,
  ): { to: Address; data: Hex } | null {
    const marginManager = this.getContracts().marginManager
    if (!marginManager) return null

    const data = encodeFunctionData({
      abi: MARGIN_MANAGER_ABI,
      functionName: 'deposit',
      args: [token, amount],
    })

    return { to: marginManager, data }
  }

  /**
   * Format price for display
   */
  formatPrice(price: bigint): string {
    return formatUnits(price, 8)
  }

  /**
   * Parse price from string
   */
  parsePrice(price: string): bigint {
    return parseUnits(price, 8)
  }
}

export const perpsService = new PerpsService()
