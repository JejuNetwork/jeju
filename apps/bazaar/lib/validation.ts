/**
 * Shared validation utilities for fail-fast error handling
 * Re-exports from @jejunetwork/types/validation for DRY
 */

import { AddressSchema } from '@jejunetwork/types'
import { z } from 'zod'

export {
  expect,
  expectAddress,
  expectBigInt,
  expectChainId,
  expectDefined as expectExists,
  expectHex,
  expectJson,
  expectNonEmpty,
  expectNonEmptyString,
  expectNonNegative,
  expectPositive,
  expectTrue,
  expectValid,
  validateOrNull,
  validateOrThrow,
} from '@jejunetwork/types'

// ============================================================================
// Intent API Response Schemas
// ============================================================================

export const IntentQuoteSchema = z.object({
  outputAmount: z.string(),
  feePercent: z.number(),
  estimatedFillTimeSeconds: z.number(),
  solver: z.string(),
})
export type IntentQuote = z.infer<typeof IntentQuoteSchema>

export const IntentQuotesResponseSchema = z.object({
  quotes: z.array(IntentQuoteSchema).optional(),
})
export type IntentQuotesResponse = z.infer<typeof IntentQuotesResponseSchema>

export const OIFStatsSchema = z.object({
  totalIntents: z.number(),
  last24hIntents: z.number(),
  activeSolvers: z.number(),
  totalSolvers: z.number(),
  successRate: z.number(),
  totalVolume: z.string(),
  totalVolumeUsd: z.string(),
  last24hVolume: z.string(),
  totalFeesUsd: z.string(),
  avgFillTimeSeconds: z.number(),
  activeRoutes: z.number(),
  totalSolverStake: z.string(),
})
export type OIFStats = z.infer<typeof OIFStatsSchema>

export const IntentSchema = z.object({
  id: z.string(),
  creator: AddressSchema,
  sourceChain: z.number(),
  destinationChain: z.number(),
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,
  amount: z
    .union([z.bigint(), z.string()])
    .transform((v) => (typeof v === 'string' ? BigInt(v) : v)),
  minReceived: z
    .union([z.bigint(), z.string()])
    .transform((v) => (typeof v === 'string' ? BigInt(v) : v)),
  recipient: AddressSchema,
  deadline: z.number(),
  status: z.enum(['pending', 'filled', 'expired', 'cancelled']),
  createdAt: z.number(),
  filledAt: z.number().optional(),
  fillTxHash: z.string().optional(),
})
export type Intent = z.infer<typeof IntentSchema>

export const CreateIntentResponseSchema = z.object({
  intent: IntentSchema.optional(),
})
export type CreateIntentResponse = z.infer<typeof CreateIntentResponseSchema>

export const IntentsResponseSchema = z.object({
  intents: z.array(IntentSchema).optional(),
})
export type IntentsResponse = z.infer<typeof IntentsResponseSchema>

export const AllIntentsIntentSchema = z.object({
  intentId: z.string(),
  status: z.enum([
    'open',
    'pending',
    'filled',
    'expired',
    'cancelled',
    'failed',
  ]),
  sourceChainId: z.number(),
  createdAt: z.number().optional(),
  solver: z.string().optional(),
  inputs: z.array(
    z.object({
      amount: z.string(),
      chainId: z.number(),
    }),
  ),
  outputs: z.array(
    z.object({
      amount: z.string(),
      chainId: z.number(),
    }),
  ),
})
export type AllIntentsIntent = z.infer<typeof AllIntentsIntentSchema>

export const AllIntentsResponseSchema = z.object({
  intents: z.array(AllIntentsIntentSchema).optional(),
})
export type AllIntentsResponse = z.infer<typeof AllIntentsResponseSchema>

export const RouteSchema = z.object({
  id: z.string(),
  sourceChain: z.number(),
  destinationChain: z.number(),
  token: z.string(),
  volume24h: z.string(),
  avgFillTime: z.number(),
  successRate: z.number(),
})
export type Route = z.infer<typeof RouteSchema>

export const RoutesResponseSchema = z.object({
  routes: z.array(RouteSchema).optional(),
})
export type RoutesResponse = z.infer<typeof RoutesResponseSchema>

export const SolverSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  filledIntents: z.number(),
  totalVolume: z.string(),
  successRate: z.number(),
  avgFillTime: z.number(),
  stake: z.string(),
})
export type Solver = z.infer<typeof SolverSchema>

export const SolversResponseSchema = z.object({
  solvers: z.array(SolverSchema).optional(),
})
export type SolversResponse = z.infer<typeof SolversResponseSchema>

export const LeaderboardEntrySchema = z.object({
  rank: z.number(),
  address: z.string(),
  name: z.string().optional(),
  filledIntents: z.number(),
  totalVolume: z.string(),
  successRate: z.number(),
})
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>

export const LeaderboardResponseSchema = z.object({
  leaderboard: z.array(LeaderboardEntrySchema).optional(),
})
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>

// ============================================================================
// JNS Listing Response Schemas
// ============================================================================

export const JNSListingSchema = z.object({
  id: z.string(),
  price: z.string(),
  currency: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  name: z.object({
    id: z.string(),
    name: z.string(),
    labelhash: z.string(),
    expiresAt: z.string(),
  }),
  seller: z.object({
    id: z.string(),
  }),
})
export type JNSListing = z.infer<typeof JNSListingSchema>

export const JNSListingsGraphQLResponseSchema = z.object({
  data: z.object({
    jnsListings: z.array(JNSListingSchema),
  }),
})
export type JNSListingsGraphQLResponse = z.infer<
  typeof JNSListingsGraphQLResponseSchema
>

// ============================================================================
// GraphQL Response Schemas
// ============================================================================

export const GraphQLResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema.optional(),
    errors: z
      .array(
        z.object({
          message: z.string(),
        }),
      )
      .optional(),
  })

export type GraphQLResponse<T> = {
  data?: T
  errors?: Array<{ message: string }>
}
