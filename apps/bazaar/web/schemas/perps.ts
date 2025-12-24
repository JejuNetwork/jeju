/**
 * Zod schemas for perpetual trading types
 */

import { AddressSchema, BigIntSchema, HashSchema } from '@jejunetwork/types'
import { z } from 'zod'

export const PositionSideSchema = z.union([
  z.literal(0), // Long
  z.literal(1), // Short
])
export type PositionSideValue = z.infer<typeof PositionSideSchema>

export const PerpsMarketSchema = z.object({
  marketId: HashSchema,
  symbol: z.string().min(1),
  baseAsset: AddressSchema,
  maxLeverage: BigIntSchema,
  maintenanceMarginBps: BigIntSchema,
  takerFeeBps: BigIntSchema,
  makerFeeBps: BigIntSchema,
  maxOpenInterest: BigIntSchema,
  currentOpenInterest: BigIntSchema,
  isActive: z.boolean(),
})
export type PerpsMarket = z.infer<typeof PerpsMarketSchema>

export const PerpsPositionSchema = z.object({
  positionId: HashSchema,
  trader: AddressSchema,
  marketId: HashSchema,
  side: PositionSideSchema,
  marginType: z.number().int().nonnegative(),
  size: BigIntSchema,
  margin: BigIntSchema,
  marginToken: AddressSchema,
  entryPrice: BigIntSchema,
  entryFundingIndex: BigIntSchema,
  lastUpdateTime: BigIntSchema,
  isOpen: z.boolean(),
})
export type PerpsPosition = z.infer<typeof PerpsPositionSchema>

export const PositionWithPnLSchema = PerpsPositionSchema.extend({
  unrealizedPnl: BigIntSchema,
  fundingPnl: BigIntSchema,
  liquidationPrice: BigIntSchema,
  currentLeverage: BigIntSchema,
  healthFactor: BigIntSchema,
  canLiquidate: z.boolean(),
})
export type PositionWithPnL = z.infer<typeof PositionWithPnLSchema>

export const TradeResultSchema = z.object({
  positionId: HashSchema,
  executionPrice: BigIntSchema,
  fee: BigIntSchema,
  realizedPnl: BigIntSchema,
  fundingPaid: BigIntSchema,
})
export type TradeResult = z.infer<typeof TradeResultSchema>

export const OpenPositionParamsSchema = z.object({
  marketId: HashSchema,
  marginToken: AddressSchema,
  marginAmount: BigIntSchema,
  size: BigIntSchema,
  side: PositionSideSchema,
  leverage: z.number().int().positive().max(100),
})
export type OpenPositionParams = z.infer<typeof OpenPositionParamsSchema>

export const PriceDataSchema = z.object({
  markPrice: BigIntSchema,
  indexPrice: BigIntSchema,
  fundingRate: BigIntSchema,
})
export type PriceData = z.infer<typeof PriceDataSchema>

export const OpenInterestSchema = z.object({
  longOI: BigIntSchema,
  shortOI: BigIntSchema,
})
export type OpenInterest = z.infer<typeof OpenInterestSchema>

export const FormattedPnLSchema = z.object({
  value: z.string(),
  isProfit: z.boolean(),
})
export type FormattedPnL = z.infer<typeof FormattedPnLSchema>

export const PositionValidationResultSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
})
export type PositionValidationResult = z.infer<
  typeof PositionValidationResultSchema
>

export const TradeValidationSchema = z.object({
  isConnected: z.boolean(),
  size: z.string(),
  leverage: z.number().positive(),
  hasMargin: z.boolean(),
})
export type TradeValidation = z.infer<typeof TradeValidationSchema>
