/**
 * Zod schemas for API response validation
 *
 * All external API responses should be validated with these schemas
 * to ensure type safety at runtime.
 */

import type { JsonRecord, JsonValue } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { z } from 'zod'

/**
 * Parse and validate JSON string against a schema
 * Returns the validated data or throws
 */
export function parseJson<T>(
  json: string,
  schema: z.ZodType<T>,
  context?: string,
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Invalid JSON${context ? ` in ${context}` : ''}: ${message}`,
    )
  }
  return schema.parse(parsed)
}

/**
 * Parse and validate JSON string, returning null if invalid
 * Use for streaming where individual messages may be malformed
 */
export function safeParseJson<T>(json: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed: unknown = JSON.parse(json)
    const result = schema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Zod schema for JSON values - use instead of z.unknown() for JSON data
 */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

/**
 * Zod schema for JSON records (objects)
 */
export const JsonRecordSchema: z.ZodType<JsonRecord> = z.record(
  z.string(),
  JsonValueSchema,
)

/** Ethereum address schema */
export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address')
  .transform((val): Address => val as Address)

/** Transaction hash schema */
export const TxHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid tx hash')
  .transform((val): Hex => val as Hex)

/** Bigint string schema (for JSON APIs that return bigints as strings) */
export const BigIntStringSchema = z.string().transform((val) => BigInt(val))

/** Optional bigint string */
export const OptionalBigIntString = z
  .string()
  .optional()
  .transform((val) => (val ? BigInt(val) : undefined))

export const StorageStatsSchema = z.object({
  totalPins: z.number(),
  totalSizeBytes: z.number(),
  totalSizeGB: z.number(),
})

export const PinInfoSchema = z.object({
  cid: z.string(),
  name: z.string(),
  status: z.enum(['queued', 'pinning', 'pinned', 'failed']),
  sizeBytes: z.number(),
  createdAt: z.number(),
  tier: z.enum(['hot', 'warm', 'cold', 'permanent']),
})

export const UploadResultSchema = z.object({
  cid: z.string(),
  size: z.number(),
})

export const MultiBackendStorageStatsSchema = z.object({
  totalPins: z.number(),
  totalSizeBytes: z.number(),
  totalSizeGB: z.number(),
  byTier: z.object({
    system: z.object({ count: z.number(), size: z.number() }),
    popular: z.object({ count: z.number(), size: z.number() }),
    private: z.object({ count: z.number(), size: z.number() }),
  }),
  byBackend: z.record(
    z.string(),
    z.object({ count: z.number(), size: z.number() }),
  ),
})

export const ContentInfoSchema = z.object({
  cid: z.string(),
  name: z.string().optional(),
  size: z.number(),
  tier: z.enum(['system', 'popular', 'private']),
  category: z.enum([
    'app-bundle',
    'contract-abi',
    'user-content',
    'media',
    'data',
  ]),
  backends: z.array(z.enum(['webtorrent', 'ipfs', 'arweave', 'local'])),
  magnetUri: z.string().optional(),
  arweaveTxId: z.string().optional(),
  encrypted: z.boolean().optional(),
  createdAt: z.number(),
  accessCount: z.number(),
})

export const TorrentInfoSchema = z.object({
  magnetUri: z.string(),
  peers: z.number(),
  seeds: z.number(),
})

export const SwapQuoteResponseSchema = z.object({
  amountOut: z.string(),
  priceImpact: z.number(),
  route: z.array(AddressSchema),
  fee: z.string(),
})

export const TokenSchema = z.object({
  address: AddressSchema,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
})

export const PoolInfoResponseSchema = z.object({
  pools: z.array(
    z.object({
      poolId: TxHashSchema,
      token0: TokenSchema,
      token1: TokenSchema,
      fee: z.number(),
      liquidity: z.string(),
      sqrtPriceX96: z.string(),
      tick: z.number(),
    }),
  ),
})

export const PositionsResponseSchema = z.object({
  positions: z.array(
    z.object({
      positionId: z.string(),
      token0: AddressSchema,
      token1: AddressSchema,
      tickLower: z.number(),
      tickUpper: z.number(),
      liquidity: z.string(),
      feeGrowth0: z.string(),
      feeGrowth1: z.string(),
    }),
  ),
})

export const CrossChainQuoteResponseSchema = z.object({
  quotes: z.array(
    z.object({
      quoteId: z.string(),
      sourceChain: z.enum(['jeju', 'base', 'optimism', 'arbitrum', 'ethereum']),
      destinationChain: z.enum([
        'jeju',
        'base',
        'optimism',
        'arbitrum',
        'ethereum',
      ]),
      sourceToken: AddressSchema,
      destinationToken: AddressSchema,
      amountIn: z.string(),
      amountOut: z.string(),
      fee: z.string(),
      feePercent: z.number(),
      estimatedTimeSeconds: z.number(),
      route: z.enum(['eil', 'oif']),
      solver: AddressSchema.optional(),
      xlp: AddressSchema.optional(),
      validUntil: z.number(),
    }),
  ),
})

export const IntentStatusSchema = z.object({
  intentId: TxHashSchema,
  status: z.enum([
    'open',
    'pending',
    'filled',
    'expired',
    'cancelled',
    'failed',
  ]),
  solver: AddressSchema.optional(),
  fillTxHash: TxHashSchema.optional(),
  createdAt: z.number(),
  filledAt: z.number().optional(),
})

export const VoucherRequestResponseSchema = z.object({
  txData: TxHashSchema,
  to: AddressSchema,
  value: z.string(),
})

export const XLPInfoSchema = z.object({
  address: AddressSchema,
  stakedAmount: BigIntStringSchema,
  liquidity: z.record(z.string(), BigIntStringSchema),
  reputation: z.number(),
  successRate: z.number(),
  avgResponseMs: z.number(),
})

export const SolverInfoSchema = z.object({
  address: AddressSchema,
  name: z.string(),
  supportedChains: z.array(
    z.enum(['jeju', 'base', 'optimism', 'arbitrum', 'ethereum']),
  ),
  reputation: z.number(),
  successRate: z.number(),
  totalFills: z.number(),
  avgFillTimeMs: z.number(),
})

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  inputSchema: z
    .object({
      type: z.string(),
      properties: z.record(
        z.string(),
        z.object({
          type: z.string(),
          description: z.string().optional(),
          required: z.boolean().optional(),
        }),
      ),
      required: z.array(z.string()).optional(),
    })
    .optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  paymentRequired: z.boolean().optional(),
})

export const AgentCardSchema = z.object({
  protocolVersion: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  provider: z.object({
    organization: z.string(),
    url: z.string(),
  }),
  version: z.string(),
  capabilities: z.object({
    streaming: z.boolean(),
    pushNotifications: z.boolean(),
    stateTransitionHistory: z.boolean(),
  }),
  skills: z.array(AgentSkillSchema),
})

export const DiscoveredAgentSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  card: AgentCardSchema,
  jnsName: z.string().optional(),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    }),
  ),
})

export const A2AResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z
    .object({
      parts: z.array(
        z.object({
          kind: z.string(),
          text: z.string().optional(),
          data: JsonRecordSchema.optional(),
        }),
      ),
    })
    .optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: JsonValueSchema.optional(),
    })
    .optional(),
})

export const ProposalInfoSchema = z.object({
  proposalId: TxHashSchema,
  proposer: AddressSchema,
  proposerAgentId: BigIntStringSchema,
  type: z.number(),
  status: z.number(),
  qualityScore: z.number(),
  createdAt: z.number(),
  boardVoteEnd: z.number(),
  gracePeriodEnd: z.number(),
  contentHash: z.string(),
  targetContract: AddressSchema,
  callData: TxHashSchema,
  value: BigIntStringSchema,
  totalStaked: BigIntStringSchema,
  backerCount: z.number(),
  hasResearch: z.boolean(),
  directorApproved: z.boolean(),
})

export const DelegateInfoSchema = z.object({
  address: AddressSchema,
  agentId: BigIntStringSchema,
  name: z.string(),
  expertise: z.array(z.string()),
  totalDelegated: BigIntStringSchema,
  delegatorCount: z.number(),
  isActive: z.boolean(),
})

export const GovernanceStatsResponseSchema = z.object({
  totalProposals: z.number(),
  activeProposals: z.number(),
  executedProposals: z.number(),
  rejectedProposals: z.number(),
  totalStaked: z.string(),
  totalDelegated: z.string(),
})

export const AgentInfoSchema = z.object({
  agentId: BigIntStringSchema,
  owner: AddressSchema,
  name: z.string(),
  tags: z.array(z.string()),
  a2aEndpoint: z.string(),
  mcpEndpoint: z.string(),
  registeredAt: z.number(),
  lastActivityAt: z.number(),
  isBanned: z.boolean(),
})

export const ReputationScoreSchema = z.object({
  agentId: BigIntStringSchema,
  feedbackCount: z.number(),
  averageScore: z.number(),
  violationCount: z.number(),
  compositeScore: z.number(),
  tier: z.enum(['bronze', 'silver', 'gold', 'platinum']),
})

export const BanInfoSchema = z.object({
  agentId: BigIntStringSchema,
  isBanned: z.boolean(),
  bannedAt: z.number(),
  reason: z.string(),
  banType: z.enum(['network', 'app', 'category']),
})

export const PaymasterInfoResponseSchema = z.object({
  paymasters: z.array(
    z.object({
      address: AddressSchema,
      token: AddressSchema,
      tokenSymbol: z.string(),
      active: z.boolean(),
      entryPointBalance: z.string(),
      vaultLiquidity: z.string(),
      exchangeRate: z.string(),
    }),
  ),
})

export const PaymasterDetailSchema = z.object({
  vault: AddressSchema,
})

export const LPPositionSchema = z.object({
  ethShares: z.string(),
  tokenShares: z.string(),
})

export const StakingStatsResponseSchema = z.object({
  totalStakers: z.number(),
  currentAPY: z.number(),
})

export const NodeStakeInfoSchema = z.object({
  operator: AddressSchema,
  nodeType: z.number(),
  stake: BigIntStringSchema,
  minStake: BigIntStringSchema,
  isActive: z.boolean(),
  registeredAt: BigIntStringSchema,
  lastActivityAt: BigIntStringSchema,
  uptime: BigIntStringSchema,
  slashCount: z.number(),
})

export const TriggerSchema = z.object({
  triggerId: z.string(),
  type: z.enum(['cron', 'webhook', 'event', 'manual', 'chain_event']),
  name: z.string(),
  config: z.object({
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    webhookSecret: z.string().optional(),
    allowedOrigins: z.array(z.string()).optional(),
    contractAddress: AddressSchema.optional(),
    eventSignature: z.string().optional(),
    chainId: z.number().optional(),
    maxRetries: z.number().optional(),
    retryDelayMs: z.number().optional(),
  }),
  workflowId: z.string(),
  owner: AddressSchema,
  isActive: z.boolean(),
  createdAt: z.number(),
  lastTriggeredAt: z.number(),
  triggerCount: z.number(),
})

export const WorkflowStepSchema = z.object({
  stepId: z.string(),
  name: z.string(),
  type: z.enum(['compute', 'storage', 'contract', 'http', 'transform']),
  config: JsonRecordSchema,
  dependencies: z.array(z.string()),
  timeout: z.number(),
  retries: z.number(),
})

export const WorkflowSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  description: z.string(),
  owner: AddressSchema,
  status: z.enum(['active', 'paused', 'disabled']),
  steps: z.array(WorkflowStepSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
  totalExecutions: z.number(),
  successfulExecutions: z.number(),
})

export const JobSchema = z.object({
  jobId: z.string(),
  workflowId: z.string(),
  triggerId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  startedAt: z.number(),
  completedAt: z.number(),
  duration: z.number(),
  input: JsonRecordSchema,
  output: JsonRecordSchema,
  error: z.string().nullable(),
  logs: z.array(z.string()),
  stepResults: z.array(
    z.object({
      stepId: z.string(),
      status: z.enum([
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
      ]),
      startedAt: z.number(),
      completedAt: z.number(),
      output: JsonRecordSchema,
      error: z.string().nullable(),
    }),
  ),
})

export const DWSStatsSchema = z.object({
  totalWorkflows: z.number(),
  totalTriggers: z.number(),
  totalJobs: z.number(),
  successRate: z.number(),
  avgExecutionTime: z.number(),
})

export const WorkflowMetricsSchema = z.object({
  executions: z.number(),
  successRate: z.number(),
  avgDuration: z.number(),
  lastExecuted: z.number(),
})

export const NameInfoSchema = z.object({
  name: z.string(),
  owner: AddressSchema,
  resolver: AddressSchema,
  expiresAt: z.number(),
  registeredAt: z.number(),
})

export const NameRecordsSchema = z.object({
  address: AddressSchema.optional(),
  contentHash: z.string().optional(),
  text: z.record(z.string(), z.string()).optional(),
  a2aEndpoint: z.string().optional(),
  mcpEndpoint: z.string().optional(),
  avatar: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional(),
})

export const InferenceResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
})

export const AgentsListSchema = z.object({
  agents: z.array(DiscoveredAgentSchema),
})

export const RegisteredAppSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  jnsName: z.string().optional(),
  metadata: JsonRecordSchema.optional(),
})
export const AppsListResponseSchema = z.object({
  apps: z.array(RegisteredAppSchema),
})

export const ProposalsListSchema = z.object({
  proposals: z.array(ProposalInfoSchema),
})
export const DelegatesListSchema = z.object({
  delegates: z.array(DelegateInfoSchema),
})
export const NamesListSchema = z.object({ names: z.array(NameInfoSchema) })
export const ContentListSchema = z.object({
  items: z.array(ContentInfoSchema),
})
export const PinsListSchema = z.object({ results: z.array(PinInfoSchema) })
export const IntentsListSchema = z.object({
  intents: z.array(IntentStatusSchema),
})
export const XLPsListSchema = z.object({ xlps: z.array(XLPInfoSchema) })
export const SolversListSchema = z.object({
  solvers: z.array(SolverInfoSchema),
})
export const TriggersListSchema = z.object({
  triggers: z.array(TriggerSchema),
})
export const WorkflowsListSchema = z.object({
  workflows: z.array(WorkflowSchema),
})
export const JobsListSchema = z.object({ jobs: z.array(JobSchema) })
export const JobLogsSchema = z.object({ logs: z.array(z.string()) })
export const NodesListSchema = z.object({
  nodes: z.array(NodeStakeInfoSchema),
})

export const MailboxResponseSchema = z.object({
  mailbox: z.object({
    quotaUsedBytes: z.number(),
    quotaLimitBytes: z.number(),
    folders: z.array(z.string()),
  }),
  unreadCount: z.number(),
})

export const FolderContentsSchema = z.object({
  emails: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      subject: z.string(),
      preview: z.string().optional(),
      timestamp: z.number(),
      read: z.boolean(),
    }),
  ),
  total: z.number(),
  hasMore: z.boolean(),
})

export const EmailFlagsSchema = z.object({
  read: z.boolean(),
  starred: z.boolean(),
  important: z.boolean(),
  spam: z.boolean(),
})

export const EmailEnvelopeSchema = z.object({
  id: z.string(),
  from: z.object({ full: z.string() }),
  to: z.array(z.object({ full: z.string() })),
  timestamp: z.number(),
})

export const EmailContentSchema = z.object({
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string().optional(),
  attachments: z.array(
    z.object({
      filename: z.string(),
      mimeType: z.string(),
      size: z.number(),
      cid: z.string(),
    }),
  ),
})

export const EmailDetailResponseSchema = z.object({
  envelope: EmailEnvelopeSchema,
  content: EmailContentSchema,
  flags: EmailFlagsSchema,
})

export const SendEmailResponseSchema = z.object({
  messageId: z.string(),
})

export const SendEmailErrorSchema = z.object({
  error: z.string(),
})

export const EmailSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.array(z.string()),
      subject: z.string(),
      preview: z.string().optional(),
      timestamp: z.number(),
      hasAttachment: z.boolean().optional(),
    }),
  ),
  total: z.number(),
  hasMore: z.boolean(),
})

export const FilterRulesResponseSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      conditions: z.array(
        z.object({
          field: z.string(),
          operator: z.string(),
          value: z.string(),
        }),
      ),
      actions: z.array(
        z.object({
          type: z.string(),
          value: z.string().optional(),
        }),
      ),
      enabled: z.boolean(),
    }),
  ),
})

export const WebSocketEmailEventSchema = z.object({
  type: z.string(),
  data: z.object({
    id: z.string().optional(),
    from: z.string().optional(),
    to: z.union([z.string(), z.array(z.string())]).optional(),
    subject: z.string().optional(),
    timestamp: z.number().optional(),
  }),
})

export const MCPServerSchema = z.object({
  name: z.string(),
  version: z.string(),
  protocolVersion: z.string(),
  capabilities: z.object({
    tools: z.boolean().optional(),
    resources: z.boolean().optional(),
    prompts: z.boolean().optional(),
    sampling: z.boolean().optional(),
  }),
  instructions: z.string().optional(),
})

export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(
      z.string(),
      z.object({
        type: z.string(),
        description: z.string().optional(),
        enum: z.array(z.string()).optional(),
        default: JsonValueSchema.optional(),
      }),
    ),
    required: z.array(z.string()).optional(),
  }),
})

export const MCPResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
})

export const MCPPromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
})

export const MCPToolResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.enum(['text', 'image', 'resource']),
      text: z.string().optional(),
      data: z.string().optional(),
      mimeType: z.string().optional(),
      uri: z.string().optional(),
    }),
  ),
  isError: z.boolean().optional(),
})

export const MCPResourceContentSchema = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
})

export const MCPPromptMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.object({
    type: z.enum(['text', 'image', 'resource']),
    text: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
  }),
})

export const MCPJsonRpcResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: JsonValueSchema.optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: JsonValueSchema.optional(),
    })
    .optional(),
})

export const MCPToolsListResponseSchema = z.object({
  tools: z.array(MCPToolSchema),
})

export const MCPResourcesListResponseSchema = z.object({
  resources: z.array(MCPResourceSchema),
})

export const MCPResourcesReadResponseSchema = z.object({
  contents: z.array(MCPResourceContentSchema),
})

export const MCPPromptsListResponseSchema = z.object({
  prompts: z.array(MCPPromptSchema),
})

export const MCPPromptGetResponseSchema = z.object({
  description: z.string().optional(),
  messages: z.array(MCPPromptMessageSchema),
})

export const NFTInfoResponseSchema = z.object({
  assetType: z.enum(['ERC721', 'ERC1155']),
  collection: AddressSchema,
  tokenId: z.string(),
  amount: z.string(),
  tokenURI: z.string(),
  owner: AddressSchema,
  royaltyReceiver: AddressSchema.optional(),
  royaltyBps: z.number().optional(),
})

export const ProvenanceEntrySchema = z.object({
  chainId: z.number(),
  blockNumber: z.string(),
  timestamp: z.string(),
  from: AddressSchema,
  to: AddressSchema,
  txHash: TxHashSchema,
})

export const ProvenanceResponseSchema = z.object({
  provenance: z.array(ProvenanceEntrySchema),
})

export const WrappedNFTInfoResponseSchema = z.object({
  isWrapped: z.boolean(),
  homeChainId: z.number(),
  originalCollection: AddressSchema,
  originalTokenId: z.string(),
  wrappedAt: z.string(),
  provenance: z.array(ProvenanceEntrySchema),
})

export const NFTBridgeQuoteSchema = z.object({
  quoteId: z.string(),
  sourceChain: z.enum(['jeju', 'base', 'optimism', 'arbitrum', 'ethereum']),
  destinationChain: z.enum([
    'jeju',
    'base',
    'optimism',
    'arbitrum',
    'ethereum',
  ]),
  collection: AddressSchema,
  tokenId: z.string(),
  amount: z.string(),
  gasFee: z.string(),
  xlpFee: z.string().optional(),
  estimatedTimeSeconds: z.number(),
  route: z.enum(['hyperlane', 'eil', 'oif']),
  xlp: AddressSchema.optional(),
  solver: AddressSchema.optional(),
  validUntil: z.number(),
})

export const NFTBridgeQuotesResponseSchema = z.object({
  quotes: z.array(NFTBridgeQuoteSchema),
})

export const NFTTransferStatusSchema = z.object({
  id: TxHashSchema,
  status: z.enum(['pending', 'bridging', 'delivered', 'failed', 'refunded']),
  route: z.enum(['hyperlane', 'eil', 'oif']),
  sourceChain: z.enum(['jeju', 'base', 'optimism', 'arbitrum', 'ethereum']),
  destinationChain: z.enum([
    'jeju',
    'base',
    'optimism',
    'arbitrum',
    'ethereum',
  ]),
  collection: AddressSchema,
  tokenId: z.coerce.bigint(),
  sourceTxHash: TxHashSchema.optional(),
  destinationTxHash: TxHashSchema.optional(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
})

export const NFTTransfersListSchema = z.object({
  transfers: z.array(NFTTransferStatusSchema),
})

export const NFTApprovalResponseSchema = z.object({
  approved: z.boolean(),
})

export const NFTNonceResponseSchema = z.object({
  nonce: z.string(),
})

export const A2AStreamMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(
    z.object({
      kind: z.enum(['text', 'data']),
      text: z.string().optional(),
      data: JsonRecordSchema.optional(),
    }),
  ),
  messageId: z.string(),
})

export const JNSRecordsResponseSchema = z.object({
  a2aEndpoint: z.string().optional(),
  mcpEndpoint: z.string().optional(),
  address: AddressSchema.optional(),
})

export const KMSEncryptResponseSchema = z.object({
  ciphertext: z.string(),
  keyId: z.string(),
})

export const KMSDecryptResponseSchema = z.object({
  plaintext: z.string(),
})

export const MultiBackendUploadResultSchema = z.object({
  cid: z.string(),
  size: z.number(),
  tier: z.enum(['system', 'popular', 'private']),
  backends: z.array(z.enum(['webtorrent', 'ipfs', 'arweave', 'local'])),
  gatewayUrl: z.string().optional(),
  magnetUri: z.string().optional(),
  arweaveTxId: z.string().optional(),
  encrypted: z.boolean().optional(),
  encryptionKeyId: z.string().optional(),
})

/** Package maintainer schema */
export const PackageMaintainerSchema = z.object({
  name: z.string(),
})

/** Package repository schema */
export const PackageRepositorySchema = z.object({
  type: z.string(),
  url: z.string(),
})

/** Package version info schema */
export const PackageVersionInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  main: z.string().optional(),
  types: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  dist: z.object({
    shasum: z.string(),
    tarball: z.string(),
    integrity: z.string().optional(),
    fileCount: z.number().optional(),
    unpackedSize: z.number().optional(),
  }),
  publishedAt: z.string().optional(),
  publishedBy: z.string().optional(),
})

/** NPM registry manifest response schema */
export const PackageManifestResponseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  'dist-tags': z.record(z.string(), z.string()),
  versions: z.record(z.string(), PackageVersionInfoSchema),
  maintainers: z.array(PackageMaintainerSchema).optional(),
  license: z.string().optional(),
  repository: PackageRepositorySchema.optional(),
  keywords: z.array(z.string()).optional(),
  time: z.record(z.string(), z.string()).optional(),
})

/** NPM search response schema */
export const PackageSearchResponseSchema = z.object({
  objects: z.array(
    z.object({
      package: z.object({
        name: z.string(),
        version: z.string(),
        description: z.string().optional(),
        links: z.object({ npm: z.string() }),
      }),
      score: z.object({
        final: z.number(),
        detail: z.object({
          quality: z.number(),
          popularity: z.number(),
          maintenance: z.number(),
        }),
      }),
    }),
  ),
  total: z.number(),
})

/** Package publish response schema */
export const PackagePublishResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string(),
  rev: z.string(),
})

/** Package publish error response schema */
export const PackageErrorResponseSchema = z.object({
  error: z.string().optional(),
})

/** Publisher info schema */
export const PublisherInfoSchema = z.object({
  address: z.string(),
  username: z.string().optional(),
  jnsName: z.string().optional(),
  packages: z.array(z.string()),
  totalDownloads: z.number(),
  totalPublishes: z.number(),
  reputationScore: z.number(),
  verified: z.boolean(),
  createdAt: z.string(),
})

/** Login response schema */
export const LoginResponseSchema = z.object({
  token: z.string(),
})

/** Whoami response schema */
export const WhoamiResponseSchema = z.object({
  username: z.string(),
})

/** Sync response schema */
export const SyncResponseSchema = z.object({
  synced: z.number(),
})

/** Health check response schema */
export const HealthCheckResponseSchema = z.object({
  status: z.string(),
  service: z.string(),
})

/** Git repository schema */
export const GitRepositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string(),
  owner: z.string(),
  description: z.string().optional(),
  visibility: z.enum(['public', 'private', 'internal']),
  defaultBranch: z.string(),
  cloneUrl: z.string(),
  starCount: z.number(),
  forkCount: z.number(),
  topics: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  pushedAt: z.string().optional(),
  reputationScore: z.number().optional(),
  boardProposalId: z.string().optional(),
  verified: z.boolean(),
  headCid: z.string(),
})

/** Git repository list response schema */
export const GitRepositoryListResponseSchema = z.object({
  repositories: z.array(GitRepositorySchema),
  total: z.number(),
})

/** Git search response schema */
export const GitSearchResponseSchema = z.object({
  total_count: z.number(),
  items: z.array(GitRepositorySchema),
})

/** Git branch schema */
export const GitBranchSchema = z.object({
  name: z.string(),
  sha: z.string(),
  protected: z.boolean(),
})

/** Git tag schema */
export const GitTagSchema = z.object({
  name: z.string(),
  sha: z.string(),
})

/** Git issue comment schema */
export const GitIssueCommentSchema = z.object({
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
})

/** Git issue schema */
export const GitIssueSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  body: z.string(),
  state: z.enum(['open', 'closed']),
  author: z.string(),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  comments: z.array(GitIssueCommentSchema),
})

/** Git pull request schema */
export const GitPullRequestSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  body: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  author: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  reviewers: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  mergedAt: z.string().optional(),
  mergedBy: z.string().optional(),
})

/** Git user schema */
export const GitUserSchema = z.object({
  login: z.string(),
  address: z.string(),
  jnsName: z.string().optional(),
  publicRepos: z.number(),
  reputationScore: z.number(),
  createdAt: z.string(),
})

/** JNS resolve response schema */
export const JNSResolveResponseSchema = z.object({
  address: AddressSchema,
})

/** JNS reverse resolve response schema */
export const JNSReverseResolveResponseSchema = z.object({
  name: z.string(),
})

/** JNS names list response schema */
export const JNSNamesListResponseSchema = z.object({
  names: z.array(NameInfoSchema),
})

/** JNS availability response schema */
export const JNSAvailabilityResponseSchema = z.object({
  available: z.boolean(),
})

/** JNS price response schema */
export const JNSPriceResponseSchema = z.object({
  price: z.string(),
})

/** Governance IPFS upload response schema */
export const GovernanceIPFSUploadResponseSchema = z.object({
  cid: z.string(),
})

/** Governance voting power response schema */
export const GovernanceVotingPowerResponseSchema = z.object({
  power: z.string(),
})

/** Governance stats response schema (raw from API) */
export const GovernanceStatsRawResponseSchema = z.object({
  totalProposals: z.number(),
  activeProposals: z.number(),
  executedProposals: z.number(),
  rejectedProposals: z.number(),
  totalStaked: z.string(),
  totalDelegated: z.string(),
})

/** Cross-chain quote raw response schema */
export const CrossChainQuoteRawSchema = z.object({
  quoteId: z.string(),
  sourceChain: z.enum(['jeju', 'base', 'optimism', 'arbitrum', 'ethereum']),
  destinationChain: z.enum([
    'jeju',
    'base',
    'optimism',
    'arbitrum',
    'ethereum',
  ]),
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,
  amountIn: z.string(),
  amountOut: z.string(),
  fee: z.string(),
  feePercent: z.number(),
  estimatedTimeSeconds: z.number(),
  route: z.enum(['eil', 'oif']),
  solver: AddressSchema.optional(),
  xlp: AddressSchema.optional(),
  validUntil: z.number(),
})

/** Cross-chain quotes response schema */
export const CrossChainQuotesResponseSchema = z.object({
  quotes: z.array(CrossChainQuoteRawSchema),
})

/** EIL voucher request response schema */
export const EILVoucherResponseSchema = z.object({
  txData: TxHashSchema,
  to: AddressSchema,
  value: z.string(),
})

/** Intent creation response schema */
export const IntentCreationResponseSchema = z.object({
  txData: TxHashSchema,
  to: AddressSchema,
  value: z.string(),
})

/** Cancel intent response schema */
export const CancelIntentResponseSchema = z.object({
  txData: TxHashSchema,
  to: AddressSchema,
})

/** VPN A2A result schema */
export const VPNA2AResultSchema = z.object({
  jsonrpc: z.string(),
  result: z
    .object({
      parts: z.array(
        z.object({
          kind: z.string(),
          data: JsonValueSchema.optional(),
        }),
      ),
    })
    .optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

/** Dataset upload response schema */
export const DatasetUploadResponseSchema = z.object({
  txHash: TxHashSchema,
  datasetId: TxHashSchema,
})

/** RPC eth_getCode response schema */
export const RPCGetCodeResponseSchema = z.object({
  result: z.string().optional(),
})

/** Feed user schema */
export const FeedUserSchema = z.object({
  fid: z.number(),
  username: z.string(),
  displayName: z.string(),
  pfpUrl: z.string().optional(),
  bio: z.string().optional(),
  followerCount: z.number(),
  followingCount: z.number(),
  address: AddressSchema.optional(),
  verifiedAddresses: z.array(AddressSchema).optional(),
  isFollowing: z.boolean().optional(),
  isFollowedBy: z.boolean().optional(),
})

/** Feed channel schema */
export const FeedChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  leadFid: z.number(),
  followerCount: z.number(),
  createdAt: z.string(),
  isFollowing: z.boolean().optional(),
})

/** Feed post embed metadata schema */
export const FeedPostEmbedMetadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
})

/** Feed post embed schema */
export const FeedPostEmbedSchema = z.object({
  url: z.string().optional(),
  metadata: FeedPostEmbedMetadataSchema.optional(),
})

/** Feed post reactions schema */
export const FeedPostReactionsSchema = z.object({
  liked: z.boolean(),
  recasted: z.boolean(),
})

/** Feed post schema */
export const FeedPostSchema = z.object({
  id: z.string(),
  hash: z.string(),
  author: FeedUserSchema,
  content: z.string(),
  embeds: z.array(FeedPostEmbedSchema).optional(),
  channel: FeedChannelSchema.optional(),
  timestamp: z.string(),
  likes: z.number(),
  recasts: z.number(),
  replies: z.number(),
  parentHash: z.string().optional(),
  rootHash: z.string().optional(),
  reactions: FeedPostReactionsSchema,
})

/** Feed posts list response schema */
export const FeedPostsListResponseSchema = z.object({
  posts: z.array(FeedPostSchema),
  nextCursor: z.string().optional(),
})

/** Feed users list response schema */
export const FeedUsersListResponseSchema = z.object({
  users: z.array(FeedUserSchema),
  nextCursor: z.string().optional(),
})

/** Feed channels list response schema */
export const FeedChannelsListResponseSchema = z.object({
  channels: z.array(FeedChannelSchema),
  nextCursor: z.string().optional(),
})

/** Feed notification schema */
export const FeedNotificationSchema = z.object({
  id: z.string(),
  type: z.enum(['like', 'recast', 'reply', 'follow', 'mention']),
  actor: FeedUserSchema,
  post: FeedPostSchema.optional(),
  timestamp: z.string(),
  isRead: z.boolean(),
})

/** Feed notifications response schema */
export const FeedNotificationsResponseSchema = z.object({
  notifications: z.array(FeedNotificationSchema),
  nextCursor: z.string().optional(),
})

/** Feed linked FID response schema */
export const FeedLinkedFidResponseSchema = z.object({
  fid: z.number().nullable(),
})

/** CICD job step schema */
export const CICDJobStepSchema = z.object({
  name: z.string(),
  status: z.enum([
    'pending',
    'queued',
    'running',
    'success',
    'failed',
    'cancelled',
  ]),
  duration: z.number().optional(),
  output: z.string().optional(),
})

/** CICD artifact schema */
export const CICDArtifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  downloadUrl: z.string(),
  expiresAt: z.string(),
})

/** CICD workflow job schema */
export const CICDWorkflowJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum([
    'pending',
    'queued',
    'running',
    'success',
    'failed',
    'cancelled',
  ]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  duration: z.number().optional(),
  steps: z.array(CICDJobStepSchema),
  logs: z.string().optional(),
})

/** CICD workflow schema */
export const CICDWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  repoId: z.string(),
  repoName: z.string(),
  branch: z.string(),
  trigger: z.enum(['push', 'pull_request', 'manual', 'schedule', 'tag']),
  configPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  isActive: z.boolean(),
})

/** CICD workflow run schema */
export const CICDWorkflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
  repoName: z.string(),
  branch: z.string(),
  commitSha: z.string(),
  commitMessage: z.string().optional(),
  status: z.enum([
    'pending',
    'queued',
    'running',
    'success',
    'failed',
    'cancelled',
  ]),
  triggeredBy: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  duration: z.number().optional(),
  jobs: z.array(CICDWorkflowJobSchema),
  artifacts: z.array(CICDArtifactSchema).optional(),
})

/** CICD deployment schema */
export const CICDDeploymentSchema = z.object({
  id: z.string(),
  environment: z.enum(['staging', 'production']),
  repoName: z.string(),
  branch: z.string(),
  commitSha: z.string(),
  status: z.enum([
    'pending',
    'in_progress',
    'success',
    'failed',
    'rolled_back',
  ]),
  deployedBy: z.string(),
  deployedAt: z.string(),
  url: z.string().optional(),
  version: z.string().optional(),
  previousDeploymentId: z.string().optional(),
})

/** CICD release schema */
export const CICDReleaseSchema = z.object({
  id: z.string(),
  tag: z.string(),
  name: z.string(),
  createdAt: z.string(),
  prerelease: z.boolean(),
})

/** CICD release create response schema */
export const CICDReleaseCreateResponseSchema = z.object({
  releaseId: z.string(),
  deploymentId: z.string().optional(),
})

/** CICD queue status schema */
export const CICDQueueStatusSchema = z.object({
  pending: z.number(),
  running: z.number(),
  queued: z.number(),
  runners: z.number(),
  availableRunners: z.number(),
})

/** DWS trigger creation response schema */
export const DWSCreateTriggerResponseSchema = z.object({
  triggerId: z.string(),
})

/** DWS workflow creation response schema */
export const DWSCreateWorkflowResponseSchema = z.object({
  workflowId: z.string(),
})

/** DWS job creation response schema */
export const DWSJobResponseSchema = z.object({
  jobId: z.string(),
})
