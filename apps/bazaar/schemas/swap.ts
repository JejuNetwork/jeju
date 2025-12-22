/**
 * Swap-related Zod schemas
 */

import {
  AddressSchema,
  BigIntSchema,
  EvmChainIdSchema,
  NonEmptyStringSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

/**
 * Swap token with metadata for display
 */
export const SwapTokenSchema = z.object({
  symbol: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  icon: z.string(),
  address: AddressSchema,
  decimals: z.number().int().min(0).max(18).default(18),
})
export type SwapToken = z.infer<typeof SwapTokenSchema>

/**
 * Swap direction (input/output)
 */
export const SwapDirectionSchema = z.enum(['input', 'output'])
export type SwapDirection = z.infer<typeof SwapDirectionSchema>

/**
 * Swap parameters for execution
 */
export const SwapParamsSchema = z.object({
  inputToken: AddressSchema,
  outputToken: AddressSchema,
  inputAmount: BigIntSchema,
  sourceChainId: EvmChainIdSchema,
  destChainId: EvmChainIdSchema,
  recipient: AddressSchema.optional(),
  slippageBps: z.number().int().min(0).max(10000).default(30), // 0.3% default
})
export type SwapParams = z.infer<typeof SwapParamsSchema>

/**
 * Fee breakdown for display
 */
export const SwapFeeEstimateSchema = z.object({
  networkFee: BigIntSchema,
  xlpFee: BigIntSchema,
  totalFee: BigIntSchema,
  estimatedTime: z.number().int().nonnegative(), // seconds
})
export type SwapFeeEstimate = z.infer<typeof SwapFeeEstimateSchema>

/**
 * Swap quote with all calculated values
 */
export const SwapQuoteSchema = z.object({
  inputAmount: BigIntSchema,
  outputAmount: BigIntSchema,
  rate: z.number().positive(),
  rateDisplay: z.string(),
  feePercent: z.number().min(0).max(100),
  priceImpact: z.number().optional(),
  fees: SwapFeeEstimateSchema,
  isCrossChain: z.boolean(),
})
export type SwapQuote = z.infer<typeof SwapQuoteSchema>

/**
 * Swap validation result
 */
export const SwapValidationResultSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
})
export type SwapValidationResult = z.infer<typeof SwapValidationResultSchema>

/**
 * Price pair for rate calculations
 */
export const PricePairSchema = z.object({
  baseToken: NonEmptyStringSchema,
  quoteToken: NonEmptyStringSchema,
  rate: z.number().positive(),
})
export type PricePair = z.infer<typeof PricePairSchema>
