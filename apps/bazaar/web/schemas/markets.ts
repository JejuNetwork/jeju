/**
 * Prediction market-related Zod schemas
 */

import { BigIntSchema, NonEmptyStringSchema } from '@jejunetwork/types'
import { z } from 'zod'

// Used internally by PositionSchema
const MarketInfoSchema = z.object({
  sessionId: NonEmptyStringSchema,
  question: NonEmptyStringSchema,
  resolved: z.boolean(),
  outcome: z.boolean().nullable(),
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
