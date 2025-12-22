/**
 * Prediction Module - LMSR-based prediction markets
 *
 * Provides access to:
 * - Market creation and management
 * - Buying/selling shares
 * - Position management
 * - Market resolution
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseEther } from 'viem'
import { requireContract } from '../config'
import type { JejuWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum GameType {
  GENERIC = 0,
  CALIGULAND = 1,
  CONTEST = 2,
  HYPERSCAPE = 3,
  CUSTOM = 4,
}

export enum MarketStatus {
  OPEN = 0,
  RESOLVED = 1,
  CANCELLED = 2,
}

export interface PredictionMarket {
  marketId: Hex
  sessionId: Hex
  gameType: GameType
  question: string
  oracle: Address
  liquidityParameter: bigint
  yesShares: bigint
  noShares: bigint
  totalVolume: bigint
  createdAt: bigint
  resolvedAt: bigint
  status: MarketStatus
  outcome: boolean
  creator: Address
}

export interface Position {
  marketId: Hex
  holder: Address
  yesShares: bigint
  noShares: bigint
  totalInvested: bigint
  totalClaimed: bigint
}

export interface CreateMarketParams {
  sessionId: Hex
  gameType: GameType
  question: string
  oracle: Address
  liquidityParameter?: bigint
  initialLiquidity?: bigint
}

export interface TradeParams {
  marketId: Hex
  isYes: boolean
  shares: bigint
  maxCost?: bigint
}

export interface PredictionModule {
  // Market Management
  createMarket(
    params: CreateMarketParams,
  ): Promise<{ marketId: Hex; txHash: Hex }>
  getMarket(marketId: Hex): Promise<PredictionMarket | null>
  listActiveMarkets(): Promise<PredictionMarket[]>
  listResolvedMarkets(): Promise<PredictionMarket[]>
  resolveMarket(marketId: Hex): Promise<Hex>
  cancelMarket(marketId: Hex): Promise<Hex>

  // Trading
  buyShares(params: TradeParams): Promise<Hex>
  sellShares(params: TradeParams): Promise<Hex>
  getBuyPrice(marketId: Hex, isYes: boolean, shares: bigint): Promise<bigint>
  getSellPrice(marketId: Hex, isYes: boolean, shares: bigint): Promise<bigint>
  getSpotPrice(marketId: Hex, isYes: boolean): Promise<number>

  // Positions
  getPosition(marketId: Hex, holder?: Address): Promise<Position | null>
  listMyPositions(): Promise<Position[]>
  claimWinnings(marketId: Hex): Promise<Hex>
  getClaimableAmount(marketId: Hex, holder?: Address): Promise<bigint>

  // Stats
  getMarketVolume(marketId: Hex): Promise<bigint>
  getTotalVolume(): Promise<bigint>
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const PREDICTION_MARKET_ABI = [
  {
    name: 'createMarket',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'gameType', type: 'uint8' },
      { name: 'question', type: 'string' },
      { name: 'oracle', type: 'address' },
      { name: 'liquidityParameter', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'markets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'gameType', type: 'uint8' },
      { name: 'question', type: 'string' },
      { name: 'oracle', type: 'address' },
      { name: 'liquidityParameter', type: 'uint256' },
      { name: 'yesShares', type: 'uint256' },
      { name: 'noShares', type: 'uint256' },
      { name: 'totalVolume', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'resolvedAt', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'outcome', type: 'bool' },
      { name: 'creator', type: 'address' },
    ],
  },
  {
    name: 'buyShares',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
      { name: 'maxCost', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'sellShares',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
      { name: 'minReturn', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getBuyPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getSellPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getSpotPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'positions',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'holder', type: 'address' },
    ],
    outputs: [
      { name: 'yesShares', type: 'uint256' },
      { name: 'noShares', type: 'uint256' },
      { name: 'totalInvested', type: 'uint256' },
      { name: 'totalClaimed', type: 'uint256' },
    ],
  },
  {
    name: 'claimWinnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getClaimableAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'holder', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'resolveMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'cancelMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getActiveMarkets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'totalVolume',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createPredictionModule(
  wallet: JejuWallet,
  network: NetworkType,
): PredictionModule {
  const predictionMarketAddress = requireContract(
    'prediction',
    'PredictionMarket',
    network,
  )

  async function readMarket(marketId: Hex): Promise<PredictionMarket | null> {
    const result = await wallet.publicClient.readContract({
      address: predictionMarketAddress,
      abi: PREDICTION_MARKET_ABI,
      functionName: 'markets',
      args: [marketId],
    })

    if (result[8] === 0n) return null

    return {
      marketId,
      sessionId: result[0],
      gameType: result[1] as GameType,
      question: result[2],
      oracle: result[3],
      liquidityParameter: result[4],
      yesShares: result[5],
      noShares: result[6],
      totalVolume: result[7],
      createdAt: result[8],
      resolvedAt: result[9],
      status: result[10] as MarketStatus,
      outcome: result[11],
      creator: result[12],
    }
  }

  return {
    async createMarket(params) {
      const liquidityParam = params.liquidityParameter ?? parseEther('1')

      const data = encodeFunctionData({
        abi: PREDICTION_MARKET_ABI,
        functionName: 'createMarket',
        args: [
          params.sessionId,
          params.gameType,
          params.question,
          params.oracle,
          liquidityParam,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: predictionMarketAddress,
        data,
        value: params.initialLiquidity ?? parseEther('0.1'),
      })

      return { marketId: params.sessionId, txHash }
    },

    getMarket: readMarket,

    async listActiveMarkets() {
      const ids = await wallet.publicClient.readContract({
        address: predictionMarketAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'getActiveMarkets',
        args: [],
      })

      const markets: PredictionMarket[] = []
      for (const id of ids) {
        const market = await readMarket(id)
        if (market && market.status === MarketStatus.OPEN) {
          markets.push(market)
        }
      }
      return markets
    },

    async listResolvedMarkets() {
      const ids = await wallet.publicClient.readContract({
        address: predictionMarketAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'getActiveMarkets',
        args: [],
      })

      const markets: PredictionMarket[] = []
      for (const id of ids) {
        const market = await readMarket(id)
        if (market && market.status === MarketStatus.RESOLVED) {
          markets.push(market)
        }
      }
      return markets
    },

    async resolveMarket(marketId) {
      const data = encodeFunctionData({
        abi: PREDICTION_MARKET_ABI,
        functionName: 'resolveMarket',
        args: [marketId],
      })
      return wallet.sendTransaction({ to: predictionMarketAddress, data })
    },

    async cancelMarket(marketId) {
      const data = encodeFunctionData({
        abi: PREDICTION_MARKET_ABI,
        functionName: 'cancelMarket',
        args: [marketId],
      })
      return wallet.sendTransaction({ to: predictionMarketAddress, data })
    },

    async buyShares(params) {
      const maxCost = params.maxCost ?? parseEther('1000')

      const data = encodeFunctionData({
        abi: PREDICTION_MARKET_ABI,
        functionName: 'buyShares',
        args: [params.marketId, params.isYes, params.shares, maxCost],
      })

      const cost = await this.getBuyPrice(
        params.marketId,
        params.isYes,
        params.shares,
      )

      return wallet.sendTransaction({
        to: predictionMarketAddress,
        data,
        value: cost,
      })
    },

    async sellShares(params) {
      const data = encodeFunctionData({
        abi: PREDICTION_MARKET_ABI,
        functionName: 'sellShares',
        args: [params.marketId, params.isYes, params.shares, 0n],
      })
      return wallet.sendTransaction({ to: predictionMarketAddress, data })
    },

    async getBuyPrice(marketId, isYes, shares) {
      return wallet.publicClient.readContract({
        address: predictionMarketAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'getBuyPrice',
        args: [marketId, isYes, shares],
      })
    },

    async getSellPrice(marketId, isYes, shares) {
      return wallet.publicClient.readContract({
        address: predictionMarketAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'getSellPrice',
        args: [marketId, isYes, shares],
      })
    },

    async getSpotPrice(marketId, isYes) {
      const price = await wallet.publicClient.readContract({
        address: predictionMarketAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'getSpotPrice',
        args: [marketId, isYes],
      })
      return Number(price) / 1e18 // Return as decimal probability
    },

    async getPosition(marketId, holder) {
      const result = await wallet.publicClient.readContract({
        address: predictionMarketAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'positions',
        args: [marketId, holder ?? wallet.address],
      })

      if (result[0] === 0n && result[1] === 0n) return null

      return {
        marketId,
        holder: holder ?? wallet.address,
        yesShares: result[0],
        noShares: result[1],
        totalInvested: result[2],
        totalClaimed: result[3],
      }
    },

    async listMyPositions() {
      // Would need to enumerate - simplified
      return []
    },

    async claimWinnings(marketId) {
      const data = encodeFunctionData({
        abi: PREDICTION_MARKET_ABI,
        functionName: 'claimWinnings',
        args: [marketId],
      })
      return wallet.sendTransaction({ to: predictionMarketAddress, data })
    },

    async getClaimableAmount(marketId, holder) {
      return wallet.publicClient.readContract({
        address: predictionMarketAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'getClaimableAmount',
        args: [marketId, holder ?? wallet.address],
      })
    },

    async getMarketVolume(marketId) {
      const market = await readMarket(marketId)
      if (!market) {
        throw new Error(`Market ${marketId} not found`)
      }
      return market.totalVolume
    },

    async getTotalVolume() {
      return wallet.publicClient.readContract({
        address: predictionMarketAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'totalVolume',
        args: [],
      })
    },
  }
}
