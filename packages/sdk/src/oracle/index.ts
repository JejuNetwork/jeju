/**
 * Oracle Module - Price Feeds and Data Oracles
 *
 * Provides access to:
 * - Price feeds (Chainlink-compatible)
 * - TWAP oracles
 * - Custom data feeds
 * - Oracle registry
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex } from 'viem'
import { z } from 'zod'
import { safeGetContract } from '../config'
import type { BaseWallet } from '../wallet'

// Contract return type schema
const OracleConfigSchema = z.object({
  oracleAddress: z.string().transform((s) => s as Address),
  oracleType: z.number(),
  heartbeat: z.bigint(),
  deviationThreshold: z.bigint(),
  description: z.string(),
})

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PriceFeed {
  feedAddress: Address
  description: string
  decimals: number
  latestRoundId: bigint
  latestPrice: bigint
  latestTimestamp: bigint
  isActive: boolean
}

export interface RoundData {
  roundId: bigint
  answer: bigint
  startedAt: bigint
  updatedAt: bigint
  answeredInRound: bigint
}

export interface TWAPObservation {
  timestamp: bigint
  price: bigint
  cumulativePrice: bigint
}

export interface OracleConfig {
  oracleAddress: Address
  oracleType: OracleType
  heartbeat: bigint
  deviationThreshold: number
  description: string
}

export const OracleType = {
  CHAINLINK: 0,
  TWAP: 1,
  CUSTOM: 2,
  PYTH: 3,
} as const
export type OracleType = (typeof OracleType)[keyof typeof OracleType]

export interface RegisterOracleParams {
  feedAddress: Address
  oracleType: OracleType
  description: string
  heartbeat: bigint
  deviationThreshold: number
}

export interface OracleModule {
  // Price Queries
  getLatestPrice(feedAddress: Address): Promise<bigint>
  getLatestRoundData(feedAddress: Address): Promise<RoundData>
  getRoundData(feedAddress: Address, roundId: bigint): Promise<RoundData>
  getDecimals(feedAddress: Address): Promise<number>
  getDescription(feedAddress: Address): Promise<string>

  // Historical Data
  getHistoricalPrices(
    feedAddress: Address,
    startRound: bigint,
    count: number,
  ): Promise<RoundData[]>

  // TWAP
  getTWAP(poolAddress: Address, period: bigint): Promise<bigint>
  getTWAPObservations(
    poolAddress: Address,
    count: number,
  ): Promise<TWAPObservation[]>
  consultTWAP(
    poolAddress: Address,
    tokenIn: Address,
    amountIn: bigint,
    period: bigint,
  ): Promise<bigint>

  // Feed Info
  getFeedInfo(feedAddress: Address): Promise<PriceFeed | null>
  listFeeds(): Promise<PriceFeed[]>
  getFeedByPair(
    baseToken: Address,
    quoteToken: Address,
  ): Promise<Address | null>

  // Oracle Registry
  registerOracle(params: RegisterOracleParams): Promise<Hex>
  getOracleConfig(oracleAddress: Address): Promise<OracleConfig | null>
  listOracles(): Promise<OracleConfig[]>
  updateOracleHeartbeat(oracleAddress: Address, heartbeat: bigint): Promise<Hex>

  // Data Submission (for custom oracles)
  submitPrice(feedId: Hex, price: bigint, timestamp: bigint): Promise<Hex>
  submitBatchPrices(
    updates: { feedId: Hex; price: bigint; timestamp: bigint }[],
  ): Promise<Hex>

  // Validation
  isPriceStale(feedAddress: Address): Promise<boolean>
  isPriceValid(feedAddress: Address, maxAge: bigint): Promise<boolean>
  getLastUpdateTime(feedAddress: Address): Promise<bigint>

  // Price Conversion
  convertPrice(
    amount: bigint,
    fromFeed: Address,
    toFeed: Address,
  ): Promise<bigint>
  getUSDPrice(tokenAddress: Address): Promise<bigint>

  // Constants
  readonly MAX_PRICE_AGE: bigint
  readonly MIN_OBSERVATIONS: number
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const CHAINLINK_AGGREGATOR_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    name: 'getRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'description',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'latestAnswer',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'int256' }],
  },
  {
    name: 'latestTimestamp',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const TWAP_ORACLE_ABI = [
  {
    name: 'consult',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'period', type: 'uint32' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getObservations',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'count', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'timestamp', type: 'uint256' },
          { name: 'price', type: 'uint256' },
          { name: 'cumulativePrice', type: 'uint256' },
        ],
      },
    ],
  },
] as const

const ORACLE_REGISTRY_ABI = [
  {
    name: 'registerOracle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'feedAddress', type: 'address' },
      { name: 'oracleType', type: 'uint8' },
      { name: 'description', type: 'string' },
      { name: 'heartbeat', type: 'uint256' },
      { name: 'deviationThreshold', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getOracleConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'oracleAddress', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'oracleAddress', type: 'address' },
          { name: 'oracleType', type: 'uint8' },
          { name: 'heartbeat', type: 'uint256' },
          { name: 'deviationThreshold', type: 'uint256' },
          { name: 'description', type: 'string' },
        ],
      },
    ],
  },
  {
    name: 'getFeedByPair',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'baseToken', type: 'address' },
      { name: 'quoteToken', type: 'address' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'getAllOracles',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'updateOracleHeartbeat',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'oracleAddress', type: 'address' },
      { name: 'heartbeat', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'submitPrice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'feedId', type: 'bytes32' },
      { name: 'price', type: 'int256' },
      { name: 'timestamp', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'submitBatchPrices',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'updates',
        type: 'tuple[]',
        components: [
          { name: 'feedId', type: 'bytes32' },
          { name: 'price', type: 'int256' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: 'getTWAP',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'poolAddress', type: 'address' },
      { name: 'period', type: 'uint32' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createOracleModule(
  wallet: BaseWallet,
  network: NetworkType,
): OracleModule {
  // Use safe getter - contracts may not be deployed on all networks
  const oracleRegistryAddressOpt = safeGetContract(
    'oracle',
    'OracleRegistry',
    network,
  )

  // Lazy-load contract address - throw on method call if not deployed
  const getOracleRegistryAddress = () => {
    if (!oracleRegistryAddressOpt) {
      throw new Error(
        'Oracle OracleRegistry contract not deployed on this network',
      )
    }
    return oracleRegistryAddressOpt
  }

  const MAX_PRICE_AGE = 3600n // 1 hour
  const MIN_OBSERVATIONS = 10

  return {
    MAX_PRICE_AGE,
    MIN_OBSERVATIONS,

    async getLatestPrice(feedAddress) {
      const result = await wallet.publicClient.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'latestAnswer',
      })

      return result
    },

    async getLatestRoundData(feedAddress) {
      const result = await wallet.publicClient.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      })

      const [roundId, answer, startedAt, updatedAt, answeredInRound] =
        result as [bigint, bigint, bigint, bigint, bigint]

      return {
        roundId,
        answer: BigInt(answer),
        startedAt,
        updatedAt,
        answeredInRound,
      }
    },

    async getRoundData(feedAddress, roundId) {
      const result = await wallet.publicClient.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'getRoundData',
        args: [roundId],
      })

      const [retRoundId, answer, startedAt, updatedAt, answeredInRound] =
        result as [bigint, bigint, bigint, bigint, bigint]

      return {
        roundId: retRoundId,
        answer: BigInt(answer),
        startedAt,
        updatedAt,
        answeredInRound,
      }
    },

    async getDecimals(feedAddress) {
      return await wallet.publicClient.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'decimals',
      })
    },

    async getDescription(feedAddress) {
      return await wallet.publicClient.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'description',
      })
    },

    async getHistoricalPrices(feedAddress, startRound, count) {
      const rounds: RoundData[] = []
      for (let i = 0; i < count; i++) {
        const roundId = startRound + BigInt(i)
        const data = await this.getRoundData(feedAddress, roundId)
        // Break if we get invalid data (answer = 0 indicates no data)
        if (data.answer === 0n) break
        rounds.push(data)
      }
      return rounds
    },

    async getTWAP(poolAddress, period) {
      return wallet.publicClient.readContract({
        address: getOracleRegistryAddress(),
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'getTWAP',
        args: [poolAddress, Number(period)],
      })
    },

    async getTWAPObservations(poolAddress, count) {
      const result = await wallet.publicClient.readContract({
        address: poolAddress,
        abi: TWAP_ORACLE_ABI,
        functionName: 'getObservations',
        args: [BigInt(count)],
      })

      return [...result]
    },

    async consultTWAP(poolAddress, tokenIn, amountIn, period) {
      return wallet.publicClient.readContract({
        address: poolAddress,
        abi: TWAP_ORACLE_ABI,
        functionName: 'consult',
        args: [tokenIn, amountIn, Number(period)],
      })
    },

    async getFeedInfo(feedAddress) {
      const [roundData, decimals, description] = await Promise.all([
        this.getLatestRoundData(feedAddress),
        this.getDecimals(feedAddress),
        this.getDescription(feedAddress),
      ])

      // Return null if feed has no data (roundId = 0 indicates uninitialized)
      if (roundData.roundId === 0n) return null

      return {
        feedAddress,
        description,
        decimals,
        latestRoundId: roundData.roundId,
        latestPrice: roundData.answer,
        latestTimestamp: roundData.updatedAt,
        isActive: true,
      }
    },

    async listFeeds() {
      const addresses = await wallet.publicClient.readContract({
        address: getOracleRegistryAddress(),
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'getAllOracles',
      })

      const feeds: PriceFeed[] = []
      for (const addr of addresses) {
        const feed = await this.getFeedInfo(addr)
        if (feed) feeds.push(feed)
      }
      return feeds
    },

    async getFeedByPair(baseToken, quoteToken) {
      const address = (await wallet.publicClient.readContract({
        address: getOracleRegistryAddress(),
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'getFeedByPair',
        args: [baseToken, quoteToken],
      })) as Address

      if (address === '0x0000000000000000000000000000000000000000') {
        return null
      }
      return address
    },

    async registerOracle(params) {
      const data = encodeFunctionData({
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'registerOracle',
        args: [
          params.feedAddress,
          params.oracleType,
          params.description,
          params.heartbeat,
          BigInt(params.deviationThreshold),
        ],
      })

      return wallet.sendTransaction({
        to: getOracleRegistryAddress(),
        data,
      })
    },

    async getOracleConfig(oracleAddress) {
      const result = await wallet.publicClient.readContract({
        address: getOracleRegistryAddress(),
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'getOracleConfig',
        args: [oracleAddress],
      })

      const config = OracleConfigSchema.parse(result)

      if (
        config.oracleAddress === '0x0000000000000000000000000000000000000000'
      ) {
        return null
      }

      return {
        ...config,
        oracleType: config.oracleType as OracleType,
        deviationThreshold: Number(config.deviationThreshold),
      }
    },

    async listOracles() {
      const addresses = await wallet.publicClient.readContract({
        address: getOracleRegistryAddress(),
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'getAllOracles',
      })

      const configs: OracleConfig[] = []
      for (const addr of addresses) {
        const config = await this.getOracleConfig(addr)
        if (config) configs.push(config)
      }
      return configs
    },

    async updateOracleHeartbeat(oracleAddress, heartbeat) {
      const data = encodeFunctionData({
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'updateOracleHeartbeat',
        args: [oracleAddress, heartbeat],
      })

      return wallet.sendTransaction({
        to: getOracleRegistryAddress(),
        data,
      })
    },

    async submitPrice(feedId, price, timestamp) {
      const data = encodeFunctionData({
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'submitPrice',
        args: [feedId, price, timestamp],
      })

      return wallet.sendTransaction({
        to: getOracleRegistryAddress(),
        data,
      })
    },

    async submitBatchPrices(updates) {
      const data = encodeFunctionData({
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'submitBatchPrices',
        args: [updates],
      })

      return wallet.sendTransaction({
        to: getOracleRegistryAddress(),
        data,
      })
    },

    async isPriceStale(feedAddress) {
      const roundData = await this.getLatestRoundData(feedAddress)
      const now = BigInt(Math.floor(Date.now() / 1000))
      return now - roundData.updatedAt > MAX_PRICE_AGE
    },

    async isPriceValid(feedAddress, maxAge) {
      const roundData = await this.getLatestRoundData(feedAddress)
      const now = BigInt(Math.floor(Date.now() / 1000))
      return now - roundData.updatedAt <= maxAge && roundData.answer > 0n
    },

    async getLastUpdateTime(feedAddress) {
      const roundData = await this.getLatestRoundData(feedAddress)
      return roundData.updatedAt
    },

    async convertPrice(amount, fromFeed, toFeed) {
      const [fromData, toData, fromDecimals, toDecimals] = await Promise.all([
        this.getLatestRoundData(fromFeed),
        this.getLatestRoundData(toFeed),
        this.getDecimals(fromFeed),
        this.getDecimals(toFeed),
      ])

      // Convert: amount * fromPrice / toPrice, adjusted for decimals
      const fromPrice = fromData.answer
      const toPrice = toData.answer

      const decimalAdjustment = 10n ** BigInt(toDecimals - fromDecimals)
      return (amount * fromPrice * decimalAdjustment) / toPrice
    },

    async getUSDPrice(tokenAddress) {
      // Would need token -> USD feed mapping
      const usdAddress = '0x0000000000000000000000000000000000000000' as Address
      const feed = await this.getFeedByPair(tokenAddress, usdAddress)

      if (!feed) {
        throw new Error('No USD feed found for token')
      }

      return this.getLatestPrice(feed)
    },
  }
}
