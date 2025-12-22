/**
 * Zod schemas for external DEX API responses
 * Validates all data from Jupiter, Raydium, Meteora, and Orca APIs
 */

import { z } from 'zod'

// ============================================================================
// Jupiter API Schemas
// ============================================================================

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

export const JupiterSwapResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number(),
  prioritizationFeeLamports: z.number(),
})
export type JupiterSwapResponse = z.infer<typeof JupiterSwapResponseSchema>

export const JupiterTokenSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  decimals: z.number(),
  name: z.string(),
})

export const JupiterTokenListSchema = z.array(JupiterTokenSchema)
export type JupiterToken = z.infer<typeof JupiterTokenSchema>

// ============================================================================
// Raydium API Schemas
// ============================================================================

export const RaydiumMintInfoSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  decimals: z.number(),
})

export const RaydiumAprSchema = z.object({
  fee: z.number(),
  reward: z.number(),
})

export const RaydiumLpMintSchema = z.object({
  address: z.string(),
})

export const RaydiumPoolTypeSchema = z.enum(['Standard', 'Concentrated'])

export const RaydiumApiPoolSchema = z.object({
  id: z.string(),
  mintA: RaydiumMintInfoSchema,
  mintB: RaydiumMintInfoSchema,
  mintAmountA: z.number(),
  mintAmountB: z.number(),
  tvl: z.number(),
  feeRate: z.number(),
  apr: RaydiumAprSchema,
  lpMint: RaydiumLpMintSchema,
  type: RaydiumPoolTypeSchema,
})
export type RaydiumApiPool = z.infer<typeof RaydiumApiPoolSchema>

export const RaydiumPoolListResponseSchema = z.object({
  data: z.object({
    data: z.array(RaydiumApiPoolSchema),
  }),
})

export const RaydiumPoolDetailResponseSchema = z.object({
  data: z.array(RaydiumApiPoolSchema),
})

export const RaydiumLPPositionSchema = z.object({
  poolId: z.string(),
  lpMint: z.string(),
  lpAmount: z.string(),
  tokenAAmount: z.string(),
  tokenBAmount: z.string(),
})

export const RaydiumLPPositionsResponseSchema = z.object({
  data: z.array(RaydiumLPPositionSchema),
})

export const RaydiumCLMMPositionSchema = z.object({
  nftMint: z.string(),
  poolId: z.string(),
  tickLower: z.number(),
  tickUpper: z.number(),
  liquidity: z.string(),
  tokenFeesOwedA: z.string(),
  tokenFeesOwedB: z.string(),
})

export const RaydiumCLMMPositionsResponseSchema = z.object({
  data: z.array(RaydiumCLMMPositionSchema),
})

// ============================================================================
// Meteora API Schemas
// ============================================================================

export const MeteoraPoolInfoSchema = z.object({
  address: z.string(),
  name: z.string(),
  mint_x: z.string(),
  mint_y: z.string(),
  reserve_x: z.string(),
  reserve_y: z.string(),
  reserve_x_amount: z.number(),
  reserve_y_amount: z.number(),
  bin_step: z.number(),
  base_fee_percentage: z.string(),
  liquidity: z.string(),
  current_price: z.number(),
  apy: z.number(),
  hide: z.boolean(),
})
export type MeteoraPoolInfo = z.infer<typeof MeteoraPoolInfoSchema>

export const MeteoraPoolListSchema = z.array(MeteoraPoolInfoSchema)

export const MeteoraPositionBinDataSchema = z.object({
  bin_id: z.number(),
  position_liquidity: z.string(),
})

export const MeteoraPositionInfoSchema = z.object({
  address: z.string(),
  pair_address: z.string(),
  total_x_amount: z.string(),
  total_y_amount: z.string(),
  position_bin_data: z.array(MeteoraPositionBinDataSchema),
  fee_x: z.string(),
  fee_y: z.string(),
})
export type MeteoraPositionInfo = z.infer<typeof MeteoraPositionInfoSchema>

export const MeteoraPositionsListSchema = z.array(MeteoraPositionInfoSchema)

// ============================================================================
// Orca API Schemas
// ============================================================================

export const OrcaWhirlpoolInfoSchema = z.object({
  address: z.string(),
  tokenMintA: z.string(),
  tokenMintB: z.string(),
  tickSpacing: z.number(),
  tickCurrentIndex: z.number(),
  sqrtPrice: z.string(),
  liquidity: z.string(),
  feeRate: z.number(),
  tokenDecimalsA: z.number(),
  tokenDecimalsB: z.number(),
  tokenSymbolA: z.string(),
  tokenSymbolB: z.string(),
  tvl: z.number(),
  apr: z.number(),
})
export type OrcaWhirlpoolInfo = z.infer<typeof OrcaWhirlpoolInfoSchema>

export const OrcaWhirlpoolsResponseSchema = z.object({
  whirlpools: z.array(OrcaWhirlpoolInfoSchema),
})

export const OrcaPositionInfoSchema = z.object({
  positionMint: z.string(),
  whirlpool: z.string(),
  liquidity: z.string(),
  tickLowerIndex: z.number(),
  tickUpperIndex: z.number(),
  feeOwedA: z.string(),
  feeOwedB: z.string(),
})
export type OrcaPositionInfo = z.infer<typeof OrcaPositionInfoSchema>

export const OrcaPositionsResponseSchema = z.object({
  positions: z.array(OrcaPositionInfoSchema),
})
