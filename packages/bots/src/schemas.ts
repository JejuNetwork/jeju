/**
 * Zod Schemas for External Input Validation
 */

import { AddressSchema } from '@jejunetwork/types'
import { z } from 'zod'

/** Weight precision: 10^18 */
export const WEIGHT_PRECISION = 10n ** 18n

/** Basis points precision: 10000 */
export const BPS_PRECISION = 10000n

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

export const CoinGeckoMarketChartSchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number()])),
  market_caps: z.array(z.tuple([z.number(), z.number()])),
  total_volumes: z.array(z.tuple([z.number(), z.number()])),
})
export type CoinGeckoMarketChart = z.infer<typeof CoinGeckoMarketChartSchema>

export const IndexerPositionSchema = z.object({
  positionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid position ID'),
  trader: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid trader address'),
  marketId: z.string().min(1),
  side: z.enum(['0', '1']), // 0 = long, 1 = short
  size: z.string().regex(/^\d+$/, 'Size must be numeric string'),
  margin: z.string().regex(/^\d+$/, 'Margin must be numeric string'),
  entryPrice: z.string().regex(/^\d+$/, 'Entry price must be numeric string'),
  liquidationPrice: z
    .string()
    .regex(/^\d+$/, 'Liquidation price must be numeric string'),
  lastUpdateTime: z.number().int().nonnegative(),
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
  privateKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key format'),
  enabledStrategies: z.array(StrategyTypeSchema),
  healthCheckIntervalMs: z.number().positive(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
})

export const JupiterRouteSwapInfoSchema = z.object({
  ammKey: z.string(),
  label: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  feeAmount: z.string(),
  feeMint: z.string(),
})

export const JupiterRoutePlanSchema = z.object({
  swapInfo: JupiterRouteSwapInfoSchema,
  percent: z.number(),
})

export const JupiterQuoteResponseSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string(),
  swapMode: z.string(),
  slippageBps: z.number(),
  priceImpactPct: z.string(),
  routePlan: z.array(JupiterRoutePlanSchema),
  contextSlot: z.number(),
  timeTaken: z.number(),
})
export type JupiterQuoteResponse = z.infer<typeof JupiterQuoteResponseSchema>

// Flashbots API Schemas
export const FlashbotsRpcResponseSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
})
export type FlashbotsRpcResponse = z.infer<typeof FlashbotsRpcResponseSchema>

export const FlashbotsBundleResponseSchema = z.object({
  result: z.object({ bundleHash: z.string() }).optional(),
  error: z.object({ message: z.string() }).optional(),
})
export type FlashbotsBundleResponse = z.infer<
  typeof FlashbotsBundleResponseSchema
>

export const FlashbotsSimResultSchema = z.object({
  error: z.string().optional(),
  gasUsed: z.string(),
})

export const FlashbotsSimResponseSchema = z.object({
  result: z.object({ results: z.array(FlashbotsSimResultSchema) }).optional(),
  error: z.object({ message: z.string() }).optional(),
})
export type FlashbotsSimResponse = z.infer<typeof FlashbotsSimResponseSchema>

export const FlashbotsBundleStatsResponseSchema = z.object({
  result: z
    .object({
      isSimulated: z.boolean(),
      isSentToMiners: z.boolean(),
      isHighPriority: z.boolean(),
    })
    .optional(),
})
export type FlashbotsBundleStatsResponse = z.infer<
  typeof FlashbotsBundleStatsResponseSchema
>

// Cowswap API Schemas
export const CowswapOrderSchema = z.object({
  uid: z.string(),
  sellToken: AddressSchema,
  buyToken: AddressSchema,
  sellAmount: z.string(),
  buyAmount: z.string(),
  validTo: z.number(),
  appData: z.string(),
  feeAmount: z.string(),
  kind: z.enum(['sell', 'buy']),
  partiallyFillable: z.boolean(),
  receiver: AddressSchema,
  owner: AddressSchema,
})
export type CowswapOrder = z.infer<typeof CowswapOrderSchema>

export const CowswapOrdersResponseSchema = z.array(CowswapOrderSchema)

// UniswapX API Schemas
export const UniswapXOrderSchema = z.object({
  orderHash: z.string(),
  chainId: z.number(),
  swapper: AddressSchema,
  input: z.object({
    token: AddressSchema,
    amount: z.string(),
  }),
  outputs: z.array(
    z.object({
      token: AddressSchema,
      amount: z.string(),
      recipient: AddressSchema,
    }),
  ),
  deadline: z.number(),
})
export type UniswapXOrder = z.infer<typeof UniswapXOrderSchema>

export const UniswapXOrdersResponseSchema = z.object({
  orders: z.array(UniswapXOrderSchema),
})
export type UniswapXOrdersResponse = z.infer<
  typeof UniswapXOrdersResponseSchema
>

/** Parse and validate EVMChainId, throws if invalid */
export function expectEVMChainId(
  value: number,
  context?: string,
): z.infer<typeof EVMChainIdSchema> {
  const result = EVMChainIdSchema.safeParse(value)
  if (!result.success) {
    throw new Error(
      `Invalid EVMChainId${context ? ` in ${context}` : ''}: ${value} is not a supported chain`,
    )
  }
  return result.data
}
