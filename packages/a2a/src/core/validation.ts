/**
 * A2A Validation Schemas
 *
 * Zod schemas for validating A2A protocol parameters
 */

import { z } from 'zod'

/**
 * Schema for agent discovery parameters
 */
export const DiscoverParamsSchema = z.object({
  filters: z
    .object({
      strategies: z.array(z.string()).optional(),
      minReputation: z.number().optional(),
      markets: z.array(z.string()).optional(),
    })
    .optional(),
  limit: z.number().positive().optional(),
})
export type DiscoverParams = z.infer<typeof DiscoverParamsSchema>

/**
 * Schema for payment request parameters
 */
export const PaymentRequestParamsSchema = z.object({
  to: z.string().min(1),
  amount: z.string().min(1),
  service: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  from: z.string().optional(),
})
export type PaymentRequestParams = z.infer<typeof PaymentRequestParamsSchema>

/**
 * Schema for buying shares in prediction markets
 */
export const BuySharesParamsSchema = z.object({
  marketId: z.string().min(1),
  outcome: z.enum(['YES', 'NO']),
  amount: z.number().positive(),
})
export type BuySharesParams = z.infer<typeof BuySharesParamsSchema>

/**
 * Schema for opening perpetual positions
 */
export const OpenPositionParamsSchema = z.object({
  ticker: z.string().min(1),
  side: z.enum(['LONG', 'SHORT']),
  amount: z.number().positive(),
  leverage: z.number().min(1).max(100),
})
export type OpenPositionParams = z.infer<typeof OpenPositionParamsSchema>

/**
 * Schema for creating posts
 */
export const CreatePostParamsSchema = z.object({
  content: z.string().min(1).max(5000),
  type: z.enum(['post', 'article', 'comment']).optional().default('post'),
})
export type CreatePostParams = z.infer<typeof CreatePostParamsSchema>

/**
 * Schema for getting feed posts
 */
export const GetFeedParamsSchema = z.object({
  limit: z.number().positive().optional().default(20),
  offset: z.number().min(0).optional().default(0),
  following: z.boolean().optional(),
  type: z.enum(['post', 'article', 'comment']).optional(),
})
export type GetFeedParams = z.infer<typeof GetFeedParamsSchema>

/**
 * Schema for searching users
 */
export const SearchUsersParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().positive().optional().default(20),
})
export type SearchUsersParams = z.infer<typeof SearchUsersParamsSchema>

/**
 * Schema for transferring points between users
 */
export const TransferPointsParamsSchema = z.object({
  recipientId: z.string().min(1),
  amount: z.number().int().positive(),
  message: z.string().max(200).optional(),
})
export type TransferPointsParams = z.infer<typeof TransferPointsParamsSchema>
