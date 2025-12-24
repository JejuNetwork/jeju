/**
 * Perps Module - Perpetual Futures Trading
 *
 * Provides access to:
 * - Perpetual markets
 * - Position management
 * - Order placement
 * - Liquidations
 * - Funding rates
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseEther } from 'viem'
import { z } from 'zod'
import { requireContract } from '../config'
import type { JejuWallet } from '../wallet'

// Contract return type schemas
const MarketSchema = z.object({
  marketId: z.string().transform((s) => s as Hex),
  symbol: z.string(),
  baseAsset: z.string().transform((s) => s as Address),
  quoteAsset: z.string().transform((s) => s as Address),
  oracle: z.string().transform((s) => s as Address),
  maxLeverage: z.bigint(),
  maintenanceMarginBps: z.bigint(),
  initialMarginBps: z.bigint(),
  takerFeeBps: z.bigint(),
  makerFeeBps: z.bigint(),
  maxOpenInterest: z.bigint(),
  fundingInterval: z.bigint(),
  isActive: z.boolean(),
})

const FundingDataSchema = z.object({
  fundingRate: z.bigint(),
  fundingIndex: z.bigint(),
  lastFundingTime: z.bigint(),
  nextFundingTime: z.bigint(),
})

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const PositionSide = {
  Long: 0,
  Short: 1,
} as const
export type PositionSide = (typeof PositionSide)[keyof typeof PositionSide]

export const MarginType = {
  Isolated: 0,
  Cross: 1,
} as const
export type MarginType = (typeof MarginType)[keyof typeof MarginType]

export const OrderType = {
  Market: 0,
  Limit: 1,
  StopLoss: 2,
  TakeProfit: 3,
} as const
export type OrderType = (typeof OrderType)[keyof typeof OrderType]

export const OrderStatus = {
  Pending: 0,
  Filled: 1,
  Cancelled: 2,
  Expired: 3,
} as const
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus]

export interface MarketConfig {
  marketId: Hex
  symbol: string
  baseAsset: Address
  quoteAsset: Address
  oracle: Address
  maxLeverage: number
  maintenanceMarginBps: number
  initialMarginBps: number
  takerFeeBps: number
  makerFeeBps: number
  maxOpenInterest: bigint
  fundingInterval: bigint
  isActive: boolean
}

export interface PerpsPosition {
  positionId: Hex
  trader: Address
  marketId: Hex
  side: PositionSide
  marginType: MarginType
  size: bigint
  margin: bigint
  marginToken: Address
  entryPrice: bigint
  entryFundingIndex: bigint
  lastUpdateTime: bigint
  isOpen: boolean
}

export interface Order {
  orderId: Hex
  trader: Address
  marketId: Hex
  side: PositionSide
  orderType: OrderType
  size: bigint
  price: bigint
  triggerPrice: bigint
  margin: bigint
  marginToken: Address
  leverage: number
  deadline: bigint
  status: OrderStatus
}

export interface TradeResult {
  positionId: Hex
  executionPrice: bigint
  fee: bigint
  realizedPnl: bigint
  fundingPaid: bigint
}

export interface FundingData {
  fundingRate: bigint
  fundingIndex: bigint
  lastFundingTime: bigint
  nextFundingTime: bigint
}

export interface OpenPositionParams {
  marketId: Hex
  marginToken: Address
  marginAmount: bigint
  size: bigint
  side: PositionSide
  leverage: number
}

export interface PlaceOrderParams {
  marketId: Hex
  marginToken: Address
  margin: bigint
  size: bigint
  side: PositionSide
  orderType: OrderType
  price: bigint
  triggerPrice?: bigint
  leverage: number
  deadline: bigint
}

export interface PerpsModule {
  // Market Info
  getMarket(marketId: Hex): Promise<MarketConfig | null>
  getAllMarkets(): Promise<MarketConfig[]>
  getMarkPrice(marketId: Hex): Promise<bigint>
  getIndexPrice(marketId: Hex): Promise<bigint>
  getFundingRate(marketId: Hex): Promise<bigint>
  getFundingData(marketId: Hex): Promise<FundingData>
  getOpenInterest(marketId: Hex): Promise<{ longOI: bigint; shortOI: bigint }>

  // Position Management
  openPosition(params: OpenPositionParams): Promise<TradeResult>
  closePosition(positionId: Hex): Promise<TradeResult>
  decreasePosition(positionId: Hex, sizeDecrease: bigint): Promise<TradeResult>
  addMargin(positionId: Hex, amount: bigint): Promise<Hex>
  removeMargin(positionId: Hex, amount: bigint): Promise<Hex>

  // Position Queries
  getPosition(positionId: Hex): Promise<PerpsPosition | null>
  getTraderPositions(trader?: Address): Promise<PerpsPosition[]>
  getPositionPnl(
    positionId: Hex,
  ): Promise<{ unrealizedPnl: bigint; fundingPnl: bigint }>
  getLiquidationPrice(positionId: Hex): Promise<bigint>
  isLiquidatable(
    positionId: Hex,
  ): Promise<{ canLiquidate: boolean; healthFactor: bigint }>

  // Orders
  placeOrder(params: PlaceOrderParams): Promise<Hex>
  cancelOrder(orderId: Hex): Promise<Hex>
  executeOrder(orderId: Hex): Promise<TradeResult>
  getOrder(orderId: Hex): Promise<Order | null>
  getTraderOrders(trader?: Address): Promise<Order[]>

  // Liquidation
  liquidate(positionId: Hex): Promise<{ txHash: Hex; liquidatorReward: bigint }>

  // Constants
  readonly MAX_LEVERAGE: number
  readonly MIN_MARGIN: bigint
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const PERPS_MARKET_ABI = [
  {
    name: 'openPosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'marginToken', type: 'address' },
      { name: 'marginAmount', type: 'uint256' },
      { name: 'size', type: 'uint256' },
      { name: 'side', type: 'uint8' },
      { name: 'leverage', type: 'uint256' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'positionId', type: 'bytes32' },
          { name: 'executionPrice', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'realizedPnl', type: 'int256' },
          { name: 'fundingPaid', type: 'int256' },
        ],
      },
    ],
  },
  {
    name: 'closePosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'positionId', type: 'bytes32' },
          { name: 'executionPrice', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'realizedPnl', type: 'int256' },
          { name: 'fundingPaid', type: 'int256' },
        ],
      },
    ],
  },
  {
    name: 'decreasePosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'sizeDecrease', type: 'uint256' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'positionId', type: 'bytes32' },
          { name: 'executionPrice', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'realizedPnl', type: 'int256' },
          { name: 'fundingPaid', type: 'int256' },
        ],
      },
    ],
  },
  {
    name: 'addMargin',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'removeMargin',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'placeOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'orderId', type: 'bytes32' },
          { name: 'trader', type: 'address' },
          { name: 'marketId', type: 'bytes32' },
          { name: 'side', type: 'uint8' },
          { name: 'orderType', type: 'uint8' },
          { name: 'size', type: 'uint256' },
          { name: 'price', type: 'uint256' },
          { name: 'triggerPrice', type: 'uint256' },
          { name: 'margin', type: 'uint256' },
          { name: 'marginToken', type: 'address' },
          { name: 'leverage', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'cancelOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'executeOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'positionId', type: 'bytes32' },
          { name: 'executionPrice', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'realizedPnl', type: 'int256' },
          { name: 'fundingPaid', type: 'int256' },
        ],
      },
    ],
  },
  {
    name: 'liquidate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
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
      },
    ],
  },
  {
    name: 'getMarket',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'marketId', type: 'bytes32' },
          { name: 'symbol', type: 'string' },
          { name: 'baseAsset', type: 'address' },
          { name: 'quoteAsset', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'maxLeverage', type: 'uint256' },
          { name: 'maintenanceMarginBps', type: 'uint256' },
          { name: 'initialMarginBps', type: 'uint256' },
          { name: 'takerFeeBps', type: 'uint256' },
          { name: 'makerFeeBps', type: 'uint256' },
          { name: 'maxOpenInterest', type: 'uint256' },
          { name: 'fundingInterval', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getAllMarkets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'getMarkPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getIndexPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getFundingRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'int256' }],
  },
  {
    name: 'getFundingData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'fundingRate', type: 'int256' },
          { name: 'fundingIndex', type: 'int256' },
          { name: 'lastFundingTime', type: 'uint256' },
          { name: 'nextFundingTime', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getMarketOpenInterest',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      { name: 'longOI', type: 'uint256' },
      { name: 'shortOI', type: 'uint256' },
    ],
  },
  {
    name: 'getTraderPositions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'trader', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'getPositionPnl',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      { name: 'unrealizedPnl', type: 'int256' },
      { name: 'fundingPnl', type: 'int256' },
    ],
  },
  {
    name: 'getLiquidationPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'isLiquidatable',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      { name: 'canLiquidate', type: 'bool' },
      { name: 'healthFactor', type: 'uint256' },
    ],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createPerpsModule(
  wallet: JejuWallet,
  network: NetworkType,
): PerpsModule {
  const perpsMarketAddress = requireContract(
    'perps',
    'PerpetualMarket',
    network,
  )

  const MAX_LEVERAGE = 50
  const MIN_MARGIN = parseEther('0.001')

  return {
    MAX_LEVERAGE,
    MIN_MARGIN,

    async getMarket(marketId) {
      const result = await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getMarket',
        args: [marketId],
      })

      const market = MarketSchema.parse(result)

      if (market.marketId === (`0x${'0'.repeat(64)}` as Hex)) return null

      return {
        ...market,
        maxLeverage: Number(market.maxLeverage),
        maintenanceMarginBps: Number(market.maintenanceMarginBps),
        initialMarginBps: Number(market.initialMarginBps),
        takerFeeBps: Number(market.takerFeeBps),
        makerFeeBps: Number(market.makerFeeBps),
      }
    },

    async getAllMarkets() {
      const marketIds = (await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getAllMarkets',
      })) as Hex[]

      // Limit to prevent DoS from large arrays
      const MAX_MARKETS = 100
      const markets: MarketConfig[] = []
      const limitedIds = marketIds.slice(0, MAX_MARKETS)
      for (const id of limitedIds) {
        const market = await this.getMarket(id)
        if (market) markets.push(market)
      }
      return markets
    },

    async getMarkPrice(marketId) {
      return (await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getMarkPrice',
        args: [marketId],
      })) as bigint
    },

    async getIndexPrice(marketId) {
      return (await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getIndexPrice',
        args: [marketId],
      })) as bigint
    },

    async getFundingRate(marketId) {
      return (await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getFundingRate',
        args: [marketId],
      })) as bigint
    },

    async getFundingData(marketId) {
      const result = await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getFundingData',
        args: [marketId],
      })

      const data = FundingDataSchema.parse(result)

      return data
    },

    async getOpenInterest(marketId) {
      const result = await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getMarketOpenInterest',
        args: [marketId],
      })

      const [longOI, shortOI] = result as [bigint, bigint]
      return { longOI, shortOI }
    },

    async openPosition(params) {
      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'openPosition',
        args: [
          params.marketId,
          params.marginToken,
          params.marginAmount,
          params.size,
          params.side,
          BigInt(params.leverage),
        ],
      })

      const resultTxHash = await wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })

      // Return placeholder - actual result would come from tx receipt
      return {
        positionId: resultTxHash as Hex,
        executionPrice: 0n,
        fee: 0n,
        realizedPnl: 0n,
        fundingPaid: 0n,
      }
    },

    async closePosition(positionId) {
      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'closePosition',
        args: [positionId],
      })

      await wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })

      return {
        positionId,
        executionPrice: 0n,
        fee: 0n,
        realizedPnl: 0n,
        fundingPaid: 0n,
      }
    },

    async decreasePosition(positionId, sizeDecrease) {
      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'decreasePosition',
        args: [positionId, sizeDecrease],
      })

      await wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })

      return {
        positionId,
        executionPrice: 0n,
        fee: 0n,
        realizedPnl: 0n,
        fundingPaid: 0n,
      }
    },

    async addMargin(positionId, amount) {
      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'addMargin',
        args: [positionId, amount],
      })

      return wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })
    },

    async removeMargin(positionId, amount) {
      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'removeMargin',
        args: [positionId, amount],
      })

      return wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })
    },

    async getPosition(positionId) {
      const result = await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getPosition',
        args: [positionId],
      })

      const pos = result as PerpsPosition
      if (!pos.isOpen) return null
      return pos
    },

    async getTraderPositions(trader) {
      const address = trader ?? wallet.address
      const positionIds = (await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getTraderPositions',
        args: [address],
      })) as Hex[]

      // Limit to prevent DoS from large arrays
      const MAX_POSITIONS = 100
      const positions: PerpsPosition[] = []
      const limitedIds = positionIds.slice(0, MAX_POSITIONS)
      for (const id of limitedIds) {
        const pos = await this.getPosition(id)
        if (pos) positions.push(pos)
      }
      return positions
    },

    async getPositionPnl(positionId) {
      const result = await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getPositionPnl',
        args: [positionId],
      })

      const [unrealizedPnl, fundingPnl] = result as [bigint, bigint]
      return { unrealizedPnl, fundingPnl }
    },

    async getLiquidationPrice(positionId) {
      return (await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'getLiquidationPrice',
        args: [positionId],
      })) as bigint
    },

    async isLiquidatable(positionId) {
      const result = await wallet.publicClient.readContract({
        address: perpsMarketAddress,
        abi: PERPS_MARKET_ABI,
        functionName: 'isLiquidatable',
        args: [positionId],
      })

      const [canLiquidate, healthFactor] = result as [boolean, bigint]
      return { canLiquidate, healthFactor }
    },

    async placeOrder(params) {
      const order = {
        orderId: `0x${'0'.repeat(64)}` as Hex,
        trader: wallet.address,
        marketId: params.marketId,
        side: params.side,
        orderType: params.orderType,
        size: params.size,
        price: params.price,
        triggerPrice: params.triggerPrice ?? 0n,
        margin: params.margin,
        marginToken: params.marginToken,
        leverage: BigInt(params.leverage),
        deadline: params.deadline,
        status: OrderStatus.Pending,
      }

      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'placeOrder',
        args: [order],
      })

      return wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })
    },

    async cancelOrder(orderId) {
      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'cancelOrder',
        args: [orderId],
      })

      return wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })
    },

    async executeOrder(orderId) {
      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'executeOrder',
        args: [orderId],
      })

      const txHash = await wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })

      return {
        positionId: txHash as Hex,
        executionPrice: 0n,
        fee: 0n,
        realizedPnl: 0n,
        fundingPaid: 0n,
      }
    },

    async getOrder(_orderId) {
      // Would need to read from contract
      return null
    },

    async getTraderOrders(_trader) {
      return []
    },

    async liquidate(positionId) {
      const data = encodeFunctionData({
        abi: PERPS_MARKET_ABI,
        functionName: 'liquidate',
        args: [positionId],
      })

      const txHash = await wallet.sendTransaction({
        to: perpsMarketAddress,
        data,
      })

      return { txHash, liquidatorReward: 0n }
    },
  }
}
