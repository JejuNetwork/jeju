/**
 * A2A Validation Schemas
 *
 * Zod schemas for validating A2A protocol parameters
 */

import { z } from 'zod'

import { PaymentMetadataSchema } from '../types/common'

/**
 * Schema for agent discovery parameters
 */
export const DiscoverParamsSchema = z
  .object({
    filters: z
      .object({
        strategies: z.array(z.string().min(1)).optional(),
        minReputation: z.number().int().min(0).optional(),
        markets: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    limit: z.number().int().positive().max(1000).optional(),
  })
  .strict()
export type DiscoverParams = z.infer<typeof DiscoverParamsSchema>

/**
 * Schema for payment request parameters
 */
export const PaymentRequestParamsSchema = z
  .object({
    to: z.string().min(1),
    amount: z.string().min(1).regex(/^\d+$/, 'Amount must be numeric'),
    service: z.string().min(1).max(100),
    metadata: PaymentMetadataSchema.optional(),
    from: z.string().min(1).optional(),
  })
  .strict()
export type PaymentRequestParams = z.infer<typeof PaymentRequestParamsSchema>

/**
 * Schema for buying shares in prediction markets
 */
export const BuySharesParamsSchema = z
  .object({
    marketId: z.string().min(1),
    outcome: z.enum(['YES', 'NO']),
    amount: z.number().positive(),
  })
  .strict()
export type BuySharesParams = z.infer<typeof BuySharesParamsSchema>

/**
 * Schema for opening perpetual positions
 */
export const OpenPositionParamsSchema = z
  .object({
    ticker: z.string().min(1).max(20),
    side: z.enum(['LONG', 'SHORT']),
    amount: z.number().positive(),
    leverage: z.number().int().min(1).max(100),
  })
  .strict()
export type OpenPositionParams = z.infer<typeof OpenPositionParamsSchema>

/**
 * Schema for creating posts
 */
export const CreatePostParamsSchema = z
  .object({
    content: z.string().min(1).max(5000),
    type: z.enum(['post', 'article', 'comment']).optional().default('post'),
  })
  .strict()
export type CreatePostParams = z.infer<typeof CreatePostParamsSchema>

/**
 * Schema for getting feed posts
 */
export const GetFeedParamsSchema = z
  .object({
    limit: z.number().int().positive().max(100).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
    following: z.boolean().optional(),
    type: z.enum(['post', 'article', 'comment']).optional(),
  })
  .strict()
export type GetFeedParams = z.infer<typeof GetFeedParamsSchema>

/**
 * Schema for searching users
 */
export const SearchUsersParamsSchema = z
  .object({
    query: z.string().min(1).max(100),
    limit: z.number().int().positive().max(100).optional().default(20),
  })
  .strict()
export type SearchUsersParams = z.infer<typeof SearchUsersParamsSchema>

/**
 * Schema for transferring points between users
 */
export const TransferPointsParamsSchema = z
  .object({
    recipientId: z.string().min(1),
    amount: z.number().int().positive(),
    message: z.string().max(200).optional(),
  })
  .strict()
export type TransferPointsParams = z.infer<typeof TransferPointsParamsSchema>
