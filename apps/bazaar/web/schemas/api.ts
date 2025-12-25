/**
 * API request/response Zod schemas
 */

import {
  AddressSchema,
  BigIntSchema,
  EvmChainIdSchema,
  NonEmptyStringSchema,
  SolanaNetworkIdSchema,
} from '@jejunetwork/types'
import { z } from 'zod'
import { ChainTypeSchema } from './common'
import { TokenMetadataSchema } from './token'

export const A2ARequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: NonEmptyStringSchema,
    params: z
      .object({
        message: z
          .object({
            messageId: NonEmptyStringSchema,
            parts: z.array(
              z.object({
                kind: z.string(),
                text: z.string().optional(),
                data: z.record(z.string(), z.unknown()).optional(),
              }),
            ),
          })
          .optional(),
      })
      .optional(),
    id: z.union([z.number(), z.string()]),
  })
  .strict()

export type A2ARequest = z.infer<typeof A2ARequestSchema>

export const MCPToolCallRequestSchema = z
  .object({
    name: NonEmptyStringSchema,
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict()

export type MCPToolCallRequest = z.infer<typeof MCPToolCallRequestSchema>

export const TFMMGetQuerySchema = z.object({
  pool: AddressSchema.optional(),
  action: z.enum(['strategies', 'oracles']).optional(),
})

export type TFMMGetQuery = z.infer<typeof TFMMGetQuerySchema>

// Internal schemas for TFMM discriminated union
const TFMMCreatePoolParamsSchema = z.object({
  tokens: z.array(AddressSchema).min(2, 'At least 2 tokens required'),
  initialWeights: z.array(z.number().min(0).max(100)).refine(
    (weights) => {
      const sum = weights.reduce((a, b) => a + b, 0)
      return Math.abs(sum - 100) < 0.01
    },
    { error: 'Weights must sum to 100%' },
  ),
  strategy: z.enum([
    'momentum',
    'mean_reversion',
    'trend_following',
    'volatility_targeting',
  ]),
})

const TFMMUpdateStrategyParamsSchema = z.object({
  poolAddress: AddressSchema,
  newStrategy: z.enum([
    'momentum',
    'mean_reversion',
    'trend_following',
    'volatility_targeting',
  ]),
})

const TFMMTriggerRebalanceParamsSchema = z.object({
  poolAddress: AddressSchema,
})

// Export param types for use in utils
export type TFMMCreatePoolParams = z.infer<typeof TFMMCreatePoolParamsSchema>
export type TFMMUpdateStrategyParams = z.infer<
  typeof TFMMUpdateStrategyParamsSchema
>
export type TFMMTriggerRebalanceParams = z.infer<
  typeof TFMMTriggerRebalanceParamsSchema
>

const TFMMCreatePoolRequestSchema = z
  .object({
    action: z.literal('create_pool'),
    params: TFMMCreatePoolParamsSchema,
  })
  .strict()

const TFMMUpdateStrategyRequestSchema = z
  .object({
    action: z.literal('update_strategy'),
    params: TFMMUpdateStrategyParamsSchema,
  })
  .strict()

const TFMMTriggerRebalanceRequestSchema = z
  .object({
    action: z.literal('trigger_rebalance'),
    params: TFMMTriggerRebalanceParamsSchema,
  })
  .strict()

export const TFMMPostRequestSchema = z.discriminatedUnion('action', [
  TFMMCreatePoolRequestSchema,
  TFMMUpdateStrategyRequestSchema,
  TFMMTriggerRebalanceRequestSchema,
])

export type TFMMPostRequest = z.infer<typeof TFMMPostRequestSchema>

// CreateToken schema uses common imports
export const CreateTokenRequestSchema = z.object({
  chainType: ChainTypeSchema,
  chainId: z.union([EvmChainIdSchema, SolanaNetworkIdSchema]),
  metadata: TokenMetadataSchema,
  initialSupply: BigIntSchema.optional(),
  bondingCurveEnabled: z.boolean().default(false),
  aiGenerated: z.boolean().default(false),
})

export type CreateTokenRequest = z.infer<typeof CreateTokenRequestSchema>

export const MCPResourceReadRequestSchema = z
  .object({
    uri: z.string().min(1, 'URI is required'),
  })
  .strict()

export type MCPResourceReadRequest = z.infer<
  typeof MCPResourceReadRequestSchema
>

// ABI schema for tests
const ABIFunctionSchema = z.object({
  name: z.string().optional(),
  inputs: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().optional(),
      }),
    )
    .optional(),
})

export const ABISchema = z.array(ABIFunctionSchema)
export type ABI = z.infer<typeof ABISchema>
