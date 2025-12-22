/**
 * Shared Validation Schemas and Utilities
 *
 * Provides Zod-based validation for all gateway endpoints with fail-fast patterns
 */

import {
  AddressSchema,
  expectAddress as baseExpectAddress,
  expectChainId as baseExpectChainId,
  expectValid as baseExpectValid,
  HexSchema,
  NonEmptyStringSchema,
  NonNegativeNumberStringSchema,
  PositiveNumberStringSchema,
  type SupportedChainId,
  SupportedChainIdSchema,
} from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'

export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Schema for JSON-serializable values.
 * Use this instead of z.unknown() for API data that must be JSON-compatible.
 */
export const JsonPrimitiveSchema: z.ZodType<JsonPrimitive> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

/**
 * Schema for JSON objects (key-value pairs with JSON-serializable values).
 * Use for API request/response data fields.
 */
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema)
export type JsonObject = z.infer<typeof JsonObjectSchema>

export type RpcParamValue =
  | string
  | number
  | boolean
  | null
  | RpcParamValue[]
  | { [key: string]: RpcParamValue }
export const RpcParamValueSchema: z.ZodType<RpcParamValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(RpcParamValueSchema),
    z.record(z.string(), RpcParamValueSchema),
  ]),
)

// ============================================================================
// Common Schemas
// ============================================================================

export const HexStringSchema = HexSchema
export type HexString = z.infer<typeof HexStringSchema>

export {
  AddressSchema,
  NonEmptyStringSchema,
  PositiveNumberStringSchema,
  NonNegativeNumberStringSchema,
}

export const ChainIdSchema = SupportedChainIdSchema
export type ChainId = SupportedChainId

export const CreateIntentRequestSchema = z.object({
  sourceChain: ChainIdSchema,
  destinationChain: ChainIdSchema,
  sourceToken: AddressSchema.transform((val) => val as `0x${string}`),
  destinationToken: AddressSchema.transform((val) => val as `0x${string}`),
  amount: PositiveNumberStringSchema,
  recipient: AddressSchema.transform((val) => val as `0x${string}`).nullable(),
  maxFee: NonNegativeNumberStringSchema.nullable(),
})
export type CreateIntentRequest = z.infer<typeof CreateIntentRequestSchema>

export const GetQuoteRequestSchema = z.object({
  sourceChain: ChainIdSchema,
  destinationChain: ChainIdSchema,
  sourceToken: AddressSchema.transform((val) => val as `0x${string}`),
  destinationToken: AddressSchema.transform((val) => val as `0x${string}`),
  amount: PositiveNumberStringSchema,
})
export type GetQuoteRequest = z.infer<typeof GetQuoteRequestSchema>

export const IntentIdSchema = z.string().min(1)
export type IntentId = z.infer<typeof IntentIdSchema>

export const ListIntentsQuerySchema = z.object({
  user: AddressSchema.transform((val) => val as `0x${string}`).nullable(),
  status: z
    .enum(['open', 'pending', 'filled', 'expired', 'cancelled', 'failed'])
    .nullable(),
  sourceChain: ChainIdSchema.nullable(),
  destinationChain: ChainIdSchema.nullable(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
})
export type ListIntentsQuery = z.infer<typeof ListIntentsQuerySchema>

export const CancelIntentRequestSchema = z.object({
  user: AddressSchema,
})
export type CancelIntentRequest = z.infer<typeof CancelIntentRequestSchema>

// ============================================================================
// Route Schemas
// ============================================================================

export const ListRoutesQuerySchema = z.object({
  sourceChain: ChainIdSchema.nullable(),
  destinationChain: ChainIdSchema.nullable(),
  active: z.coerce.boolean().nullable(),
})
export type ListRoutesQuery = z.infer<typeof ListRoutesQuerySchema>

export const RouteIdSchema = z.string().min(1)
export type RouteId = z.infer<typeof RouteIdSchema>

export const GetBestRouteRequestSchema = z.object({
  sourceChain: ChainIdSchema,
  destinationChain: ChainIdSchema,
  prioritize: z.enum(['speed', 'cost']).default('cost'),
})
export type GetBestRouteRequest = z.infer<typeof GetBestRouteRequestSchema>

export const GetVolumeQuerySchema = z.object({
  routeId: RouteIdSchema.nullable(),
  sourceChain: ChainIdSchema.nullable(),
  destinationChain: ChainIdSchema.nullable(),
  period: z.enum(['24h', '7d', '30d', 'all']).default('24h'),
})
export type GetVolumeQuery = z.infer<typeof GetVolumeQuerySchema>

export const ListSolversQuerySchema = z.object({
  chainId: ChainIdSchema.nullable(),
  minReputation: z.coerce.number().int().min(0).max(100).nullable(),
  active: z.coerce.boolean().default(true),
})
export type ListSolversQuery = z.infer<typeof ListSolversQuerySchema>

export const SolverAddressSchema = AddressSchema
export type SolverAddress = Address

export const SolverLeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(['volume', 'fills', 'reputation', 'successRate'])
    .default('volume'),
})
export type SolverLeaderboardQuery = z.infer<
  typeof SolverLeaderboardQuerySchema
>

// ============================================================================
// Pool Schemas
// ============================================================================

export const TokenPairSchema = z.object({
  token0: AddressSchema.transform((val) => val as `0x${string}`),
  token1: AddressSchema.transform((val) => val as `0x${string}`),
})
export type TokenPair = z.infer<typeof TokenPairSchema>

export const SwapQuoteRequestSchema = z.object({
  tokenIn: AddressSchema.transform((val) => val as `0x${string}`),
  tokenOut: AddressSchema.transform((val) => val as `0x${string}`),
  amountIn: PositiveNumberStringSchema,
})
export type SwapQuoteRequest = z.infer<typeof SwapQuoteRequestSchema>

export const ListPoolsQuerySchema = z.object({
  type: z.enum(['v2']).nullable(),
  token0: AddressSchema.nullable(),
  token1: AddressSchema.nullable(),
})
export type ListPoolsQuery = z.infer<typeof ListPoolsQuerySchema>

export const CheckBanStatusRequestSchema = z.object({
  address: AddressSchema,
})
export type CheckBanStatusRequest = z.infer<typeof CheckBanStatusRequestSchema>

export const GetModeratorProfileRequestSchema = z.object({
  address: AddressSchema,
})
export type GetModeratorProfileRequest = z.infer<
  typeof GetModeratorProfileRequestSchema
>

export const GetModerationCasesQuerySchema = z.object({
  activeOnly: z.coerce.boolean().nullable(),
  resolvedOnly: z.coerce.boolean().nullable(),
  limit: z.coerce.number().int().min(1).max(1000).nullable().default(100),
})
export type GetModerationCasesQuery = z.infer<
  typeof GetModerationCasesQuerySchema
>

export const CaseIdSchema = z.string().min(1)
export type CaseId = z.infer<typeof CaseIdSchema>

export const GetReportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).nullable().default(100),
  pendingOnly: z.coerce.boolean().nullable(),
})
export type GetReportsQuery = z.infer<typeof GetReportsQuerySchema>

export const AgentIdSchema = z.coerce.number().int().positive()
export type AgentId = z.infer<typeof AgentIdSchema>

export const PrepareStakeRequestSchema = z.object({
  amount: PositiveNumberStringSchema,
})
export type PrepareStakeRequest = z.infer<typeof PrepareStakeRequestSchema>

export const PrepareReportRequestSchema = z.object({
  target: AddressSchema.transform((val) => val as `0x${string}`),
  reason: NonEmptyStringSchema,
  evidenceHash: HexStringSchema.transform((val) => val as Hex),
})
export type PrepareReportRequest = z.infer<typeof PrepareReportRequestSchema>

export const PrepareVoteRequestSchema = z.object({
  caseId: CaseIdSchema,
  voteYes: z.boolean(),
})
export type PrepareVoteRequest = z.infer<typeof PrepareVoteRequestSchema>

export const PrepareChallengeRequestSchema = z.object({
  caseId: CaseIdSchema,
  stakeAmount: PositiveNumberStringSchema,
})
export type PrepareChallengeRequest = z.infer<
  typeof PrepareChallengeRequestSchema
>

export const PrepareAppealRequestSchema = z.object({
  caseId: CaseIdSchema,
  stakeAmount: PositiveNumberStringSchema,
})
export type PrepareAppealRequest = z.infer<typeof PrepareAppealRequestSchema>

// ============================================================================
// Faucet Schemas
// ============================================================================

export const FaucetStatusRequestSchema = z.object({
  address: AddressSchema.transform((val) => val as `0x${string}`),
})
export type FaucetStatusRequest = z.infer<typeof FaucetStatusRequestSchema>

export const FaucetClaimRequestSchema = z.object({
  address: AddressSchema.transform((val) => val as `0x${string}`),
})
export type FaucetClaimRequest = z.infer<typeof FaucetClaimRequestSchema>

export const RpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.array(RpcParamValueSchema).nullable(),
})
export type RpcRequest = z.infer<typeof RpcRequestSchema>

export const RpcBatchRequestSchema = z.array(RpcRequestSchema).min(1).max(100)
export type RpcBatchRequest = z.infer<typeof RpcBatchRequestSchema>

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().max(100).nullable(),
  address: AddressSchema,
})
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>

export const KeyIdSchema = z
  .string()
  .length(32)
  .regex(/^[a-f0-9]{32}$/)
export type KeyId = z.infer<typeof KeyIdSchema>

export const PurchaseCreditsRequestSchema = z.object({
  txHash: HexStringSchema,
  amount: z.string().refine(
    (val) => {
      try {
        const num = BigInt(val)
        return num > 0n
      } catch {
        return false
      }
    },
    { error: 'Must be a valid positive bigint string' },
  ),
})
export type PurchaseCreditsRequest = z.infer<
  typeof PurchaseCreditsRequestSchema
>

export const PaymentRequirementQuerySchema = z.object({
  chainId: ChainIdSchema.nullable(),
  method: z.string().min(1).nullable(),
})
export type PaymentRequirementQuery = z.infer<
  typeof PaymentRequirementQuerySchema
>

// ============================================================================
// Leaderboard Schemas
// ============================================================================

export const UsernameSchema = z.string().min(1).max(100)
export type Username = z.infer<typeof UsernameSchema>

export const GetAttestationQuerySchema = z.object({
  wallet: AddressSchema.transform((val) => val as `0x${string}`).nullable(),
  username: UsernameSchema.nullable(),
  chainId: z.string().nullable(),
})
export type GetAttestationQuery = z.infer<typeof GetAttestationQuerySchema>

export const CreateAttestationRequestSchema = z.object({
  username: UsernameSchema,
  walletAddress: AddressSchema.transform((val) => val as `0x${string}`),
  chainId: z.string().nullable(),
  agentId: z.coerce.number().int().nonnegative().nullable(),
})
export type CreateAttestationRequest = z.infer<
  typeof CreateAttestationRequestSchema
>

export const ConfirmAttestationRequestSchema = z.object({
  attestationHash: HexStringSchema,
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash')
    .transform((s) => s.toLowerCase() as `0x${string}`),
  walletAddress: AddressSchema,
  chainId: z.string().nullable(),
})
export type ConfirmAttestationRequest = z.infer<
  typeof ConfirmAttestationRequestSchema
>

export const WalletVerifyQuerySchema = z.object({
  username: UsernameSchema,
  wallet: AddressSchema.nullable(),
})
export type WalletVerifyQuery = z.infer<typeof WalletVerifyQuerySchema>

export const WalletVerifyRequestSchema = z.object({
  username: UsernameSchema,
  walletAddress: AddressSchema,
  signature: HexStringSchema,
  message: NonEmptyStringSchema,
  timestamp: z.number().int().positive(),
  chainId: z.string().nullable(),
})
export type WalletVerifyRequest = z.infer<typeof WalletVerifyRequestSchema>

export const AgentLinkQuerySchema = z.object({
  wallet: AddressSchema.nullable(),
  username: UsernameSchema.nullable(),
  agentId: z.coerce.number().int().positive().nullable(),
})
export type AgentLinkQuery = z.infer<typeof AgentLinkQuerySchema>

export const CreateAgentLinkRequestSchema = z.object({
  username: UsernameSchema,
  walletAddress: AddressSchema,
  agentId: z.coerce.number().int().positive(),
  registryAddress: AddressSchema,
  chainId: z.string().nullable(),
  txHash: HexStringSchema.nullable(),
})
export type CreateAgentLinkRequest = z.infer<
  typeof CreateAgentLinkRequestSchema
>

export const LeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
})
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>

export const A2AMessagePartSchema = z.object({
  kind: z.string(),
  text: z.string().nullable(),
  data: JsonObjectSchema.nullable(),
})
export type A2AMessagePart = z.infer<typeof A2AMessagePartSchema>

export const A2ARequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('message/send'),
  id: z.union([z.string(), z.number()]),
  params: z.object({
    message: z.object({
      messageId: z.string().min(1),
      parts: z.array(A2AMessagePartSchema),
    }),
  }),
})
export type A2ARequest = z.infer<typeof A2ARequestSchema>

// ============================================================================
// MCP Schemas
// ============================================================================

export const McpResourceReadRequestSchema = z.object({
  uri: z.string().min(1),
})
export type McpResourceReadRequest = z.infer<
  typeof McpResourceReadRequestSchema
>

export const McpToolCallRequestSchema = z.object({
  name: z.string().min(1),
  arguments: JsonObjectSchema.nullable().default({}),
})
export type McpToolCallRequest = z.infer<typeof McpToolCallRequestSchema>

export const EILChainStatusSchema = z.enum(['active', 'planned', 'deprecated'])
export type EILChainStatus = z.infer<typeof EILChainStatusSchema>

export const EILHubConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  rpcUrl: z.string().nullable(),
  l1StakeManager: z.string(),
  crossChainPaymaster: z.string().nullable(),
  status: EILChainStatusSchema,
})
export type EILHubConfig = z.infer<typeof EILHubConfigSchema>

/**
 * Individual chain configuration in EIL
 */
export const EILChainConfigSchema = z.object({
  chainId: z.number().int().positive().nullable(),
  name: z.string().min(1),
  rpcUrl: z.string().nullable(),
  crossChainPaymaster: z.string(),
  l1StakeManager: z.string().nullable(),
  status: EILChainStatusSchema,
  type: z.string().nullable(),
  oif: z.record(z.string(), z.string()).nullable(),
  tokens: z.record(z.string(), z.string()).nullable(),
  programs: z.record(z.string(), z.string()).nullable(),
})
export type EILChainConfig = z.infer<typeof EILChainConfigSchema>

export const EILNetworkConfigSchema = z.object({
  hub: EILHubConfigSchema,
  chains: z.record(z.string(), EILChainConfigSchema),
})
export type EILNetworkConfig = z.infer<typeof EILNetworkConfigSchema>

export const EILJsonConfigSchema = z.object({
  version: z.string(),
  lastUpdated: z.string(),
  description: z.string().nullable(),
  entryPoint: z.string(),
  l2Messenger: z.string(),
  supportedTokens: z.array(z.string()),
  testnet: EILNetworkConfigSchema,
  mainnet: EILNetworkConfigSchema,
  localnet: EILNetworkConfigSchema,
})
export type EILJsonConfig = z.infer<typeof EILJsonConfigSchema>

// ============================================================================
// Cached Data Schemas (for JSON.parse validation)
// ============================================================================

/**
 * Intent input/output token schemas
 */
export const IntentTokenAmountSchema = z.object({
  token: AddressSchema,
  amount: z.string(),
  chainId: z.number().int().positive().nullable(),
})
export type IntentTokenAmount = z.infer<typeof IntentTokenAmountSchema>

export const CachedIntentSchema = z.object({
  intentId: HexSchema,
  user: AddressSchema,
  nonce: z.string(),
  sourceChainId: z.number().int().positive(),
  openDeadline: z.number().int(),
  fillDeadline: z.number().int(),
  inputs: z.array(IntentTokenAmountSchema),
  outputs: z.array(IntentTokenAmountSchema),
  signature: HexSchema,
  status: z.enum([
    'open',
    'pending',
    'filled',
    'expired',
    'cancelled',
    'failed',
  ]),
  solver: AddressSchema.nullable(),
  txHash: HexSchema.nullable(),
  createdAt: z.number().int().nullable(),
  filledAt: z.number().int().nullable(),
  cancelledAt: z.number().int().nullable(),
})
export type CachedIntent = z.infer<typeof CachedIntentSchema>

/**
 * Solver liquidity entry schema
 */
export const SolverLiquiditySchema = z.object({
  chainId: z.number().int().positive(),
  token: AddressSchema,
  amount: z.string(),
})
export type SolverLiquidity = z.infer<typeof SolverLiquiditySchema>

export const CachedSolverSchema = z.object({
  address: AddressSchema,
  name: z.string(),
  endpoint: z.string().nullable(),
  supportedChains: z.array(z.number().int().positive()),
  supportedTokens: z.record(z.string(), z.array(AddressSchema)),
  liquidity: z.array(SolverLiquiditySchema).nullable(),
  reputation: z.number().int(),
  totalFills: z.number().int(),
  successfulFills: z.number().int(),
  failedFills: z.number().int(),
  successRate: z.number(),
  avgResponseMs: z.number().nullable(),
  avgFillTimeMs: z.number().nullable(),
  totalVolumeUsd: z.string(),
  totalFeesEarnedUsd: z.string(),
  stakedAmount: z.string(),
  status: z.enum(['active', 'inactive', 'banned']),
  registeredAt: z.number().int(),
  lastActiveAt: z.number().int().nullable(),
})
export type CachedSolver = z.infer<typeof CachedSolverSchema>

export const ResolvedContentSchema = z.object({
  cid: z.string().min(1),
  codec: z.enum(['ipfs', 'ipns', 'swarm', 'arweave']),
})
export type ResolvedContent = z.infer<typeof ResolvedContentSchema>

/**
 * X402 Payment Proof schema (for x402-payments.ts)
 */
export const X402PaymentProofSchema = z.object({
  payTo: AddressSchema,
  amount: z.string(),
  nonce: z.string(),
  timestamp: z.number().int().positive(),
  network: z.string(),
  signature: z.string(),
})
export type X402PaymentProof = z.infer<typeof X402PaymentProofSchema>

export const RpcChainInfoSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string(),
  shortName: z.string(),
  rpcEndpoint: z.string(),
  explorerUrl: z.string(),
  isTestnet: z.boolean(),
  nativeCurrency: z.object({
    name: z.string(),
    symbol: z.string(),
    decimals: z.number().int().nonnegative(),
  }),
})
export type RpcChainInfo = z.infer<typeof RpcChainInfoSchema>

export const RpcChainsResponseSchema = z.object({
  chains: z.array(RpcChainInfoSchema),
})
export type RpcChainsResponse = z.infer<typeof RpcChainsResponseSchema>

export const FlashbotsRpcResponseSchema = z.object({
  result: JsonValueSchema.optional(),
  error: z
    .object({
      message: z.string(),
    })
    .nullable(),
})
export type FlashbotsRpcResponse = z.infer<typeof FlashbotsRpcResponseSchema>

export const FlashbotsBundleHashResponseSchema = z.object({
  result: z
    .object({
      bundleHash: HexSchema,
    })
    .nullable(),
  error: z
    .object({
      message: z.string(),
    })
    .nullable(),
})
export type FlashbotsBundleHashResponse = z.infer<
  typeof FlashbotsBundleHashResponseSchema
>

export const FlashbotsProtectedTxResponseSchema = z.object({
  result: HexSchema.nullable(),
  error: z
    .object({
      message: z.string(),
    })
    .nullable(),
})
export type FlashbotsProtectedTxResponse = z.infer<
  typeof FlashbotsProtectedTxResponseSchema
>

export const FlashbotsProtectedStatusResponseSchema = z.object({
  result: z
    .object({
      status: z.string(),
      includedBlock: z.string().nullable(),
    })
    .nullable(),
  error: z
    .object({
      message: z.string(),
    })
    .nullable(),
})
export type FlashbotsProtectedStatusResponse = z.infer<
  typeof FlashbotsProtectedStatusResponseSchema
>

export const FlashbotsSimulationResultSchema = z.object({
  txHash: z.string(),
  gasUsed: z.string(),
  value: z.string(),
  error: z.string().nullable(),
})
export type FlashbotsSimulationResult = z.infer<
  typeof FlashbotsSimulationResultSchema
>

export const FlashbotsSimulationResponseSchema = z.object({
  result: z
    .object({
      results: z.array(FlashbotsSimulationResultSchema),
      totalGasUsed: z.string(),
      coinbaseDiff: z.string(),
      ethSentToCoinbase: z.string(),
    })
    .nullable(),
  error: z
    .object({
      message: z.string(),
    })
    .nullable(),
})
export type FlashbotsSimulationResponse = z.infer<
  typeof FlashbotsSimulationResponseSchema
>

export const FlashbotsBundleStatsResponseSchema = z.object({
  result: z
    .object({
      isHighPriority: z.boolean(),
      isSentToMiners: z.boolean(),
      isSimulated: z.boolean(),
      simulatedAt: z.string().nullable(),
      receivedAt: z.string().nullable(),
      consideredByBuildersAt: z.array(z.string()).nullable(),
    })
    .nullable(),
  error: z
    .object({
      message: z.string(),
    })
    .nullable(),
})
export type FlashbotsBundleStatsResponse = z.infer<
  typeof FlashbotsBundleStatsResponseSchema
>

export const FlashbotsBlockNumberResponseSchema = z.object({
  result: z.string().nullable(),
})
export type FlashbotsBlockNumberResponse = z.infer<
  typeof FlashbotsBlockNumberResponseSchema
>

export const FlashbotsL2BlockResponseSchema = z.object({
  result: z
    .object({
      blockHash: HexSchema,
    })
    .nullable(),
  error: z
    .object({
      message: z.string(),
    })
    .nullable(),
})
export type FlashbotsL2BlockResponse = z.infer<
  typeof FlashbotsL2BlockResponseSchema
>

export const FlashbotsSuaveResponseSchema = z.object({
  result: z
    .object({
      requestId: HexSchema,
    })
    .nullable(),
  error: z
    .object({
      message: z.string(),
    })
    .nullable(),
})
export type FlashbotsSuaveResponse = z.infer<
  typeof FlashbotsSuaveResponseSchema
>

/** Schema for MEV-Share SSE event data */
export const MevShareEventDataSchema = z.object({
  hash: z.string(),
  logs: z.array(
    z.object({
      address: z.string(),
      topics: z.array(z.string()),
      data: z.string(),
    }),
  ),
  txs: z.array(
    z.object({
      to: z.string(),
      functionSelector: z.string(),
      callData: z.string().nullable(),
    }),
  ),
  mevGasPrice: z.string().nullable(),
  gasUsed: z.string().nullable(),
})
export type MevShareEventData = z.infer<typeof MevShareEventDataSchema>

export const AlchemyPendingTxMessageSchema = z.object({
  params: z
    .object({
      result: z
        .object({
          hash: z.string(),
          from: z.string(),
          to: z.string().nullable(),
          input: z.string(),
          value: z.string(),
          gasPrice: z.string().nullable(),
          maxFeePerGas: z.string().nullable(),
          maxPriorityFeePerGas: z.string().nullable(),
          nonce: z.string(),
        })
        .nullable(),
    })
    .nullable(),
})
export type AlchemyPendingTxMessage = z.infer<
  typeof AlchemyPendingTxMessageSchema
>

/** Cache service response schemas */
export const CacheSetResponseSchema = z.object({
  success: z.boolean(),
})
export type CacheSetResponse = z.infer<typeof CacheSetResponseSchema>

export const CacheGetResponseSchema = z.object({
  value: z.string().nullable(),
})
export type CacheGetResponse = z.infer<typeof CacheGetResponseSchema>

export const CoinGeckoPriceResponseSchema = z.object({
  ethereum: z.object({
    usd: z.number(),
  }),
})
export type CoinGeckoPriceResponse = z.infer<
  typeof CoinGeckoPriceResponseSchema
>

/** GitHub user response */
export const GitHubUserResponseSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullable().nullable(),
  email: z.string().nullable().nullable(),
  avatar_url: z.string(),
})
export type GitHubUserResponse = z.infer<typeof GitHubUserResponseSchema>

export const GitHubAvatarResponseSchema = z.object({
  avatar_url: z.string(),
})
export type GitHubAvatarResponse = z.infer<typeof GitHubAvatarResponseSchema>

/** UniswapX API order response */
export const UniswapXOrderResponseSchema = z.object({
  orders: z.array(
    z.object({
      orderHash: z.string(),
      chainId: z.number(),
      swapper: z.string(),
      reactor: z.string(),
      deadline: z.number(),
      input: z.object({
        token: z.string(),
        startAmount: z.string(),
        endAmount: z.string(),
      }),
      outputs: z.array(
        z.object({
          token: z.string(),
          startAmount: z.string(),
          endAmount: z.string(),
          recipient: z.string(),
        }),
      ),
      decayStartTime: z.number(),
      decayEndTime: z.number(),
      exclusiveFiller: z.string().nullable(),
      exclusivityOverrideBps: z.number().nullable(),
      nonce: z.string(),
      encodedOrder: z.string(),
      signature: z.string(),
      createdAt: z.number(),
      orderStatus: z.string(),
    }),
  ),
})
export type UniswapXOrderResponse = z.infer<typeof UniswapXOrderResponseSchema>

export const CowAuctionHistoryResponseSchema = z.object({
  auctionId: z.number(),
  orders: z.array(
    z.object({
      uid: z.string(),
      sellToken: z.string(),
      buyToken: z.string(),
      sellAmount: z.string(),
      buyAmount: z.string(),
      kind: z.string(),
      partiallyFillable: z.boolean(),
    }),
  ),
  solutions: z.array(
    z.object({
      solver: z.string(),
      score: z.string(),
      ranking: z.number(),
      orders: z.array(
        z.object({
          id: z.string(),
          executedAmount: z.string(),
        }),
      ),
    }),
  ),
})
export type CowAuctionHistoryResponse = z.infer<
  typeof CowAuctionHistoryResponseSchema
>

export const DWSChatCompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
  usage: z
    .object({
      total_tokens: z.number(),
    })
    .nullable(),
})
export type DWSChatCompletionResponse = z.infer<
  typeof DWSChatCompletionResponseSchema
>

/** Git server repositories response */
export const GitRepositoriesResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      full_name: z.string(),
      owner: z.object({ login: z.string() }),
      description: z.string().nullable(),
      visibility: z.enum(['public', 'private', 'internal']),
      stargazers_count: z.number(),
      forks_count: z.number(),
      default_branch: z.string(),
      topics: z.array(z.string()),
      created_at: z.string(),
      updated_at: z.string(),
      pushed_at: z.string().nullable(),
      reputation_score: z.number(),
      verified: z.boolean(),
      head_cid: z.string(),
      storage_backend: z.string(),
    }),
  ),
})
export type GitRepositoriesResponse = z.infer<
  typeof GitRepositoriesResponseSchema
>

export const NPMSearchResponseSchema = z.object({
  objects: z.array(
    z.object({
      package: z.object({
        name: z.string(),
        version: z.string(),
        description: z.string().nullable(),
      }),
      score: z.object({
        final: z.number(),
      }),
    }),
  ),
})
export type NPMSearchResponse = z.infer<typeof NPMSearchResponseSchema>

export const GitOrganizationsResponseSchema = z.array(
  z.object({
    name: z.string(),
    displayName: z.string().nullable(),
    description: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    website: z.string().nullable(),
    memberCount: z.number(),
    repoCount: z.number(),
    createdAt: z.string(),
    verified: z.boolean().nullable(),
  }),
)
export type GitOrganizationsResponse = z.infer<
  typeof GitOrganizationsResponseSchema
>

export const GitOrgMembersResponseSchema = z.array(
  z.object({
    username: z.string(),
    role: z.enum(['owner', 'admin', 'member']),
    joinedAt: z.string(),
  }),
)
export type GitOrgMembersResponse = z.infer<typeof GitOrgMembersResponseSchema>

/** JSON-RPC response schema for proxy */
export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.union([z.number(), z.string()]),
  result: JsonValueSchema.nullable(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: JsonValueSchema.nullable(),
    })
    .nullable(),
})
export type JsonRpcResponseType = z.infer<typeof JsonRpcResponseSchema>

export const RateLimitInfoResponseSchema = z.object({
  tier: z.string(),
  limit: z.union([z.number(), z.string()]),
  remaining: z.union([z.number(), z.string()]),
  resetAt: z.number(),
})
export type RateLimitInfoResponse = z.infer<typeof RateLimitInfoResponseSchema>

// ============================================================================
// Validation Utilities (re-exported from @jejunetwork/types/validation)
// ============================================================================

export { baseExpectValid as expectValid }
export const validateOrThrow = baseExpectValid

export function expect<T>(
  value: unknown,
  schema: z.ZodType<T>,
  context?: string,
): T {
  return baseExpectValid(schema, value, context)
}

export const expectAddress = baseExpectAddress
export const expectChainId = baseExpectChainId

export function expectPositiveNumber(value: unknown, context?: string): string {
  const result = PositiveNumberStringSchema.safeParse(value)
  if (!result.success) {
    throw new Error(
      context
        ? `${context}: Invalid positive number ${value}`
        : `Invalid positive number: ${value}`,
    )
  }
  return result.data
}

export function validateQuery<T>(
  schema: z.ZodType<T>,
  query: Record<string, unknown>,
  context?: string,
): T {
  return validateOrThrow(schema, query, context)
}

/**
 * Validates request body
 */
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  context?: string,
): T {
  return validateOrThrow(schema, body, context)
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function toResponseData<T extends object>(data: T): JsonObject {
  return data as JsonObject
}
