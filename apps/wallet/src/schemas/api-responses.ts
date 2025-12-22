/**
 * API Response Schemas
 *
 * Zod schemas for validating external API responses.
 * Used with expectValid for fail-fast validation.
 */

import { z } from 'zod'
import {
  AddressSchema,
  BigIntSchema,
  ChainIdSchema,
  HexSchema,
} from '../lib/validation'

// ============================================================================
// JSON-RPC Response Schemas
// ============================================================================

/**
 * Generic JSON-RPC response wrapper
 */
export const JsonRpcResponseSchema = <T extends z.ZodTypeAny>(
  resultSchema: T,
) =>
  z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.number(), z.string()]),
    result: resultSchema.optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .optional(),
  })

/**
 * eth_chainId RPC response
 */
export const RpcChainIdResponseSchema = z.object({
  result: HexSchema.optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
    })
    .optional(),
})

// ============================================================================
// Swap Service Response Schemas
// ============================================================================

const SwapRouteSchema = z.object({
  protocol: z.string(),
  pool: AddressSchema,
  tokenIn: AddressSchema,
  tokenOut: AddressSchema,
  fee: z.number().optional(),
})

const SwapFeeSchema = z.object({
  amount: z.union([z.string(), z.bigint()]),
  token: z.object({
    address: AddressSchema,
    chainId: ChainIdSchema,
    symbol: z.string(),
    name: z.string(),
    decimals: z.number().int().min(0).max(255),
  }),
})

export const SwapQuoteResponseSchema = z.object({
  id: z.string(),
  inputToken: z.object({
    address: AddressSchema,
    chainId: ChainIdSchema,
    symbol: z.string(),
    name: z.string(),
    decimals: z.number().int().min(0).max(255),
  }),
  outputToken: z.object({
    address: AddressSchema,
    chainId: ChainIdSchema,
    symbol: z.string(),
    name: z.string(),
    decimals: z.number().int().min(0).max(255),
  }),
  inputAmount: z.union([z.string(), z.bigint()]),
  outputAmount: z.union([z.string(), z.bigint()]),
  priceImpact: z.number(),
  route: z.array(SwapRouteSchema),
  estimatedGas: z.union([z.string(), z.bigint()]),
  fee: SwapFeeSchema,
  validUntil: z.number(),
  provider: z.string(),
})

export const SwapQuotesResponseSchema = z.array(SwapQuoteResponseSchema)

export const CrossChainSwapQuoteResponseSchema = SwapQuoteResponseSchema.extend(
  {
    sourceChainId: ChainIdSchema,
    destinationChainId: ChainIdSchema,
    bridgeFee: z.union([z.string(), z.bigint()]),
    estimatedTime: z.number(),
    intentId: HexSchema.optional(),
  },
)

export const CrossChainSwapQuotesResponseSchema = z.array(
  CrossChainSwapQuoteResponseSchema,
)

export const SwapTxDataResponseSchema = z.object({
  to: AddressSchema,
  data: HexSchema,
  value: z.string(),
  gasLimit: z.string(),
})

export const SwapSubmitResponseSchema = z.object({
  txHash: HexSchema,
})

export const CrossChainSwapResponseSchema = z.object({
  intentData: z.object({
    to: AddressSchema.optional(),
    data: HexSchema.optional(),
    value: z.string().optional(),
  }),
  intentId: HexSchema,
})

export const TokenListResponseSchema = z.array(
  z.object({
    address: AddressSchema,
    chainId: ChainIdSchema,
    symbol: z.string(),
    name: z.string(),
    decimals: z.number().int().min(0).max(255),
    logoUri: z.string().optional(),
  }),
)

// ============================================================================
// Account Abstraction Response Schemas
// ============================================================================

export const GasEstimationResponseSchema = z.object({
  result: z.object({
    callGasLimit: z.string(),
    verificationGasLimit: z.string(),
    preVerificationGas: z.string(),
  }),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string(),
    })
    .optional(),
})

export const PaymasterTokensResponseSchema = z.object({
  options: z
    .array(
      z.object({
        token: z.object({
          address: AddressSchema,
          chainId: ChainIdSchema,
          symbol: z.string(),
          name: z.string(),
          decimals: z.number().int().min(0).max(255),
        }),
        tokenAmount: BigIntSchema,
        ethEquivalent: BigIntSchema,
        usdValue: z.number().nonnegative(),
        isPreferred: z.boolean().optional(),
        reason: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
})

export const SendUserOpResponseSchema = z.object({
  result: HexSchema.optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string(),
    })
    .optional(),
})

export const UserOpReceiptResponseSchema = z.object({
  result: z
    .object({
      success: z.boolean(),
      receipt: z
        .object({
          transactionHash: HexSchema,
        })
        .optional(),
      reason: z.string().optional(),
    })
    .nullable()
    .optional(),
})

// ============================================================================
// GraphQL Response Schemas
// ============================================================================

export const GraphQLErrorSchema = z.object({
  message: z.string(),
  path: z.array(z.string()).optional(),
  locations: z
    .array(
      z.object({
        line: z.number(),
        column: z.number(),
      }),
    )
    .optional(),
})

export const GraphQLResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema.optional(),
    errors: z.array(GraphQLErrorSchema).optional(),
  })

// ============================================================================
// Bundler Response Schemas
// ============================================================================

export const BundlerSendUserOpResponseSchema = z.object({
  result: HexSchema.optional(),
  error: z
    .object({
      message: z.string(),
    })
    .optional(),
})

export const BundlerEstimateGasResponseSchema = z.object({
  result: z.object({
    callGasLimit: z.string(),
    verificationGasLimit: z.string(),
    preVerificationGas: z.string(),
  }),
  error: z
    .object({
      message: z.string(),
    })
    .optional(),
})

export const BundlerReceiptResponseSchema = z.object({
  result: z
    .object({
      success: z.boolean(),
      receipt: z.object({
        transactionHash: HexSchema,
      }),
    })
    .nullable()
    .optional(),
})

// ============================================================================
// Inference Client Response Schemas
// ============================================================================

export const AvailableModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    contextWindow: z.number().optional(),
    pricePerInputToken: z.string().optional(),
    pricePerOutputToken: z.string().optional(),
    provider: z.string().optional(),
    teeType: z
      .enum(['none', 'sgx', 'tdx', 'sev', 'nitro', 'simulated'])
      .optional(),
    active: z.boolean().optional(),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name ?? data.id,
    description: data.description ?? '',
    contextWindow: data.contextWindow ?? 4096,
    pricePerInputToken: data.pricePerInputToken ?? '0',
    pricePerOutputToken: data.pricePerOutputToken ?? '0',
    provider: data.provider ?? 'unknown',
    teeType: data.teeType ?? 'none',
    active: data.active ?? true,
  }))

export const ModelsListResponseSchema = z.object({
  models: z.array(AvailableModelSchema).optional(),
  data: z.array(AvailableModelSchema).optional(),
})

export const ChatCompletionResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().optional(),
        }),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
  cost: z
    .object({
      amount: z.string(),
      currency: z.string().optional(),
      txHash: z.string().optional(),
    })
    .optional(),
  provider: z.string().optional(),
  tee_attestation: z.string().optional(),
})

// ============================================================================
// Intent History Response Schemas
// ============================================================================

export const IntentHistoryItemSchema = z.object({
  id: HexSchema,
  user: AddressSchema,
  inputToken: AddressSchema,
  inputAmount: BigIntSchema,
  outputToken: AddressSchema,
  outputAmount: BigIntSchema,
  sourceChainId: ChainIdSchema,
  destinationChainId: ChainIdSchema,
  recipient: AddressSchema,
  maxFee: BigIntSchema,
  openDeadline: z.number(),
  fillDeadline: z.number(),
  status: z.enum([
    'open',
    'pending',
    'filled',
    'expired',
    'cancelled',
    'failed',
  ]),
  solver: AddressSchema.optional(),
  txHash: HexSchema.optional(),
  fillTxHash: HexSchema.optional(),
  createdAt: z.number(),
})

export const IntentHistoryResponseSchema = z.object({
  intents: z.array(IntentHistoryItemSchema).optional().default([]),
})

// ============================================================================
// Safe API Response Schemas
// ============================================================================

export const SafeConfirmationSchema = z.object({
  owner: AddressSchema,
  signature: HexSchema,
  submissionDate: z.string(),
})

export const SafeTransactionDataSchema = z.object({
  safe: AddressSchema,
  to: AddressSchema,
  value: z.string(),
  data: HexSchema.nullable(),
  operation: z.union([z.literal(0), z.literal(1)]),
  safeTxGas: z.string(),
  baseGas: z.string(),
  gasPrice: z.string(),
  gasToken: AddressSchema,
  refundReceiver: AddressSchema,
  nonce: z.number(),
  confirmations: z.array(SafeConfirmationSchema),
  confirmationsRequired: z.number(),
  isExecuted: z.boolean(),
  safeTxHash: HexSchema,
  proposer: AddressSchema.optional(),
  submissionDate: z.string().optional(),
})

export const SafeTransactionsResponseSchema = z.object({
  results: z.array(SafeTransactionDataSchema),
  count: z.number().optional(),
  next: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
})

// ============================================================================
// OIF Quote Response Schemas
// ============================================================================

export const OIFQuoteResponseSchema = z.object({
  inputToken: AddressSchema,
  inputAmount: BigIntSchema,
  outputToken: AddressSchema,
  outputAmount: BigIntSchema,
  fee: BigIntSchema,
  route: z.array(
    z.object({
      chainId: ChainIdSchema,
      protocol: z.string(),
      action: z.enum(['swap', 'bridge', 'transfer']),
      inputToken: AddressSchema,
      outputToken: AddressSchema,
      inputAmount: BigIntSchema,
      outputAmount: BigIntSchema,
    }),
  ),
  estimatedTime: z.number(),
  priceImpact: z.number(),
})

// ============================================================================
// Indexer Health Response Schemas
// ============================================================================

export const IndexerHealthResponseSchema = z.object({
  status: z.string(),
})

export const IndexerBlocksResponseSchema = z.object({
  blocks: z.array(
    z.object({
      number: z.number(),
    }),
  ),
})

// ============================================================================
// Edge Service Response Schemas
// ============================================================================

export const AppManifestAssetSchema = z.object({
  cid: z.string(),
  name: z.string(),
  mimeType: z.string(),
})

export const AppManifestResponseSchema = z.object({
  assets: z.array(AppManifestAssetSchema),
})

// ============================================================================
// Updater Service Response Schemas
// ============================================================================

export const PlatformTypeSchema = z.enum([
  'web',
  'chrome-extension',
  'firefox-extension',
  'safari-extension',
  'edge-extension',
  'brave-extension',
  'tauri-macos',
  'tauri-windows',
  'tauri-linux',
  'capacitor-ios',
  'capacitor-android',
])

const UpdateAssetSchema = z.object({
  platform: PlatformTypeSchema,
  url: z.string(),
  cid: z.string(),
  hash: z.string(),
  size: z.number(),
})

export const UpdateInfoSchema = z.object({
  version: z.string(),
  releaseDate: z.string(),
  channel: z.enum(['stable', 'beta', 'nightly']),
  changelog: z.string(),
  size: z.number(),
  signature: z.string(),
  assets: z.array(UpdateAssetSchema),
  requiredVersion: z.string().optional(),
  breaking: z.boolean().optional(),
})

export const UpdateManifestResponseSchema = z.object({
  versions: z.array(UpdateInfoSchema),
})
