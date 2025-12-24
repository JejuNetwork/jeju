/**
 * DeFi protocol types for staking, swaps, and liquidity.
 */

import { z } from 'zod'
import {
  AddressSchema,
  MAX_ARRAY_LENGTH,
  MAX_RECORD_KEYS,
  MAX_SHORT_STRING_LENGTH,
  MAX_SMALL_ARRAY_LENGTH,
} from './validation'

export type StakeStatus = 'idle' | 'pending' | 'complete' | 'error'

export type DexProtocol =
  | 'uniswap-v2'
  | 'uniswap-v3'
  | 'sushiswap'
  | 'curve'
  | 'balancer'
  | 'pancakeswap-v2'
  | 'pancakeswap-v3'
  | 'xlp-v2'
  | 'xlp-v3'
  | 'tfmm'

export const TokenSchema = z.object({
  address: AddressSchema,
  name: z.string(),
  symbol: z.string(),
  decimals: z.number(),
  chainId: z.number(),
})
export type Token = z.infer<typeof TokenSchema>

export const UniswapV4PoolSchema = z.object({
  poolId: z.string(),
  token0: TokenSchema,
  token1: TokenSchema,
  fee: z.number(),
  tickSpacing: z.number(),
  hooks: AddressSchema.optional(),
  sqrtPriceX96: z.string(),
  tick: z.number(),
  liquidity: z.string(),
})
export type UniswapV4Pool = z.infer<typeof UniswapV4PoolSchema>

export const SynthetixMarketSchema = z.object({
  marketId: z.number(),
  marketName: z.string().max(MAX_SHORT_STRING_LENGTH),
  marketSymbol: z.string().max(MAX_SHORT_STRING_LENGTH),
  maxFundingVelocity: z.string().max(MAX_SHORT_STRING_LENGTH),
  skewScale: z.string().max(MAX_SHORT_STRING_LENGTH),
  makerFee: z.string().max(MAX_SHORT_STRING_LENGTH),
  takerFee: z.string().max(MAX_SHORT_STRING_LENGTH),
  priceFeeds: z.array(AddressSchema).max(MAX_SMALL_ARRAY_LENGTH),
})
export type SynthetixMarket = z.infer<typeof SynthetixMarketSchema>

export const CompoundV3MarketSchema = z.object({
  cometAddress: AddressSchema,
  baseToken: TokenSchema,
  collateralTokens: z
    .array(
      z.object({
        token: TokenSchema,
        borrowCollateralFactor: z.string().max(MAX_SHORT_STRING_LENGTH),
        liquidateCollateralFactor: z.string().max(MAX_SHORT_STRING_LENGTH),
        liquidationFactor: z.string().max(MAX_SHORT_STRING_LENGTH),
        supplyCap: z.string().max(MAX_SHORT_STRING_LENGTH),
      }),
    )
    .max(MAX_SMALL_ARRAY_LENGTH),
  governor: AddressSchema,
  pauseGuardian: AddressSchema,
  baseBorrowMin: z.string().max(MAX_SHORT_STRING_LENGTH),
  targetReserves: z.string().max(MAX_SHORT_STRING_LENGTH),
})
export type CompoundV3Market = z.infer<typeof CompoundV3MarketSchema>

export const ChainlinkFeedSchema = z.object({
  pair: z.string(),
  address: AddressSchema,
  decimals: z.number(),
  heartbeat: z.number(),
  deviation: z.number(),
  latestRound: z.number().optional(),
  latestAnswer: z.string().optional(),
  latestTimestamp: z.number().optional(),
})
export type ChainlinkFeed = z.infer<typeof ChainlinkFeedSchema>

export const LiquidityPositionSchema = z.object({
  id: z.string(),
  owner: AddressSchema,
  pool: UniswapV4PoolSchema,
  tickLower: z.number(),
  tickUpper: z.number(),
  liquidity: z.string(),
  token0Amount: z.string(),
  token1Amount: z.string(),
})
export type LiquidityPosition = z.infer<typeof LiquidityPositionSchema>

export const PerpPositionSchema = z.object({
  accountId: z.number(),
  marketId: z.number(),
  size: z.string(),
  entryPrice: z.string(),
  leverage: z.string(),
  margin: z.string(),
  unrealizedPnl: z.string(),
  liquidationPrice: z.string(),
})
export type PerpPosition = z.infer<typeof PerpPositionSchema>

export const LendingPositionSchema = z.object({
  account: AddressSchema,
  comet: AddressSchema,
  collateral: z
    .array(
      z.object({
        token: AddressSchema,
        balance: z.string().max(MAX_SHORT_STRING_LENGTH),
        valueUsd: z.string().max(MAX_SHORT_STRING_LENGTH),
      }),
    )
    .max(MAX_SMALL_ARRAY_LENGTH),
  borrowed: z.string().max(MAX_SHORT_STRING_LENGTH),
  borrowedUsd: z.string().max(MAX_SHORT_STRING_LENGTH),
  borrowCapacity: z.string().max(MAX_SHORT_STRING_LENGTH),
  liquidationThreshold: z.string().max(MAX_SHORT_STRING_LENGTH),
  healthFactor: z.string().max(MAX_SHORT_STRING_LENGTH),
})
export type LendingPosition = z.infer<typeof LendingPositionSchema>

export const DeFiProtocolConfigSchema = z.object({
  uniswapV4: z.object({
    enabled: z.boolean(),
    poolsToInitialize: z
      .array(
        z.object({
          token0: AddressSchema,
          token1: AddressSchema,
          fee: z.number(),
          tickSpacing: z.number(),
          hooks: AddressSchema.optional(),
          initialPrice: z.string().max(MAX_SHORT_STRING_LENGTH),
        }),
      )
      .max(MAX_ARRAY_LENGTH),
  }),
  synthetixV3: z.object({
    enabled: z.boolean(),
    marketsToCreate: z
      .array(
        z.object({
          marketName: z.string().max(MAX_SHORT_STRING_LENGTH),
          marketSymbol: z.string().max(MAX_SHORT_STRING_LENGTH),
          maxFundingVelocity: z.string().max(MAX_SHORT_STRING_LENGTH),
          skewScale: z.string().max(MAX_SHORT_STRING_LENGTH),
          makerFee: z.string().max(MAX_SHORT_STRING_LENGTH),
          takerFee: z.string().max(MAX_SHORT_STRING_LENGTH),
          priceFeeds: z.array(AddressSchema).max(MAX_SMALL_ARRAY_LENGTH),
        }),
      )
      .max(MAX_ARRAY_LENGTH),
  }),
  compoundV3: z.object({
    enabled: z.boolean(),
    marketsToCreate: z
      .array(
        z.object({
          baseToken: AddressSchema,
          collateralTokens: z
            .array(
              z.object({
                token: AddressSchema,
                borrowCollateralFactor: z.string().max(MAX_SHORT_STRING_LENGTH),
                liquidateCollateralFactor: z
                  .string()
                  .max(MAX_SHORT_STRING_LENGTH),
                liquidationFactor: z.string().max(MAX_SHORT_STRING_LENGTH),
                supplyCap: z.string().max(MAX_SHORT_STRING_LENGTH),
              }),
            )
            .max(MAX_SMALL_ARRAY_LENGTH),
          governor: AddressSchema,
          pauseGuardian: AddressSchema,
          baseBorrowMin: z.string().max(MAX_SHORT_STRING_LENGTH),
          targetReserves: z.string().max(MAX_SHORT_STRING_LENGTH),
        }),
      )
      .max(MAX_ARRAY_LENGTH),
  }),
})
export type DeFiProtocolConfig = z.infer<typeof DeFiProtocolConfigSchema>

export const PaymasterDeploymentSchema = z.object({
  token: AddressSchema,
  tokenSymbol: z.string(),
  tokenName: z.string(),
  vault: AddressSchema,
  distributor: AddressSchema,
  paymaster: AddressSchema,
  deployedAt: z.number(),
  deployer: AddressSchema,
  network: z.string(),
})
export type PaymasterDeployment = z.infer<typeof PaymasterDeploymentSchema>

export const MultiTokenSystemSchema = z.object({
  oracle: AddressSchema,
  entryPoint: AddressSchema,
  deployments: z
    .record(z.string().max(MAX_SHORT_STRING_LENGTH), PaymasterDeploymentSchema)
    .refine((obj) => Object.keys(obj).length <= MAX_RECORD_KEYS, {
      message: `Cannot have more than ${MAX_RECORD_KEYS} deployments`,
    }),
  network: z.string().max(MAX_SHORT_STRING_LENGTH),
  chainId: z.number(),
  deployedAt: z.number(),
})
export type MultiTokenSystem = z.infer<typeof MultiTokenSystemSchema>

export const LPPositionSchema = z.object({
  vault: AddressSchema,
  token: AddressSchema,
  tokenSymbol: z.string(),
  ethShares: z.string(),
  ethValue: z.string(),
  tokenShares: z.string(),
  tokenValue: z.string(),
  pendingFees: z.string(),
  sharePercentage: z.number(),
})
export type LPPosition = z.infer<typeof LPPositionSchema>

export const PaymasterStatsSchema = z.object({
  paymaster: AddressSchema,
  token: AddressSchema,
  tokenSymbol: z.string(),
  entryPointBalance: z.string(),
  vaultLiquidity: z.string(),
  totalTransactions: z.number(),
  totalVolumeToken: z.string(),
  totalFeesCollected: z.string(),
  isOperational: z.boolean(),
  oracleFresh: z.boolean(),
  lastUpdate: z.number(),
})
export type PaymasterStats = z.infer<typeof PaymasterStatsSchema>
