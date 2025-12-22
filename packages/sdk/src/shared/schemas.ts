/**
 * Zod schemas for API response validation
 *
 * All external API responses should be validated with these schemas
 * to ensure type safety at runtime.
 */

import { z } from "zod";
import type { JsonValue, JsonRecord } from "./types";

// ============================================================================
// JSON Value Schema
// ============================================================================

/**
 * Zod schema for JSON values - use instead of z.unknown() for JSON data
 */
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

/**
 * Zod schema for JSON records (objects)
 */
export const JsonRecordSchema: z.ZodType<JsonRecord> = z.record(z.string(), JsonValueSchema);

// ============================================================================
// Common Schemas
// ============================================================================

/** Ethereum address schema */
export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address");

/** Transaction hash schema */
export const TxHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid tx hash");

/** Bigint string schema (for JSON APIs that return bigints as strings) */
export const BigIntStringSchema = z.string().transform((val) => BigInt(val));

/** Optional bigint string */
export const OptionalBigIntString = z.string().optional().transform((val) => val ? BigInt(val) : undefined);

// ============================================================================
// Storage API Schemas
// ============================================================================

export const StorageStatsSchema = z.object({
  totalPins: z.number(),
  totalSizeBytes: z.number(),
  totalSizeGB: z.number(),
});

export const PinInfoSchema = z.object({
  cid: z.string(),
  name: z.string(),
  status: z.enum(["queued", "pinning", "pinned", "failed"]),
  sizeBytes: z.number(),
  createdAt: z.number(),
  tier: z.enum(["hot", "warm", "cold", "permanent"]),
});

export const UploadResultSchema = z.object({
  cid: z.string(),
  size: z.number(),
});

export const EnhancedStorageStatsSchema = z.object({
  totalPins: z.number(),
  totalSizeBytes: z.number(),
  totalSizeGB: z.number(),
  byTier: z.object({
    system: z.object({ count: z.number(), size: z.number() }),
    popular: z.object({ count: z.number(), size: z.number() }),
    private: z.object({ count: z.number(), size: z.number() }),
  }),
  byBackend: z.record(z.string(), z.object({ count: z.number(), size: z.number() })),
});

export const ContentInfoSchema = z.object({
  cid: z.string(),
  name: z.string().optional(),
  size: z.number(),
  tier: z.enum(["system", "popular", "private"]),
  category: z.enum(["app-bundle", "contract-abi", "user-content", "media", "data"]),
  backends: z.array(z.enum(["webtorrent", "ipfs", "arweave", "local"])),
  magnetUri: z.string().optional(),
  arweaveTxId: z.string().optional(),
  encrypted: z.boolean().optional(),
  createdAt: z.number(),
  accessCount: z.number(),
});

export const TorrentInfoSchema = z.object({
  magnetUri: z.string(),
  peers: z.number(),
  seeds: z.number(),
});

// ============================================================================
// DeFi API Schemas
// ============================================================================

export const SwapQuoteResponseSchema = z.object({
  amountOut: z.string(),
  priceImpact: z.number(),
  route: z.array(AddressSchema),
  fee: z.string(),
});

export const TokenSchema = z.object({
  address: AddressSchema,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
});

export const PoolInfoResponseSchema = z.object({
  pools: z.array(z.object({
    poolId: TxHashSchema,
    token0: TokenSchema,
    token1: TokenSchema,
    fee: z.number(),
    liquidity: z.string(),
    sqrtPriceX96: z.string(),
    tick: z.number(),
  })),
});

export const PositionsResponseSchema = z.object({
  positions: z.array(z.object({
    positionId: z.string(),
    token0: AddressSchema,
    token1: AddressSchema,
    tickLower: z.number(),
    tickUpper: z.number(),
    liquidity: z.string(),
    feeGrowth0: z.string(),
    feeGrowth1: z.string(),
  })),
});

// ============================================================================
// Cross-chain API Schemas
// ============================================================================

export const CrossChainQuoteResponseSchema = z.object({
  quotes: z.array(z.object({
    quoteId: z.string(),
    sourceChain: z.enum(["jeju", "base", "optimism", "arbitrum", "ethereum"]),
    destinationChain: z.enum(["jeju", "base", "optimism", "arbitrum", "ethereum"]),
    sourceToken: AddressSchema,
    destinationToken: AddressSchema,
    amountIn: z.string(),
    amountOut: z.string(),
    fee: z.string(),
    feePercent: z.number(),
    estimatedTimeSeconds: z.number(),
    route: z.enum(["eil", "oif"]),
    solver: AddressSchema.optional(),
    xlp: AddressSchema.optional(),
    validUntil: z.number(),
  })),
});

export const IntentStatusSchema = z.object({
  intentId: TxHashSchema,
  status: z.enum(["open", "pending", "filled", "expired", "cancelled", "failed"]),
  solver: AddressSchema.optional(),
  fillTxHash: TxHashSchema.optional(),
  createdAt: z.number(),
  filledAt: z.number().optional(),
});

export const VoucherRequestResponseSchema = z.object({
  txData: TxHashSchema,
  to: AddressSchema,
  value: z.string(),
});

export const XLPInfoSchema = z.object({
  address: AddressSchema,
  stakedAmount: BigIntStringSchema,
  liquidity: z.record(z.string(), BigIntStringSchema),
  reputation: z.number(),
  successRate: z.number(),
  avgResponseMs: z.number(),
});

export const SolverInfoSchema = z.object({
  address: AddressSchema,
  name: z.string(),
  supportedChains: z.array(z.enum(["jeju", "base", "optimism", "arbitrum", "ethereum"])),
  reputation: z.number(),
  successRate: z.number(),
  totalFills: z.number(),
  avgFillTimeMs: z.number(),
});

// ============================================================================
// A2A API Schemas
// ============================================================================

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  inputSchema: z.object({
    type: z.string(),
    properties: z.record(z.string(), z.object({
      type: z.string(),
      description: z.string().optional(),
      required: z.boolean().optional(),
    })),
    required: z.array(z.string()).optional(),
  }).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  paymentRequired: z.boolean().optional(),
});

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
});

export const DiscoveredAgentSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  card: AgentCardSchema,
  jnsName: z.string().optional(),
  skills: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
  })),
});

export const A2AResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.object({
    parts: z.array(z.object({
      kind: z.string(),
      text: z.string().optional(),
      data: JsonRecordSchema.optional(),
    })),
  }).optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: JsonValueSchema.optional(),
  }).optional(),
});

// ============================================================================
// Governance API Schemas
// ============================================================================

export const ProposalInfoSchema = z.object({
  proposalId: TxHashSchema,
  proposer: AddressSchema,
  proposerAgentId: BigIntStringSchema,
  type: z.number(),
  status: z.number(),
  qualityScore: z.number(),
  createdAt: z.number(),
  councilVoteEnd: z.number(),
  gracePeriodEnd: z.number(),
  contentHash: z.string(),
  targetContract: AddressSchema,
  callData: TxHashSchema,
  value: BigIntStringSchema,
  totalStaked: BigIntStringSchema,
  backerCount: z.number(),
  hasResearch: z.boolean(),
  ceoApproved: z.boolean(),
});

export const DelegateInfoSchema = z.object({
  address: AddressSchema,
  agentId: BigIntStringSchema,
  name: z.string(),
  expertise: z.array(z.string()),
  totalDelegated: BigIntStringSchema,
  delegatorCount: z.number(),
  isActive: z.boolean(),
});

export const GovernanceStatsResponseSchema = z.object({
  totalProposals: z.number(),
  activeProposals: z.number(),
  executedProposals: z.number(),
  rejectedProposals: z.number(),
  totalStaked: z.string(),
  totalDelegated: z.string(),
});

// ============================================================================
// Identity API Schemas
// ============================================================================

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
});

export const ReputationScoreSchema = z.object({
  agentId: BigIntStringSchema,
  feedbackCount: z.number(),
  averageScore: z.number(),
  violationCount: z.number(),
  compositeScore: z.number(),
  tier: z.enum(["bronze", "silver", "gold", "platinum"]),
});

export const BanInfoSchema = z.object({
  agentId: BigIntStringSchema,
  isBanned: z.boolean(),
  bannedAt: z.number(),
  reason: z.string(),
  banType: z.enum(["network", "app", "category"]),
});

// ============================================================================
// Payments API Schemas
// ============================================================================

export const PaymasterInfoResponseSchema = z.object({
  paymasters: z.array(z.object({
    address: AddressSchema,
    token: AddressSchema,
    tokenSymbol: z.string(),
    active: z.boolean(),
    entryPointBalance: z.string(),
    vaultLiquidity: z.string(),
    exchangeRate: z.string(),
  })),
});

export const PaymasterDetailSchema = z.object({
  vault: AddressSchema,
});

export const LPPositionSchema = z.object({
  ethShares: z.string(),
  tokenShares: z.string(),
});

// ============================================================================
// Staking API Schemas
// ============================================================================

export const StakingStatsResponseSchema = z.object({
  totalStakers: z.number(),
  currentAPY: z.number(),
});

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
});

// ============================================================================
// DWS API Schemas
// ============================================================================

export const TriggerSchema = z.object({
  triggerId: z.string(),
  type: z.enum(["cron", "webhook", "event", "manual", "chain_event"]),
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
});

export const WorkflowStepSchema = z.object({
  stepId: z.string(),
  name: z.string(),
  type: z.enum(["compute", "storage", "contract", "http", "transform"]),
  config: JsonRecordSchema,
  dependencies: z.array(z.string()),
  timeout: z.number(),
  retries: z.number(),
});

export const WorkflowSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  description: z.string(),
  owner: AddressSchema,
  status: z.enum(["active", "paused", "disabled"]),
  steps: z.array(WorkflowStepSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
  totalExecutions: z.number(),
  successfulExecutions: z.number(),
});

export const JobSchema = z.object({
  jobId: z.string(),
  workflowId: z.string(),
  triggerId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  startedAt: z.number(),
  completedAt: z.number(),
  duration: z.number(),
  input: JsonRecordSchema,
  output: JsonRecordSchema,
  error: z.string().nullable(),
  logs: z.array(z.string()),
  stepResults: z.array(z.object({
    stepId: z.string(),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
    startedAt: z.number(),
    completedAt: z.number(),
    output: JsonRecordSchema,
    error: z.string().nullable(),
  })),
});

export const DWSStatsSchema = z.object({
  totalWorkflows: z.number(),
  totalTriggers: z.number(),
  totalJobs: z.number(),
  successRate: z.number(),
  avgExecutionTime: z.number(),
});

export const WorkflowMetricsSchema = z.object({
  executions: z.number(),
  successRate: z.number(),
  avgDuration: z.number(),
  lastExecuted: z.number(),
});

// ============================================================================
// Names API Schemas
// ============================================================================

export const NameInfoSchema = z.object({
  name: z.string(),
  owner: AddressSchema,
  resolver: AddressSchema,
  expiresAt: z.number(),
  registeredAt: z.number(),
});

export const NameRecordsSchema = z.object({
  address: AddressSchema.optional(),
  contentHash: z.string().optional(),
  text: z.record(z.string(), z.string()).optional(),
  a2aEndpoint: z.string().optional(),
  mcpEndpoint: z.string().optional(),
  avatar: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional(),
});

// ============================================================================
// Inference API Schemas
// ============================================================================

export const InferenceResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(z.object({
    message: z.object({
      content: z.string(),
    }),
  })),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

// ============================================================================
// List Response Wrappers
// ============================================================================

export const AgentsListSchema = z.object({ agents: z.array(DiscoveredAgentSchema) });
export const ProposalsListSchema = z.object({ proposals: z.array(ProposalInfoSchema) });
export const DelegatesListSchema = z.object({ delegates: z.array(DelegateInfoSchema) });
export const NamesListSchema = z.object({ names: z.array(NameInfoSchema) });
export const ContentListSchema = z.object({ items: z.array(ContentInfoSchema) });
export const PinsListSchema = z.object({ results: z.array(PinInfoSchema) });
export const IntentsListSchema = z.object({ intents: z.array(IntentStatusSchema) });
export const XLPsListSchema = z.object({ xlps: z.array(XLPInfoSchema) });
export const SolversListSchema = z.object({ solvers: z.array(SolverInfoSchema) });
export const TriggersListSchema = z.object({ triggers: z.array(TriggerSchema) });
export const WorkflowsListSchema = z.object({ workflows: z.array(WorkflowSchema) });
export const JobsListSchema = z.object({ jobs: z.array(JobSchema) });
export const JobLogsSchema = z.object({ logs: z.array(z.string()) });
export const NodesListSchema = z.object({ nodes: z.array(NodeStakeInfoSchema) });
