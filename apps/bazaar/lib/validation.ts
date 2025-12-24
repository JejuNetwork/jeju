/**
 * Shared Zod validation schemas for Bazaar
 * Import validation utilities directly from @jejunetwork/types
 */

import { AddressSchema } from '@jejunetwork/types'
import { z } from 'zod'

// OIF/Intent Schemas

export const SolverResponseSchema = z.object({
  solver: AddressSchema,
  name: z.string(),
  reputation: z.number(),
  successRate: z.number(),
})
export type SolverResponse = z.infer<typeof SolverResponseSchema>

export const SolversResponseSchema = z.object({
  solvers: z.array(SolverResponseSchema),
})
export type SolversResponse = z.infer<typeof SolversResponseSchema>

export const RouteStepSchema = z.object({
  protocol: z.string(),
  action: z.string(),
  inputToken: AddressSchema,
  outputToken: AddressSchema,
  inputAmount: z.string(),
  outputAmount: z.string(),
  chainId: z.number(),
})
export type RouteStep = z.infer<typeof RouteStepSchema>

export const RouteResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(RouteStepSchema),
  estimatedTime: z.number(),
  estimatedGas: z.string(),
  fee: z.string(),
})
export type RouteResponse = z.infer<typeof RouteResponseSchema>

export const RoutesResponseSchema = z.object({
  routes: z.array(RouteResponseSchema),
})
export type RoutesResponse = z.infer<typeof RoutesResponseSchema>

export const IntentQuoteSchema = z.object({
  inputAmount: z.string(),
  outputAmount: z.string(),
  fee: z.string(),
  route: RouteResponseSchema.optional(),
  solver: SolverResponseSchema.optional(),
  priceImpact: z.number().optional(),
})
export type IntentQuote = z.infer<typeof IntentQuoteSchema>

export const IntentQuotesResponseSchema = z.object({
  quotes: z.array(IntentQuoteSchema),
})
export type IntentQuotesResponse = z.infer<typeof IntentQuotesResponseSchema>

export const IntentStatusSchema = z.enum([
  'pending',
  'open',
  'filled',
  'expired',
  'cancelled',
])
export type IntentStatus = z.infer<typeof IntentStatusSchema>

export const IntentInputOutputSchema = z.object({
  amount: z.string(),
  chainId: z.number(),
})

export const IntentSchema = z.object({
  id: z.string(),
  intentId: z.string().optional(),
  user: AddressSchema,
  inputToken: AddressSchema,
  inputAmount: z.string(),
  outputToken: AddressSchema,
  outputAmount: z.string(),
  sourceChainId: z.number(),
  destinationChainId: z.number(),
  status: IntentStatusSchema,
  solver: AddressSchema.optional(),
  createdAt: z.number(),
  filledAt: z.number().optional(),
  txHash: z.string().optional(),
  fillTxHash: z.string().optional(),
  inputs: z.array(IntentInputOutputSchema).optional(),
  outputs: z.array(IntentInputOutputSchema).optional(),
})
export type Intent = z.infer<typeof IntentSchema>

export const IntentsResponseSchema = z.object({
  intents: z.array(IntentSchema),
  total: z.number(),
})
export type IntentsResponse = z.infer<typeof IntentsResponseSchema>

export const AllIntentsResponseSchema = z.object({
  intents: z.array(IntentSchema),
  pagination: z.object({
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    hasMore: z.boolean(),
  }),
})
export type AllIntentsResponse = z.infer<typeof AllIntentsResponseSchema>

export const CreateIntentResponseSchema = z.object({
  intentId: z.string(),
  txHash: z.string(),
  status: IntentStatusSchema,
  intent: IntentSchema.optional(),
})
export type CreateIntentResponse = z.infer<typeof CreateIntentResponseSchema>

export const LeaderboardEntrySchema = z.object({
  address: AddressSchema,
  score: z.number(),
  rank: z.number(),
  totalIntents: z.number(),
  successfulIntents: z.number(),
  totalVolume: z.string(),
})
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>

export const LeaderboardResponseSchema = z.object({
  entries: z.array(LeaderboardEntrySchema),
  leaderboard: z.array(LeaderboardEntrySchema).optional(),
  lastUpdated: z.number(),
})
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>

export const OIFStatsSchema = z.object({
  totalIntents: z.number(),
  last24hIntents: z.number().optional().default(0),
  activeSolvers: z.number().optional().default(0),
  totalSolvers: z.number(),
  successRate: z.number(),
  totalVolume: z.string(),
  totalVolumeUsd: z.string().optional().default('0'),
  last24hVolume: z.string().optional().default('0'),
  totalFeesUsd: z.string().optional().default('0'),
  avgFillTime: z.number(),
  avgFillTimeSeconds: z.number().optional().default(0),
  activeRoutes: z.number().optional().default(0),
  totalSolverStake: z.string().optional().default('0'),
})
export type OIFStats = z.infer<typeof OIFStatsSchema>

// JNS Schemas

export const JNSListingGraphQLSchema = z.object({
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
export type JNSListingGraphQL = z.infer<typeof JNSListingGraphQLSchema>

export const JNSListingSchema = z.object({
  id: z.string(),
  tokenId: z.string(),
  name: z.string(),
  seller: AddressSchema,
  price: z.string(),
  expiresAt: z.number(),
  listedAt: z.number(),
  status: z.enum(['active', 'sold', 'cancelled', 'expired']),
})
export type JNSListing = z.infer<typeof JNSListingSchema>

export const JNSListingsGraphQLResponseSchema = z.object({
  data: z.object({
    jnsListings: z.array(JNSListingGraphQLSchema),
  }),
})
export type JNSListingsGraphQLResponse = z.infer<
  typeof JNSListingsGraphQLResponseSchema
>
