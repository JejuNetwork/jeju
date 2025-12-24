/**
 * Zod schemas for external DEX API responses
 * Validates all data from Jupiter, Raydium, Meteora, and Orca APIs
 */

import { z } from 'zod'

// Common Validation Patterns

/** Base58 Solana address (32-44 characters) */
const Base58Address = z.string().min(32).max(44)

/** Numeric string (bigint-compatible) */
const NumericString = z.string().regex(/^\d+$/, 'Must be a numeric string')

/** Non-empty string label */
const NonEmptyString = z.string().min(1)

// Jupiter API Schemas

export const JupiterRouteSwapInfoSchema = z
  .object({
    ammKey: Base58Address,
    label: NonEmptyString,
    inputMint: Base58Address,
    outputMint: Base58Address,
    inAmount: NumericString,
    outAmount: NumericString,
    feeAmount: NumericString,
    feeMint: Base58Address,
  })
  .strict()

export const JupiterRoutePlanSchema = z
  .object({
    swapInfo: JupiterRouteSwapInfoSchema,
    percent: z.number().min(0).max(100),
  })
  .strict()

export const JupiterQuoteResponseSchema = z
  .object({
    inputMint: Base58Address,
    outputMint: Base58Address,
    inAmount: NumericString,
    outAmount: NumericString,
    otherAmountThreshold: NumericString,
    swapMode: z.enum(['ExactIn', 'ExactOut']),
    slippageBps: z.number().int().min(0).max(10000),
    priceImpactPct: z.string(), // Can be negative, so keep as string
    routePlan: z.array(JupiterRoutePlanSchema).min(1),
    contextSlot: z.number().int().nonnegative(),
    timeTaken: z.number().nonnegative(),
  })
  .strict()
export type JupiterQuoteResponse = z.infer<typeof JupiterQuoteResponseSchema>

export const JupiterSwapResponseSchema = z
  .object({
    swapTransaction: z.string().min(1), // Base64 encoded transaction
    lastValidBlockHeight: z.number().int().positive(),
    prioritizationFeeLamports: z.number().int().nonnegative(),
  })
  .strict()
export type JupiterSwapResponse = z.infer<typeof JupiterSwapResponseSchema>

export const JupiterTokenSchema = z
  .object({
    address: Base58Address,
    symbol: NonEmptyString,
    decimals: z.number().int().min(0).max(18),
    name: NonEmptyString,
  })
  .strict()

export const JupiterTokenListSchema = z.array(JupiterTokenSchema)
export type JupiterToken = z.infer<typeof JupiterTokenSchema>

// Raydium API Schemas

export const RaydiumMintInfoSchema = z
  .object({
    address: Base58Address,
    symbol: NonEmptyString,
    decimals: z.number().int().min(0).max(18),
  })
  .strict()

export const RaydiumAprSchema = z
  .object({
    fee: z.number().nonnegative(),
    reward: z.number().nonnegative(),
  })
  .strict()

export const RaydiumLpMintSchema = z
  .object({
    address: Base58Address,
  })
  .strict()

export const RaydiumPoolTypeSchema = z.enum(['Standard', 'Concentrated'])

export const RaydiumApiPoolSchema = z
  .object({
    id: Base58Address,
    mintA: RaydiumMintInfoSchema,
    mintB: RaydiumMintInfoSchema,
    mintAmountA: z.number().nonnegative(),
    mintAmountB: z.number().nonnegative(),
    tvl: z.number().nonnegative(),
    feeRate: z.number().min(0).max(1),
    apr: RaydiumAprSchema,
    lpMint: RaydiumLpMintSchema,
    type: RaydiumPoolTypeSchema,
  })
  .strict()
export type RaydiumApiPool = z.infer<typeof RaydiumApiPoolSchema>

export const RaydiumPoolListResponseSchema = z
  .object({
    data: z.object({
      data: z.array(RaydiumApiPoolSchema),
    }),
  })
  .strict()

export const RaydiumPoolDetailResponseSchema = z
  .object({
    data: z.array(RaydiumApiPoolSchema),
  })
  .strict()

export const RaydiumLPPositionSchema = z
  .object({
    poolId: Base58Address,
    lpMint: Base58Address,
    lpAmount: NumericString,
    tokenAAmount: NumericString,
    tokenBAmount: NumericString,
  })
  .strict()

export const RaydiumLPPositionsResponseSchema = z
  .object({
    data: z.array(RaydiumLPPositionSchema),
  })
  .strict()

export const RaydiumCLMMPositionSchema = z
  .object({
    nftMint: Base58Address,
    poolId: Base58Address,
    tickLower: z.number().int(),
    tickUpper: z.number().int(),
    liquidity: NumericString,
    tokenFeesOwedA: NumericString,
    tokenFeesOwedB: NumericString,
  })
  .strict()

export const RaydiumCLMMPositionsResponseSchema = z
  .object({
    data: z.array(RaydiumCLMMPositionSchema),
  })
  .strict()

// Meteora API Schemas

export const MeteoraPoolInfoSchema = z
  .object({
    address: Base58Address,
    name: NonEmptyString,
    mint_x: Base58Address,
    mint_y: Base58Address,
    reserve_x: NumericString,
    reserve_y: NumericString,
    reserve_x_amount: z.number().nonnegative(),
    reserve_y_amount: z.number().nonnegative(),
    bin_step: z.number().int().positive(),
    base_fee_percentage: z.string(), // Percentage as string (e.g., "0.25")
    liquidity: z.string(), // Can be decimal string
    current_price: z.number().positive(),
    apy: z.number(),
    hide: z.boolean(),
  })
  .strict()
export type MeteoraPoolInfo = z.infer<typeof MeteoraPoolInfoSchema>

export const MeteoraPoolListSchema = z.array(MeteoraPoolInfoSchema)

export const MeteoraPositionBinDataSchema = z
  .object({
    bin_id: z.number().int(),
    position_liquidity: NumericString,
  })
  .strict()

export const MeteoraPositionInfoSchema = z
  .object({
    address: Base58Address,
    pair_address: Base58Address,
    total_x_amount: NumericString,
    total_y_amount: NumericString,
    position_bin_data: z.array(MeteoraPositionBinDataSchema),
    fee_x: NumericString,
    fee_y: NumericString,
  })
  .strict()
export type MeteoraPositionInfo = z.infer<typeof MeteoraPositionInfoSchema>

export const MeteoraPositionsListSchema = z.array(MeteoraPositionInfoSchema)

// Orca API Schemas

export const OrcaWhirlpoolInfoSchema = z
  .object({
    address: Base58Address,
    tokenMintA: Base58Address,
    tokenMintB: Base58Address,
    tickSpacing: z.number().int().positive(),
    tickCurrentIndex: z.number().int(),
    sqrtPrice: NumericString,
    liquidity: NumericString,
    feeRate: z.number().int().nonnegative(),
    tokenDecimalsA: z.number().int().min(0).max(18),
    tokenDecimalsB: z.number().int().min(0).max(18),
    tokenSymbolA: NonEmptyString,
    tokenSymbolB: NonEmptyString,
    tvl: z.number().nonnegative(),
    apr: z.number(),
  })
  .strict()
export type OrcaWhirlpoolInfo = z.infer<typeof OrcaWhirlpoolInfoSchema>

export const OrcaWhirlpoolsResponseSchema = z
  .object({
    whirlpools: z.array(OrcaWhirlpoolInfoSchema),
  })
  .strict()

export const OrcaPositionInfoSchema = z
  .object({
    positionMint: Base58Address,
    whirlpool: Base58Address,
    liquidity: NumericString,
    tickLowerIndex: z.number().int(),
    tickUpperIndex: z.number().int(),
    feeOwedA: NumericString,
    feeOwedB: NumericString,
  })
  .strict()
export type OrcaPositionInfo = z.infer<typeof OrcaPositionInfoSchema>

export const OrcaPositionsResponseSchema = z
  .object({
    positions: z.array(OrcaPositionInfoSchema),
  })
  .strict()
