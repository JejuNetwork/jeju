/**
 * Prediction market-related Zod schemas
 */

import { AddressSchema } from '@jejunetwork/types'
import { z } from 'zod'
import {
  BigIntSchema,
  DateSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
} from './common'

export const MarketSchema = z.object({
  id: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema,
  question: NonEmptyStringSchema.min(
    3,
    'Question must be at least 3 characters',
  ),
  yesPrice: BigIntSchema,
  noPrice: BigIntSchema,
  yesShares: BigIntSchema,
  noShares: BigIntSchema,
  totalVolume: BigIntSchema,
  createdAt: DateSchema,
  resolved: z.boolean(),
  outcome: z.boolean().optional(),
})

export type Market = z.infer<typeof MarketSchema>

export const MarketInfoSchema = z.object({
  sessionId: NonEmptyStringSchema,
  question: NonEmptyStringSchema,
  resolved: z.boolean(),
  outcome: z.boolean().optional(),
})

export const PositionSchema = z.object({
  id: NonEmptyStringSchema,
  market: MarketInfoSchema,
  yesShares: BigIntSchema,
  noShares: BigIntSchema,
  totalSpent: BigIntSchema,
  totalReceived: BigIntSchema,
  hasClaimed: z.boolean(),
})

export type Position = z.infer<typeof PositionSchema>

export const TradeSchema = z.object({
  id: NonEmptyStringSchema,
  timestamp: z.string(),
  trader: AddressSchema,
  amount: z.string(),
  outcome: z.boolean(),
  yesPrice: z.string(),
  noPrice: z.string(),
  market: z
    .object({
      question: NonEmptyStringSchema,
    })
    .optional(),
})

export type Trade = z.infer<typeof TradeSchema>

export const PricePointSchema = z.object({
  timestamp: z.string(),
  yesPrice: NonNegativeNumberSchema,
  noPrice: NonNegativeNumberSchema,
})

export type PricePoint = z.infer<typeof PricePointSchema>

export const MarketStatsSchema = z.object({
  totalVolume: BigIntSchema,
  activeMarketCount: z.number().int().nonnegative(),
  totalMarketCount: z.number().int().nonnegative(),
})

export type MarketStats = z.infer<typeof MarketStatsSchema>

export const UserStatsSchema = z.object({
  totalValue: BigIntSchema,
  totalPnL: BigIntSchema,
  activePositionCount: z.number().int().nonnegative(),
})

export type UserStats = z.infer<typeof UserStatsSchema>
