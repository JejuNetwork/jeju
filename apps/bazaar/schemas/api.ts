/**
 * API request/response Zod schemas
 */

import { AddressSchema } from '@jejunetwork/types'
import { z } from 'zod'
import {
  BigIntSchema,
  ChainTypeSchema,
  EvmChainIdSchema,
  NonEmptyStringSchema,
  SolanaNetworkIdSchema,
} from './common'
import { TokenMetadataSchema } from './token'

// ============ A2A API Schemas ============

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

export const A2AResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: z.unknown(),
  id: z.union([z.number(), z.string()]),
})

export type A2AResponse = z.infer<typeof A2AResponseSchema>

// ============ MCP API Schemas ============

export const MCPToolCallRequestSchema = z
  .object({
    name: NonEmptyStringSchema,
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict()

export type MCPToolCallRequest = z.infer<typeof MCPToolCallRequestSchema>

export const MCPToolCallResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string(),
    }),
  ),
  isError: z.boolean().optional(),
})

export type MCPToolCallResponse = z.infer<typeof MCPToolCallResponseSchema>

// ============ TFMM API Schemas ============

export const TFMMGetQuerySchema = z.object({
  pool: AddressSchema.optional(),
  action: z.enum(['strategies', 'oracles']).optional(),
})

export type TFMMGetQuery = z.infer<typeof TFMMGetQuerySchema>

export const TFMMCreatePoolParamsSchema = z.object({
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

export type TFMMCreatePoolParams = z.infer<typeof TFMMCreatePoolParamsSchema>

export const TFMMUpdateStrategyParamsSchema = z.object({
  poolAddress: AddressSchema,
  newStrategy: z.enum([
    'momentum',
    'mean_reversion',
    'trend_following',
    'volatility_targeting',
  ]),
})

export type TFMMUpdateStrategyParams = z.infer<
  typeof TFMMUpdateStrategyParamsSchema
>

export const TFMMTriggerRebalanceParamsSchema = z.object({
  poolAddress: AddressSchema,
})

export type TFMMTriggerRebalanceParams = z.infer<
  typeof TFMMTriggerRebalanceParamsSchema
>

export const TFMMPostRequestSchema = z
  .object({
    action: z.enum(['create_pool', 'update_strategy', 'trigger_rebalance']),
    params: z.union([
      TFMMCreatePoolParamsSchema,
      TFMMUpdateStrategyParamsSchema,
      TFMMTriggerRebalanceParamsSchema,
    ]),
  })
  .strict()

export type TFMMPostRequest = z.infer<typeof TFMMPostRequestSchema>

// ============ Token Creation API Schemas ============

export const CreateTokenRequestSchema = z.object({
  chainType: ChainTypeSchema,
  chainId: z.union([EvmChainIdSchema, SolanaNetworkIdSchema]),
  metadata: TokenMetadataSchema,
  initialSupply: BigIntSchema.optional(),
  bondingCurveEnabled: z.boolean().optional(),
  aiGenerated: z.boolean().optional(),
})

export type CreateTokenRequest = z.infer<typeof CreateTokenRequestSchema>

// ============ Swap API Schemas ============

export const SwapQuoteRequestSchema = z.object({
  tokenIn: AddressSchema,
  tokenOut: AddressSchema,
  amountIn: BigIntSchema,
  slippage: z.number().min(0).max(50).optional(),
})

export type SwapQuoteRequest = z.infer<typeof SwapQuoteRequestSchema>

export const SwapQuoteResponseSchema = z.object({
  amountOut: BigIntSchema,
  priceImpact: z.number(),
  route: z.array(AddressSchema),
  gasEstimate: BigIntSchema,
})

export type SwapQuoteResponse = z.infer<typeof SwapQuoteResponseSchema>

// ============ NFT API Schemas ============

export const NFTListingRequestSchema = z.object({
  tokenId: z.string(),
  collectionAddress: AddressSchema,
  price: BigIntSchema,
  currency: AddressSchema.optional(),
  duration: z.number().int().positive().optional(),
})

export type NFTListingRequest = z.infer<typeof NFTListingRequestSchema>

export const NFTBuyRequestSchema = z.object({
  listingId: z.string(),
  price: BigIntSchema,
})

export type NFTBuyRequest = z.infer<typeof NFTBuyRequestSchema>

// ============ Market API Schemas ============

export const MarketTradeRequestSchema = z.object({
  marketId: NonEmptyStringSchema,
  outcome: z.boolean(),
  amount: BigIntSchema,
  maxPrice: z.number().min(0).max(1).optional(),
})

export type MarketTradeRequest = z.infer<typeof MarketTradeRequestSchema>

export const MarketClaimRequestSchema = z.object({
  marketId: NonEmptyStringSchema,
  positionId: NonEmptyStringSchema,
})

export type MarketClaimRequest = z.infer<typeof MarketClaimRequestSchema>

// ============ Common API Response Schemas ============

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

export const SuccessResponseSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
  message: z.string().optional(),
})

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>

// ============ MCP Resource API Schemas ============

export const MCPResourceReadRequestSchema = z
  .object({
    uri: z.string().min(1, 'URI is required'),
  })
  .strict()

export type MCPResourceReadRequest = z.infer<
  typeof MCPResourceReadRequestSchema
>

export const MCPResourceReadResponseSchema = z.object({
  contents: z.array(
    z.object({
      uri: z.string(),
      mimeType: z.string(),
      text: z.string(),
    }),
  ),
})

export type MCPResourceReadResponse = z.infer<
  typeof MCPResourceReadResponseSchema
>

// ============ DWS API Response Schemas ============

export const DWSFunctionDeployResponseSchema = z.object({
  functionId: z.string(),
})
export type DWSFunctionDeployResponse = z.infer<
  typeof DWSFunctionDeployResponseSchema
>

export const DWSWorkerDeployResponseSchema = z.object({
  workerId: z.string(),
})
export type DWSWorkerDeployResponse = z.infer<
  typeof DWSWorkerDeployResponseSchema
>

export const DWSInvokeResponseSchema = z.object({
  body: z.string().optional(),
  statusCode: z.number().optional(),
})
export type DWSInvokeResponse = z.infer<typeof DWSInvokeResponseSchema>

export const DWSHealthResponseSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  teeMode: z.string().optional(),
  services: z
    .object({
      workers: z.object({ status: z.string() }).optional(),
      workerd: z.object({ status: z.string() }).optional(),
    })
    .optional(),
})
export type DWSHealthResponse = z.infer<typeof DWSHealthResponseSchema>

export const DWSWorkerdHealthResponseSchema = z.object({
  status: z.string(),
  runtime: z.string().optional(),
})
export type DWSWorkerdHealthResponse = z.infer<
  typeof DWSWorkerdHealthResponseSchema
>

// ============ IPFS/Storage Response Schemas ============

export const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
})
export type IPFSUploadResponse = z.infer<typeof IPFSUploadResponseSchema>

// ============ Bundler (ERC-4337) Response Schemas ============

export const BundlerSendUserOpResponseSchema = z.object({
  result: z.string().optional(),
  error: z
    .object({
      message: z.string(),
    })
    .optional(),
})
export type BundlerSendUserOpResponse = z.infer<
  typeof BundlerSendUserOpResponseSchema
>

export const BundlerUserOpReceiptResponseSchema = z.object({
  result: z
    .object({
      receipt: z
        .object({
          transactionHash: z.string(),
        })
        .optional(),
    })
    .optional(),
})
export type BundlerUserOpReceiptResponse = z.infer<
  typeof BundlerUserOpReceiptResponseSchema
>

// ============ GraphQL Response Schemas ============

export const GraphQLDataResponseSchema = <T extends z.ZodTypeAny>(
  dataSchema: T,
) =>
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

// ============ Faucet API Response Schemas ============

export const FaucetInfoResponseSchema = z.object({
  name: z.string(),
  chainId: z.number(),
})
export type FaucetInfoResponse = z.infer<typeof FaucetInfoResponseSchema>

// ============ A2A Service Response Schemas ============

export const A2AServiceInfoResponseSchema = z.object({
  service: z.string(),
})
export type A2AServiceInfoResponse = z.infer<
  typeof A2AServiceInfoResponseSchema
>

// ============ Agent Card Response Schema ============

export const AgentCardResponseSchema = z.object({
  name: z.string(),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      tags: z.array(z.string()).optional(),
    }),
  ),
})
export type AgentCardResponse = z.infer<typeof AgentCardResponseSchema>

// ============ ABI-related Schemas (for validation tests) ============

export const ABIFunctionSchema = z.object({
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
export type ABIFunction = z.infer<typeof ABIFunctionSchema>

export const ABISchema = z.array(ABIFunctionSchema)
export type ABI = z.infer<typeof ABISchema>
