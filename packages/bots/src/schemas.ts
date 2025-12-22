/**
 * Zod Schemas for External Input Validation
 *
 * Validates all external data: API responses, configuration, CLI arguments
 */

import { AddressSchema } from '@jejunetwork/types'
import { z } from 'zod'

// ============ Constants ============

/** Weight precision: 10^18 */
export const WEIGHT_PRECISION = 10n ** 18n

/** Basis points precision: 10000 */
export const BPS_PRECISION = 10000n

// ============ Configuration Schemas ============

export const EVMChainIdSchema = z.union([
  z.literal(1),
  z.literal(10),
  z.literal(56),
  z.literal(137),
  z.literal(42161),
  z.literal(43114),
  z.literal(8453),
  z.literal(84532),
  z.literal(11155111),
  z.literal(11155420),
  z.literal(421614),
  z.literal(420690),
  z.literal(420691),
  z.literal(1337),
  z.literal(31337),
])

export const SolanaNetworkSchema = z.enum([
  'mainnet-beta',
  'devnet',
  'localnet',
  'solana-mainnet',
  'solana-devnet',
])

export const ChainRpcConfigSchema = z.object({
  chainId: EVMChainIdSchema,
  rpcUrl: z.string().url(),
  wsUrl: z.string().url().optional(),
  blockTimeMs: z.number().positive(),
})

export const TFMMRiskParametersSchema = z.object({
  minWeight: z.bigint(),
  maxWeight: z.bigint(),
  maxWeightChangeBps: z.number().int().positive(),
  minUpdateIntervalBlocks: z.number().int().positive(),
  oracleStalenessSeconds: z.number().int().positive(),
  maxPriceDeviationBps: z.number().int().positive(),
})

export const TFMMConfigSchema = z.object({
  updateIntervalMs: z.number().positive(),
  minConfidenceThreshold: z.number().min(0).max(1),
  maxGasPriceGwei: z.number().positive(),
  gasBuffer: z.number().positive(),
  blocksToTarget: z.number().int().positive(),
  riskParams: TFMMRiskParametersSchema,
})

export const MomentumStrategyConfigSchema = z.object({
  lookbackPeriodMs: z.number().positive(),
  shortTermPeriodMs: z.number().positive(),
  sensitivity: z.number().positive(),
  momentumThresholdBps: z.number().int().nonnegative(),
  useEMA: z.boolean(),
})
export type MomentumStrategyConfig = z.infer<
  typeof MomentumStrategyConfigSchema
>

export const MeanReversionStrategyConfigSchema = z.object({
  lookbackPeriodMs: z.number().positive(),
  deviationThreshold: z.number().positive(),
  sensitivity: z.number().positive(),
  useBollinger: z.boolean(),
  bollingerMultiplier: z.number().positive(),
})
export type MeanReversionStrategyConfig = z.infer<
  typeof MeanReversionStrategyConfigSchema
>

export const VolatilityStrategyConfigSchema = z.object({
  lookbackPeriodMs: z.number().positive(),
  targetVolatilityPct: z.number().positive(),
  maxVolatilityPct: z.number().positive(),
  useInverseVolWeighting: z.boolean(),
})
export type VolatilityStrategyConfig = z.infer<
  typeof VolatilityStrategyConfigSchema
>

export const CompositeStrategyConfigSchema = z.object({
  momentumWeight: z.number().min(0).max(1),
  meanReversionWeight: z.number().min(0).max(1),
  volatilityWeight: z.number().min(0).max(1),
  enableRegimeDetection: z.boolean(),
  minConfidenceThreshold: z.number().min(0).max(1),
})
export type CompositeStrategyConfig = z.infer<
  typeof CompositeStrategyConfigSchema
>

export const CrossChainArbConfigSchema = z.object({
  minProfitBps: z.number().int().nonnegative(),
  minProfitUsd: z.number().nonnegative(),
  maxSlippageBps: z.number().int().nonnegative(),
  maxPositionUsd: z.number().positive(),
  bridgeTimeoutSeconds: z.number().int().positive(),
  enabledChains: z.array(EVMChainIdSchema),
  enableExecution: z.boolean(),
})
export type CrossChainArbConfigValidated = z.infer<
  typeof CrossChainArbConfigSchema
>

export const FeeConfigSchema = z.object({
  swapFeeBps: z.number().int().nonnegative(),
  protocolFeeBps: z.number().int().nonnegative(),
  xlpFulfillmentFeeBps: z.number().int().nonnegative(),
  oifSolverFeeBps: z.number().int().nonnegative(),
  treasuryAddress: AddressSchema,
  governanceAddress: AddressSchema,
})

// ============ External API Response Schemas ============

export const CoinGeckoMarketChartSchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number()])),
  market_caps: z.array(z.tuple([z.number(), z.number()])),
  total_volumes: z.array(z.tuple([z.number(), z.number()])),
})
export type CoinGeckoMarketChart = z.infer<typeof CoinGeckoMarketChartSchema>

export const JupiterQuoteResponseSchema = z
  .object({
    outAmount: z.string(),
    inAmount: z.string().optional(),
    priceImpactPct: z.string().optional(),
    routePlan: z
      .array(
        z.object({
          swapInfo: z
            .object({
              ammKey: z.string(),
              label: z.string().optional(),
            })
            .passthrough(),
          percent: z.number(),
        }),
      )
      .optional(),
  })
  .passthrough()
export type JupiterQuoteResponse = z.infer<typeof JupiterQuoteResponseSchema>

export const IndexerPositionSchema = z.object({
  positionId: z.string(),
  trader: z.string(),
  marketId: z.string(),
  side: z.string(),
  size: z.string(),
  margin: z.string(),
  entryPrice: z.string(),
  liquidationPrice: z.string(),
  lastUpdateTime: z.number(),
})

export const IndexerPositionsResponseSchema = z.object({
  data: z
    .object({
      positions: z.array(IndexerPositionSchema),
    })
    .nullable(),
  errors: z
    .array(
      z.object({
        message: z.string(),
      }),
    )
    .optional(),
})
export type IndexerPositionsResponse = z.infer<
  typeof IndexerPositionsResponseSchema
>

// ============ Oracle Response Schemas ============

export const PythPriceSchema = z.object({
  price: z.bigint(),
  conf: z.bigint(),
  expo: z.number(),
  publishTime: z.bigint(),
})

export const ChainlinkRoundDataSchema = z.tuple([
  z.bigint(), // roundId
  z.bigint(), // answer
  z.bigint(), // startedAt
  z.bigint(), // updatedAt
  z.bigint(), // answeredInRound
])

// ============ Bot Engine Schemas ============

export const StrategyTypeSchema = z.enum([
  'dex-arbitrage',
  'cross-chain-arbitrage',
  'tfmm-rebalancer',
  'yield-farming',
  'liquidity-manager',
  'solver',
  'oracle-keeper',
])

export const BotEngineConfigSchema = z.object({
  chainId: EVMChainIdSchema,
  rpcUrl: z.string().url(),
  // Private key must be 0x-prefixed 64 hex chars - NEVER log or expose this value
  privateKey: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{64}$/,
      'Private key must be 0x-prefixed 64 hex characters',
    ),
  enabledStrategies: z.array(StrategyTypeSchema),
  healthCheckIntervalMs: z.number().positive(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
})
