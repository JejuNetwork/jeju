/**
 * Crucible API Schemas
 *
 * Zod validation schemas for crucible API requests and responses.
 * Uses fail-fast validation pattern.
 */

import {
  AddressSchema,
  expect as baseExpect,
  expectValid,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

// Validation Helpers

export const expect = baseExpect

/** Parse and throw with context */
export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string,
): T {
  return expectValid(schema, data, context)
}

/** Safe parse with null fallback */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data)
  return result.success ? result.data : null
}

// Common Schemas

export const HexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/, 'Invalid hex string')

export const BigIntStringSchema = z
  .string()
  .regex(/^\d+$/, 'Must be numeric string')

// JsonValue recursive type for JSON-serializable values
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

// Agent Request Schemas

export const AgentIdParamSchema = z.object({
  agentId: z.coerce.number().int().positive(),
})

export const BotIdParamSchema = z.object({
  botId: z.coerce.number().int().positive(),
  agentId: z.coerce.number().int().positive().optional(),
})

export const RoomIdParamSchema = z.object({
  roomId: NonEmptyStringSchema,
})

export const RegisterAgentRequestSchema = z.object({
  name: NonEmptyStringSchema,
  characterCid: NonEmptyStringSchema.optional(),
  botType: z.enum(['ai_agent', 'trading_bot', 'org_tool']).default('ai_agent'),
  // Extended fields for full agent registration
  character: z
    .object({
      name: z.string(),
      description: z.string().optional(),
    })
    .optional(),
  initialFunding: z.string().optional(),
})

export const AgentStartRequestSchema = z.object({
  agentId: z.coerce.number().int().positive(),
  characterCid: NonEmptyStringSchema.optional(),
  // Autonomous agent fields
  characterId: NonEmptyStringSchema.optional(),
  tickIntervalMs: z.number().int().positive().optional(),
  capabilities: z
    .object({
      canTrade: z.boolean().optional(),
      canSocial: z.boolean().optional(),
      canResearch: z.boolean().optional(),
    })
    .optional(),
})

export const FundAgentRequestSchema = z.object({
  amount: BigIntStringSchema,
})

export const AgentSearchQuerySchema = z.object({
  name: z.string().optional(),
  owner: AddressSchema.optional(),
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
})

// Chat/Execute Request Schemas

export const ChatRequestSchema = z.object({
  message: NonEmptyStringSchema.optional(),
  text: NonEmptyStringSchema.optional(),
  roomId: NonEmptyStringSchema.optional(),
  userId: NonEmptyStringSchema.optional(),
  context: z.record(z.string(), JsonValueSchema).optional(),
})

// A2A Protocol Message Part
export const A2AMessagePartSchema = z.object({
  kind: z.enum(['text', 'data', 'file']),
  text: z.string().optional(),
  data: z.record(z.string(), JsonValueSchema).optional(),
  file: z
    .object({
      name: z.string(),
      mimeType: z.string(),
      data: z.string(),
    })
    .optional(),
})

// A2A Protocol Message
export const A2AMessageSchema = z.object({
  messageId: z.string(),
  role: z.enum(['user', 'agent']),
  parts: z.array(A2AMessagePartSchema),
})

// A2A Request Schema (JSON-RPC format)
export const A2ARequestSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z
    .object({
      message: A2AMessageSchema.optional(),
    })
    .optional(),
})

// Bot A2A Request (simplified for bot API)
export const BotA2ARequestSchema = z.object({
  method: z.string(),
  params: z.record(z.string(), JsonValueSchema).optional(),
})

export const ExecuteRequestSchema = z.object({
  agentId: z.coerce.number().int().positive(),
  triggerId: NonEmptyStringSchema.optional(),
  input: z.object({
    message: NonEmptyStringSchema.optional(),
    roomId: NonEmptyStringSchema.optional(),
    userId: NonEmptyStringSchema.optional(),
    context: z.lazy(() => JsonObjectSchema).optional(),
  }),
  options: z
    .object({
      maxTokens: PositiveIntSchema.optional(),
      temperature: z.number().min(0).max(2).optional(),
      requireTee: z.boolean().optional(),
      maxCost: BigIntStringSchema.optional(),
      timeout: PositiveIntSchema.optional(),
    })
    .optional(),
})

export const AddMemoryRequestSchema = z.object({
  content: NonEmptyStringSchema,
  importance: z.number().min(0).max(1),
  roomId: NonEmptyStringSchema.optional(),
  userId: NonEmptyStringSchema.optional(),
})

// Room Request Schemas

export const CreateRoomRequestSchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  roomType: z
    .enum(['collaboration', 'adversarial', 'debate', 'council'])
    .default('collaboration'),
  config: z
    .object({
      maxMembers: PositiveIntSchema.default(10),
      turnBased: z.boolean().default(false),
      turnTimeout: PositiveIntSchema.optional(),
      visibility: z
        .enum(['public', 'private', 'members_only'])
        .default('public'),
    })
    .optional(),
})

export const JoinRoomRequestSchema = z.object({
  agentId: z.coerce.number().int().positive(),
  role: z
    .enum(['participant', 'moderator', 'red_team', 'blue_team', 'observer'])
    .default('participant'),
})

export const LeaveRoomRequestSchema = z.object({
  agentId: z.coerce.number().int().positive(),
})

export const PostMessageRequestSchema = z.object({
  content: NonEmptyStringSchema,
  action: z.string().optional(),
  agentId: z.coerce.number().int().positive(),
})

export const SetPhaseRequestSchema = z.object({
  phase: z.enum(['setup', 'active', 'paused', 'completed', 'archived']),
})

// Response Schemas

export const ChatApiResponseSchema = z.object({
  response: z.string(),
  executionId: z.string().optional(),
  cost: z
    .object({
      total: z.string(),
      inference: z.string(),
      storage: z.string(),
    })
    .optional(),
})

export const AgentCharacterSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  description: z.string(),
  system: z.string(),
  bio: z.array(z.string()),
  topics: z.array(z.string()),
  adjectives: z.array(z.string()),
  messageExamples: z.array(
    z.array(
      z.object({
        name: z.string(),
        content: z.object({ text: z.string() }),
      }),
    ),
  ),
  style: z.object({
    all: z.array(z.string()),
    chat: z.array(z.string()),
    post: z.array(z.string()),
  }),
  modelPreferences: z
    .object({
      small: z.string(),
      large: z.string(),
      embedding: z.string().optional(),
    })
    .optional(),
  mcpServers: z.array(z.string()).optional(),
  a2aCapabilities: z.array(z.string()).optional(),
})

export const StorageUploadResponseSchema = z.object({
  cid: NonEmptyStringSchema,
  size: NonNegativeIntSchema.optional(),
})

export const RedstonePriceDataSchema = z.object({
  symbol: z.string(),
  value: z.number(),
  timestamp: z.number(),
})

export const RedstonePriceResponseSchema = z.record(
  z.string(),
  RedstonePriceDataSchema,
)

// Helper Schemas

export const StringArraySchema = z.array(z.string())

export const AgentSearchResponseSchema = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      status: z.string().optional(),
    }),
  ),
  total: z.number().optional(),
})

// Hyperliquid Schemas

export const HyperliquidAssetSchema = z.object({
  name: z.string(),
  szDecimals: z.number(),
  maxLeverage: z.number().optional(),
  onlyIsolated: z.boolean().optional(),
})

export const HyperliquidMetaSchema = z.object({
  universe: z.array(HyperliquidAssetSchema).optional(),
})

export const HyperliquidPositionSchema = z.object({
  position: z.object({
    coin: z.string(),
    szi: z.string(),
    entryPx: z.string(),
    positionValue: z.string().optional(),
    unrealizedPnl: z.string().optional(),
    liquidationPx: z.string().optional(),
  }),
})

export const HyperliquidStateSchema = z.object({
  marginSummary: z
    .object({
      accountValue: z.string().optional(),
      totalNtlPos: z.string().optional(),
      totalRawUsd: z.string().optional(),
    })
    .optional(),
  assetPositions: z.array(HyperliquidPositionSchema).optional(),
})

export const HyperliquidAllMidsSchema = z.record(z.string(), z.string())

export const HyperliquidAssetCtxSchema = z.object({
  funding: z.string(),
  openInterest: z.string().optional(),
  markPx: z.string().optional(),
})

export const HyperliquidMetaAndAssetCtxsSchema = z.tuple([
  HyperliquidMetaSchema,
  z.array(HyperliquidAssetCtxSchema),
])

export const HyperliquidOrderResultSchema = z.object({
  status: z.string().optional(),
  response: z
    .object({
      type: z.string().optional(),
      data: z
        .object({
          statuses: z
            .array(
              z.object({
                resting: z.object({ oid: z.number() }).optional(),
                filled: z.object({ oid: z.number() }).optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
})

// Jito Schemas

export const JitoBundleSubmitSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.number().optional(),
  result: z.string().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

export const JitoBundleStatusSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.number().optional(),
  result: z
    .object({
      value: z
        .array(
          z.object({
            confirmation_status: z.string().optional(),
            err: JsonValueSchema.optional(),
          }),
        )
        .optional(),
      confirmation_status: z.string().optional(),
      err: JsonValueSchema.optional(),
    })
    .optional(),
})

// Jupiter Schemas

export const JupiterPriceDataSchema = z.object({
  id: z.string(),
  mintSymbol: z.string().optional(),
  vsToken: z.string().optional(),
  vsTokenSymbol: z.string().optional(),
  price: z.number(),
})

export const JupiterPriceResponseSchema = z.object({
  data: z.record(z.string(), JupiterPriceDataSchema).optional(),
})

export const JupiterSwapInfoSchema = z.object({
  ammKey: z.string(),
  label: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  feeAmount: z.string(),
  feeMint: z.string().optional(),
})

export const JupiterRoutePlanSchema = z.object({
  swapInfo: JupiterSwapInfoSchema,
  percent: z.number().optional(),
})

export const JupiterQuoteApiResponseSchema = z.object({
  inputMint: z.string().optional(),
  outputMint: z.string().optional(),
  inAmount: z.string().optional(),
  outAmount: z.string().optional(),
  routePlan: z.array(JupiterRoutePlanSchema).optional(),
  priceImpactPct: z.string().optional(),
})

export const JupiterQuoteResponseSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  routePlan: z.array(JupiterRoutePlanSchema),
  priceImpactPct: z.string(),
})

export const JupiterSwapApiResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number().optional(),
})

export const JupiterSwapResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number().optional(),
})

// Raydium Schemas

export const RaydiumPoolMintSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  decimals: z.number(),
})

export const RaydiumPoolDataSchema = z.object({
  id: z.string(),
  mintA: RaydiumPoolMintSchema,
  mintB: RaydiumPoolMintSchema,
  feeRate: z.number(),
  tvl: z.number(),
  apr24h: z.number().optional(),
  volume24h: z.number().optional(),
})

export const RaydiumPoolsResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      data: z.array(RaydiumPoolDataSchema),
    })
    .optional(),
})

export const RaydiumQuoteRouteSchema = z.object({
  poolId: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  inputAmount: z.string(),
  outputAmount: z.string(),
  feeAmount: z.string(),
})

export const RaydiumQuoteDataSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inputAmount: z.string(),
  outputAmount: z.string(),
  priceImpactPct: z.number(),
  routePlan: z.array(RaydiumQuoteRouteSchema),
})

export const RaydiumQuoteResponseSchema = z.object({
  success: z.boolean().optional(),
  data: RaydiumQuoteDataSchema.optional(),
  amountOut: z.string().optional(),
  minAmountOut: z.string().optional(),
  priceImpact: z.string().optional(),
})

export const RaydiumSwapResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      transaction: z.string(),
    })
    .optional(),
  txId: z.string().optional(),
})

export const RaydiumLiquidityResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      transaction: z.string(),
    })
    .optional(),
  txId: z.string().optional(),
})

export const RaydiumPositionDataSchema = z.object({
  positionId: z.string().optional(),
  poolId: z.string(),
  mintA: RaydiumPoolMintSchema,
  mintB: RaydiumPoolMintSchema,
  amountA: z.string(),
  amountB: z.string(),
  valueUsd: z.number(),
})

export const RaydiumPositionsResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.array(RaydiumPositionDataSchema).optional(),
  positions: z.array(JsonValueSchema).optional(),
})

// Orca Schemas

export const OrcaWhirlpoolSchema = z.object({
  address: z.string(),
  tokenMintA: z.string(),
  tokenMintB: z.string(),
  feeRate: z.number(),
  tvl: z.number(),
  apr24h: z.number().optional(),
  volume24h: z.number().optional(),
  tickSpacing: z.number(),
  currentTick: z.number().optional(),
  sqrtPrice: z.string().optional(),
})

export const OrcaPoolsResponseSchema = z.object({
  whirlpools: z.array(OrcaWhirlpoolSchema).optional(),
})

export const OrcaPoolResponseSchema = z.object({
  address: z.string(),
  tokenMintA: z.string(),
  tokenMintB: z.string(),
  feeRate: z.number(),
  tvl: z.number(),
  tickSpacing: z.number(),
  currentTick: z.number(),
  sqrtPrice: z.string(),
})

export const OrcaRouteStepSchema = z.object({
  whirlpool: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  inputAmount: z.string(),
  outputAmount: z.string(),
})

export const OrcaQuoteResponseSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  priceImpact: z.number(),
  route: z.array(OrcaRouteStepSchema),
})

export const OrcaSwapResponseSchema = z.object({
  transaction: z.string(),
})

export const OrcaLiquidityResponseSchema = z.object({
  transaction: z.string(),
})

export const OrcaPositionTokenSchema = z.object({
  mint: z.string(),
  amount: z.string(),
})

export const OrcaPositionFeesSchema = z.object({
  a: z.string(),
  b: z.string(),
})

export const OrcaPositionSchema = z.object({
  address: z.string(),
  whirlpool: z.string(),
  tokenA: OrcaPositionTokenSchema,
  tokenB: OrcaPositionTokenSchema,
  valueUsd: z.number(),
  feesOwed: OrcaPositionFeesSchema,
  tickLower: z.number(),
  tickUpper: z.number(),
  liquidity: z.string(),
  inRange: z.boolean(),
})

export const OrcaPositionsResponseSchema = z.object({
  positions: z.array(OrcaPositionSchema).optional(),
})

// Meteora Schemas

export const MeteoraPoolSchema = z.object({
  address: z.string(),
  name: z.string(),
  mintX: z.string(),
  mintY: z.string(),
  reserveX: z.string(),
  reserveY: z.string(),
  baseFee: z.number(),
  tvl: z.number(),
  apr: z.number().optional(),
  volume24h: z.number().optional(),
  binStep: z.number(),
  activeBin: z.number().optional(),
})

export const MeteoraPoolsResponseSchema = z.array(MeteoraPoolSchema)

export const MeteoraPoolResponseSchema = MeteoraPoolSchema

export const MeteoraQuoteResponseSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  priceImpact: z.number(),
  poolAddress: z.string(),
})

export const MeteoraSwapResponseSchema = z.object({
  transaction: z.string(),
})

export const MeteoraLiquidityResponseSchema = z.object({
  transaction: z.string(),
})

export const MeteoraPositionFeesSchema = z.object({
  x: z.string(),
  y: z.string(),
})

export const MeteoraPositionSchema = z.object({
  publicKey: z.string(),
  poolAddress: z.string(),
  mintX: z.string(),
  mintY: z.string(),
  amountX: z.string(),
  amountY: z.string(),
  valueUsd: z.number(),
  totalClaimedFees: MeteoraPositionFeesSchema,
  lowerBinId: z.number(),
  upperBinId: z.number(),
})

export const MeteoraPositionsResponseSchema = z.array(MeteoraPositionSchema)

// Solana Schemas

export const SolanaDexPoolTokenSchema = z.object({
  symbol: z.string(),
  mint: z.string(),
  decimals: z.number(),
})

export const SolanaDexPoolAprSchema = z.object({
  trading: z.number().optional(),
  rewards: z.number().optional(),
})

export const SolanaDexPoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenA: SolanaDexPoolTokenSchema,
  tokenB: SolanaDexPoolTokenSchema,
  tvl: z.number(),
  volume24h: z.number().optional(),
  fee: z.number().optional(),
  apr: SolanaDexPoolAprSchema.optional(),
})

export const SolanaDexPoolsResponseSchema = z.object({
  data: z.array(SolanaDexPoolSchema).optional(),
  pools: z.array(SolanaDexPoolSchema).optional(),
})

export const SolanaLendingMarketSchema = z.object({
  symbol: z.string(),
  mint: z.string(),
  decimals: z.number(),
  supplyApr: z.number(),
  tvl: z.number(),
})

export const SolanaLendingMarketsResponseSchema = z.object({
  markets: z.array(SolanaLendingMarketSchema).optional(),
})

// Alchemy / WebSocket Schemas

// Transaction object from pending transaction subscription
export const PendingTransactionSchema = z.object({
  hash: z.string(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  gasPrice: z.string().optional(),
  maxFeePerGas: z.string().optional(),
  maxPriorityFeePerGas: z.string().optional(),
  gas: z.string(),
  input: z.string(),
  nonce: z.string(),
})

export const AlchemySubscriptionMessageSchema = z.object({
  jsonrpc: z.string().optional(),
  method: z.string().optional(),
  params: z
    .object({
      subscription: z.string().optional(),
      // Can be full tx object (Alchemy) or tx hash string (other providers)
      result: z.union([PendingTransactionSchema, z.string()]).optional(),
    })
    .optional(),
})

export const WebSocketEthSubscriptionMessageSchema = z.object({
  jsonrpc: z.string().optional(),
  method: z.string().optional(),
  params: z
    .object({
      subscription: z.string().optional(),
      // Can be full tx object (Alchemy) or tx hash string (other providers)
      result: z.union([PendingTransactionSchema, z.string()]).optional(),
    })
    .optional(),
})

// ZK Bridge Schemas

export const ZKBridgeTxResponseSchema = z.object({
  hash: z.string().optional(),
  txHash: z.string().optional(), // Alias for hash
  status: z.string().optional(),
})

// MCP Schemas

export const MCPToolCallRequestSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), JsonValueSchema).optional(),
})

export const MCPResourceReadRequestSchema = z.object({
  uri: z.string(),
})

// Strategy/State Schemas

export const StrategyTypeSchema = z.enum([
  'arb',
  'lp',
  'lending',
  'mev',
  'custom',
])

export const MemoryEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
  embedding: z.array(z.number()).nullable().optional(),
  importance: z.number(),
  createdAt: z.number(),
  roomId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
})

export const AgentStateSchema = z.object({
  agentId: z.string(),
  version: z.number().default(0),
  memories: z.array(MemoryEntrySchema).default([]),
  rooms: z.array(z.string()).default([]),
  context: z
    .record(
      z.string(),
      JsonValueSchema.or(
        z
          .object({
            executionId: z.string(),
            timestamp: z.number(),
            triggerId: z.string().nullable().optional(),
          })
          .nullable(),
      ).nullable(),
    )
    .default({}),
  updatedAt: z.number().default(Date.now()),
  status: z.string().optional(),
  lastUpdate: z.number().optional(),
})

export const OrgStateSchema = z.object({
  name: z.string().optional(),
  members: z.array(z.string()).optional(),
})

// MessageMetadata schema - must match lib/types.ts interface with JsonValue index signature
export const MessageMetadataSchema = z
  .record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.undefined(),
      JsonValueSchema,
    ]),
  )
  .and(
    z.object({
      source: z.string().nullable().optional(),
      replyTo: z.string().nullable().optional(),
      attachments: z.array(z.string()).nullable().optional(),
    }),
  )

export const RoomMessageSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  content: z.string(),
  timestamp: z.number(),
  action: z.string().nullable().optional(),
  metadata: MessageMetadataSchema.nullable().optional(),
})

export const RoomStateMetadataSchema = z
  .object({
    topic: z.string().nullable().optional(),
    rules: z.array(z.string()).nullable().optional(),
  })
  .passthrough()

export const RoomStateSchema = z.object({
  roomId: z.string(),
  version: z.number().default(0),
  messages: z.array(RoomMessageSchema).default([]),
  scores: z.record(z.string(), z.number()).default({}),
  currentTurn: z.string().nullable().optional(),
  phase: z
    .enum(['setup', 'active', 'paused', 'completed', 'archived'])
    .default('setup'),
  metadata: RoomStateMetadataSchema.default({}),
  updatedAt: z.number().default(Date.now()),
  id: z.string().optional(),
  participants: z.array(z.string()).default([]),
})

// Request Schemas

export const SwapRequestSchema = z.object({
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  slippage: z.number().optional(),
  // Aliases for API compatibility
  inputMint: z.string().optional(),
  outputMint: z.string().optional(),
  amount: z.string().optional(),
})

export const AddLiquidityRequestSchema = z.object({
  poolId: z.string(),
  chain: z.string().optional(),
  dex: z.string().optional(),
  amount0: z.string().optional(),
  amount1: z.string().optional(),
  amountA: z.string().optional(),
  amountB: z.string().optional(),
})

export const QuotesParamsSchema = z.object({
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  // Aliases for API compatibility
  inputMint: z.string().optional(),
  outputMint: z.string().optional(),
  amount: z.string().optional(),
})

export const RebalanceActionIdParamSchema = z.object({
  actionId: z.string(),
})

export const YieldVerifyParamSchema = z.object({
  positionId: z.string(),
  id: z.string().optional(),
})

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema)

// DEX Aggregator Schemas

export const OneInchQuoteResponseSchema = z.object({
  dstAmount: z.string(),
  toAmount: z.string().optional(),
  toTokenAmount: z.string().optional(),
  protocols: z.array(JsonValueSchema).optional(),
  estimatedGas: z.number().optional(),
  gas: z.number().optional(),
  tx: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      data: z.string().optional(),
      value: z.string().optional(),
      gas: z.number().optional(),
      gasPrice: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
})

export const ParaswapQuoteResponseSchema = z.object({
  priceRoute: z
    .object({
      srcAmount: z.string().optional(),
      destAmount: z.string(),
      tokenTransferProxy: z.string().optional(),
      gasCost: z.string(),
      bestRoute: z.array(JsonValueSchema).optional(),
    })
    .optional(),
  error: z.string().optional(),
})

// MEV / Flashbots Schemas

export const FlashbotsBundleResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.number().optional(),
  result: z
    .object({
      bundleHash: z.string().optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

export const FlashbotsBundleStatsSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.number().optional(),
  result: z
    .object({
      isSimulated: z.boolean().optional(),
      isIncluded: z.boolean().optional(),
      blockNumber: z.string().optional(),
      simulatedAt: z.string().optional(),
      receivedAt: z.string().optional(),
    })
    .optional(),
})

export const FlashbotsSimulationResultItemSchema = z.object({
  txHash: z.string(),
  gasUsed: z.string(),
  revert: z.string().nullable(),
})

export const FlashbotsSimulationResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.number().optional(),
  result: z
    .object({
      success: z.boolean().optional(),
      error: z.string().optional(),
      results: z.array(FlashbotsSimulationResultItemSchema).optional(),
      totalGasUsed: z.string().optional(),
      coinbaseDiff: z.string().optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

export const L2RawTxResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.number().optional(),
  result: z.string().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

export const MevSharePrivateTxResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.number().optional(),
  result: z
    .union([
      z.string(), // Some endpoints return txHash directly as string
      z.object({
        matchId: z.string().optional(),
        bundleHash: z.string().optional(),
        txHash: z.string().optional(),
      }),
    ])
    .optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

export const MevShareCancelResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.number().optional(),
  result: z.boolean().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

// Type Exports

export type PendingTransaction = z.infer<typeof PendingTransactionSchema>
export type AgentIdParam = z.infer<typeof AgentIdParamSchema>
export type BotIdParam = z.infer<typeof BotIdParamSchema>
export type RoomIdParam = z.infer<typeof RoomIdParamSchema>
export type RegisterAgentRequest = z.infer<typeof RegisterAgentRequestSchema>
export type AgentStartRequest = z.infer<typeof AgentStartRequestSchema>
export type FundAgentRequest = z.infer<typeof FundAgentRequestSchema>
export type AgentSearchQuery = z.infer<typeof AgentSearchQuerySchema>
export type ChatRequest = z.infer<typeof ChatRequestSchema>
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>
export type AddMemoryRequest = z.infer<typeof AddMemoryRequestSchema>
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>
export type LeaveRoomRequest = z.infer<typeof LeaveRoomRequestSchema>
export type PostMessageRequest = z.infer<typeof PostMessageRequestSchema>
export type SetPhaseRequest = z.infer<typeof SetPhaseRequestSchema>
export type ChatApiResponse = z.infer<typeof ChatApiResponseSchema>
export type AgentCharacter = z.infer<typeof AgentCharacterSchema>
export type StorageUploadResponse = z.infer<typeof StorageUploadResponseSchema>
export type RedstonePriceResponse = z.infer<typeof RedstonePriceResponseSchema>
