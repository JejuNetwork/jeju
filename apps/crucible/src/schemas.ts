/**
 * Zod Schemas for Crucible API Validation
 *
 * Comprehensive validation schemas for all API endpoints, request/response types,
 * and internal data structures. All schemas use strict validation with fail-fast patterns.
 */

import { isAddress } from 'viem'
import { z } from 'zod'

const AddressSchema = z
  .string()
  .refine(isAddress, { error: 'Invalid Ethereum address' })
  .transform((val) => val as `0x${string}`)

/** Schema for JSON primitive values */
const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

/** Recursive schema for JSON values - use z.lazy for recursive types */
export const JsonValueSchema: z.ZodType<import('./types').JsonValue> = z.lazy(
  () =>
    z.union([
      JsonPrimitiveSchema,
      z.array(JsonValueSchema),
      z.record(z.string(), JsonValueSchema),
    ]),
)

/** Schema for JSON objects */
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema)

export const TradingBotStrategyTypeSchema = z.enum([
  'DEX_ARBITRAGE',
  'CROSS_CHAIN_ARBITRAGE',
  'SANDWICH',
  'LIQUIDATION',
  'SOLVER',
  'ORACLE_KEEPER',
])

export const TradingBotStrategySchema = z
  .object({
    type: TradingBotStrategyTypeSchema,
    enabled: z.boolean(),
    minProfitBps: z.number().int().min(0).max(10000),
    maxGasGwei: z.number().int().min(1).max(10000),
    maxSlippageBps: z.number().int().min(0).max(10000),
    cooldownMs: z.number().int().min(0).nullish(),
  })
  .strict()

export const TradingBotChainSchema = z
  .object({
    chainId: z.number().int().min(1),
    name: z.string().min(1),
    rpcUrl: z.string().url(),
    wsUrl: z.string().url().nullish(),
    blockTime: z.number().int().min(1).max(60000),
    isL2: z.boolean(),
    nativeSymbol: z.string().min(1),
    explorerUrl: z.string().url().nullish(),
  })
  .strict()

/** Schema for action parameters */
export const ActionParamsSchema = z
  .object({
    content: z.string().nullable(),
    target: z.string().nullable(),
    amount: z.string().nullable(),
  })
  .catchall(JsonValueSchema)

/** Schema for action result - union of possible result types */
export const ActionResultSchema = z.union([
  z.string(), // Transaction hash
  z.object({ txHash: z.string(), success: z.boolean().nullable() }).strict(),
  z.object({ success: z.boolean(), error: z.string().nullable() }).strict(),
  JsonObjectSchema, // Complex structured result
])

// Forward declare AgentActionSchema for use in StateUpdatesSchema
const AgentActionSchemaForStateUpdates = z
  .object({
    type: z.string(),
    target: z.string().nullable(),
    params: ActionParamsSchema.nullable(),
    result: ActionResultSchema.nullable(),
    success: z.boolean(),
  })
  .strict()

export const StateUpdatesSchema = z
  .object({
    lastResponse: z.string().nullable(),
    lastActions: z.array(AgentActionSchemaForStateUpdates).nullable(),
    actionSuccessRate: z.number().min(0).max(1).nullable(),
  })
  .strict()

export const LastExecutionInfoSchema = z
  .object({
    executionId: z.string(),
    timestamp: z.number(),
    triggerId: z.string().nullish(),
  })
  .strict()

/** Agent context schema - allows lastExecution plus arbitrary JSON values */
export const AgentContextSchema = z
  .object({
    lastExecution: LastExecutionInfoSchema.nullish(),
  })
  .catchall(JsonValueSchema)

/** Room state metadata schema */
export const RoomStateMetadataSchema = z
  .object({
    topic: z.string().nullish(),
    rules: z.array(z.string()).nullish(),
  })
  .catchall(JsonValueSchema)

/** Message metadata schema */
export const MessageMetadataSchema = z
  .object({
    source: z.string().nullish(),
    replyTo: z.string().nullish(),
    attachments: z.array(z.string()).nullish(),
  })
  .catchall(JsonValueSchema)

// =============================================================================
// Agent Schemas
// =============================================================================

export const AgentCharacterSchema = z
  .object({
    id: z.string().min(1, 'Character ID is required'),
    name: z.string().min(1, 'Character name is required'),
    description: z.string().min(1, 'Character description is required'),
    system: z.string().min(1, 'System prompt is required'),
    bio: z.array(z.string()),
    messageExamples: z.array(
      z.array(
        z.object({
          name: z.string(),
          content: z.object({ text: z.string() }),
        }),
      ),
    ),
    topics: z.array(z.string()),
    adjectives: z.array(z.string()),
    style: z.object({
      all: z.array(z.string()),
      chat: z.array(z.string()),
      post: z.array(z.string()),
    }),
    modelPreferences: z
      .object({
        small: z.string(),
        large: z.string(),
        embedding: z.string().nullish(),
      })
      .nullish(),
    mcpServers: z.array(z.string()).nullish(),
    a2aCapabilities: z.array(z.string()).nullish(),
  })
  .strict()

export const RegisterAgentRequestSchema = z
  .object({
    character: AgentCharacterSchema,
    initialFunding: z
      .string()
      .regex(/^\d+$/, 'Initial funding must be a valid number string')
      .nullable(),
  })
  .strict()

export const AgentIdParamSchema = z
  .object({
    agentId: z.string().regex(/^\d+$/, 'Agent ID must be a valid number'),
  })
  .strict()

export const FundAgentRequestSchema = z
  .object({
    amount: z.string().regex(/^\d+$/, 'Amount must be a valid number string'),
  })
  .strict()

export const AddMemoryRequestSchema = z
  .object({
    content: z.string().min(1, 'Memory content is required'),
    importance: z.number().min(0).max(1).nullable(),
    roomId: z.string().nullable(),
    userId: z.string().nullable(),
  })
  .strict()

export const RoomTypeSchema = z.enum([
  'collaboration',
  'adversarial',
  'debate',
  'council',
])

export const AgentRoleSchema = z.enum([
  'participant',
  'moderator',
  'red_team',
  'blue_team',
  'observer',
])

export const RoomPhaseSchema = z.enum([
  'setup',
  'active',
  'paused',
  'completed',
  'archived',
])

export const CreateRoomRequestSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Room name is required')
      .max(100, 'Room name too long'),
    description: z
      .string()
      .min(1, 'Description is required')
      .max(500, 'Description too long'),
    roomType: RoomTypeSchema,
    config: z
      .object({
        maxMembers: z.number().int().min(1).max(100).nullable(),
        turnBased: z.boolean().nullable(),
        turnTimeout: z.number().int().min(1).max(3600).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()

export const RoomIdParamSchema = z
  .object({
    roomId: z.string().regex(/^\d+$/, 'Room ID must be a valid number'),
  })
  .strict()

export const JoinRoomRequestSchema = z
  .object({
    agentId: z.string().regex(/^\d+$/, 'Agent ID must be a valid number'),
    role: AgentRoleSchema,
  })
  .strict()

export const LeaveRoomRequestSchema = z
  .object({
    agentId: z.string().regex(/^\d+$/, 'Agent ID must be a valid number'),
  })
  .strict()

export const PostMessageRequestSchema = z
  .object({
    agentId: z.string().regex(/^\d+$/, 'Agent ID must be a valid number'),
    content: z
      .string()
      .min(1, 'Message content is required')
      .max(10000, 'Message too long'),
    action: z.string().nullable(),
  })
  .strict()

export const SetPhaseRequestSchema = z
  .object({
    phase: RoomPhaseSchema,
  })
  .strict()

// =============================================================================
// Execution Schemas
// =============================================================================

export const ExecutionInputSchema = z
  .object({
    message: z.string().nullish(),
    roomId: z.string().nullish(),
    userId: z.string().nullish(),
    context: JsonObjectSchema.nullish(),
  })
  .strict()

export const ExecutionOptionsSchema = z
  .object({
    maxTokens: z.number().int().min(1).max(100000).nullish(),
    temperature: z.number().min(0).max(2).nullish(),
    requireTee: z.boolean().nullish(),
    maxCost: z
      .string()
      .regex(/^\d+$/, 'Max cost must be a valid number string')
      .nullish(),
    timeout: z.number().int().min(1).max(300).nullish(),
  })
  .strict()

export const ExecuteRequestSchema = z
  .object({
    agentId: z.string().regex(/^\d+$/, 'Agent ID must be a valid number'),
    triggerId: z.string().nullable(),
    input: ExecutionInputSchema,
    options: ExecutionOptionsSchema.nullable(),
  })
  .strict()

export const AgentSearchQuerySchema = z
  .object({
    name: z.string().nullable(),
    owner: AddressSchema.nullable(),
    active: z
      .string()
      .nullable()
      .transform((val) => val === 'true'),
    limit: z
      .string()
      .regex(/^\d+$/, 'Limit must be a valid number')
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .nullable(),
  })
  .strict()

export const BotIdParamSchema = z
  .object({
    agentId: z.string().regex(/^\d+$/, 'Agent ID must be a valid number'),
  })
  .strict()

// =============================================================================
// A2A/MCP Schemas
// =============================================================================

export const A2ARequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.string(),
    params: z
      .object({
        message: z
          .object({
            messageId: z.string(),
            parts: z.array(
              z.object({
                kind: z.string(),
                text: z.string().nullable(),
                data: JsonObjectSchema.nullable(),
              }),
            ),
          })
          .nullable(),
      })
      .nullable(),
    id: z.union([z.number(), z.string()]),
  })
  .strict()

export const MCPInitializeRequestSchema = z.object({}).strict()

export const MCPResourceReadRequestSchema = z
  .object({
    uri: z.string().min(1, 'URI is required'),
  })
  .strict()

export const MCPToolCallRequestSchema = z
  .object({
    name: z.string().min(1, 'Tool name is required'),
    arguments: JsonObjectSchema.nullable(),
  })
  .strict()

export const AddLiquidityRequestSchema = z
  .object({
    chain: z.string().min(1, 'Chain is required'),
    dex: z.string().min(1, 'DEX is required'),
    poolId: z.string().min(1, 'Pool ID is required'),
    amountA: z
      .string()
      .regex(/^\d+$/, 'Amount A must be a valid number string'),
    amountB: z
      .string()
      .regex(/^\d+$/, 'Amount B must be a valid number string'),
  })
  .strict()

export const SwapRequestSchema = z
  .object({
    inputMint: z.string().min(1, 'Input mint is required'),
    outputMint: z.string().min(1, 'Output mint is required'),
    amount: z.string().regex(/^\d+$/, 'Amount must be a valid number string'),
  })
  .strict()

export const RebalanceActionIdParamSchema = z
  .object({
    actionId: z.string().min(1, 'Action ID is required'),
  })
  .strict()

export const YieldVerifyParamSchema = z
  .object({
    id: z.string().min(1, 'Opportunity ID is required'),
  })
  .strict()

export const QuotesParamsSchema = z
  .object({
    inputMint: z.string().min(1, 'Input mint is required'),
    outputMint: z.string().min(1, 'Output mint is required'),
    amount: z.string().regex(/^\d+$/, 'Amount must be a valid number string'),
  })
  .strict()

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse and validate data with a Zod schema, throwing on failure
 * Use for fail-fast validation of external API responses
 */
export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context?: string,
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const errors = result.error.issues
      .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new Error(
      `${context ? `${context}: ` : ''}Validation failed: ${errors}`,
    )
  }
  return result.data
}

/**
 * Safely parse JSON and validate with schema, returning null on failure
 * Use for external/streaming data that might be malformed
 */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data)
  return result.success ? result.data : null
}

/**
 * Expect a value to be truthy, throw if not
 */
export function expect<T>(value: T | null | undefined, message: string): T {
  if (!value) {
    throw new Error(message)
  }
  return value
}

/**
 * Expect a condition to be true, throw if not
 */
export function expectCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

export const StorageUploadResponseSchema = z
  .object({
    cid: z.string().min(1, 'CID is required'),
  })
  .strict()

export const ModelsResponseSchema = z
  .object({
    models: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          provider: z.string(),
          pricePerInputToken: z.string().transform((val) => BigInt(val)),
          pricePerOutputToken: z.string().transform((val) => BigInt(val)),
          maxContextLength: z.number(),
          capabilities: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict()

export const InferenceResponseSchema = z
  .object({
    content: z.string(),
    model: z.string(),
    usage: z
      .object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
      })
      .strict(),
    cost: z.string().transform((val) => BigInt(val)),
  })
  .strict()

export const EmbeddingResponseSchema = z
  .object({
    embedding: z.array(z.number()),
  })
  .strict()

/** Agent item in search results - matches GraphQL query fields */
export const AgentSearchItemSchema = z.object({
  agentId: z.union([z.string(), z.number()]).transform((val) => BigInt(val)),
  owner: AddressSchema,
  name: z.string(),
  characterCid: z.string().nullable(),
  stateCid: z.string(),
  vaultAddress: AddressSchema,
  botType: z
    .enum(['ai_agent', 'trading_bot', 'org_tool'])
    .nullable()
    .default('ai_agent'),
  active: z.boolean(),
  registeredAt: z.number(),
  lastExecutedAt: z.number(),
  executionCount: z.number(),
})

export const AgentSearchResponseSchema = z.object({
  data: z.object({
    agents: z.object({
      items: z.array(AgentSearchItemSchema),
      total: z.number(),
      hasMore: z.boolean(),
    }),
  }),
})

// =============================================================================
// State Schemas (for JSON.parse validation)
// =============================================================================

export const AgentStateSchema = z
  .object({
    agentId: z.string(),
    version: z.number().int().min(0),
    memories: z.array(
      z
        .object({
          id: z.string(),
          content: z.string(),
          embedding: z.array(z.number()).nullish(),
          importance: z.number().min(0).max(1),
          createdAt: z.number(),
          roomId: z.string().nullish(),
          userId: z.string().nullish(),
        })
        .strict(),
    ),
    rooms: z.array(z.string()),
    context: AgentContextSchema,
    updatedAt: z.number(),
  })
  .strict()

export const RoomStateSchema = z
  .object({
    roomId: z.string(),
    version: z.number().int().min(0),
    messages: z.array(
      z
        .object({
          id: z.string(),
          agentId: z.string(),
          content: z.string(),
          timestamp: z.number(),
          action: z.string().nullish(),
          metadata: MessageMetadataSchema.nullish(),
        })
        .strict(),
    ),
    scores: z.record(z.string(), z.number()),
    currentTurn: z.string().nullish(),
    phase: z.enum(['setup', 'active', 'paused', 'completed', 'archived']),
    metadata: RoomStateMetadataSchema,
    updatedAt: z.number(),
  })
  .strict()

export const AgentDefinitionSchema = z
  .object({
    agentId: z.string().transform((val) => BigInt(val)),
    owner: AddressSchema,
    name: z.string(),
    botType: z.enum(['ai_agent', 'trading_bot', 'org_tool']),
    characterCid: z.string().nullable(),
    stateCid: z.string(),
    vaultAddress: AddressSchema,
    active: z.boolean(),
    registeredAt: z.number(),
    lastExecutedAt: z.number(),
    executionCount: z.number(),
    strategies: z.array(TradingBotStrategySchema).nullable(),
    chains: z.array(TradingBotChainSchema).nullable(),
    treasuryAddress: AddressSchema.nullable(),
    orgId: z.string().nullable(),
    capabilities: z.array(z.string()).nullable(),
  })
  .strict()

// OrgState schema matches org/types.ts OrgState (used by org/services/storage.ts)
export const OrgStateSchema = z
  .object({
    orgId: z.string(),
    version: z.number().int().min(0),
    todos: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          priority: z.enum(['low', 'medium', 'high', 'urgent']),
          status: z.string(), // TodoStatus from @jejunetwork/types
          dueDate: z.number().nullable(),
          assigneeAgentId: z.string().nullable(),
          assigneeName: z.string().nullable(),
          tags: z.array(z.string()),
          createdBy: z.string(),
          createdAt: z.number(),
          updatedAt: z.number(),
          completedAt: z.number().nullable(),
        })
        .strict(),
    ),
    checkinSchedules: z.array(
      z
        .object({
          id: z.string(),
          roomId: z.string(),
          name: z.string(),
          checkinType: z.enum([
            'standup',
            'sprint',
            'mental_health',
            'project_status',
            'retrospective',
          ]),
          frequency: z.enum([
            'daily',
            'weekdays',
            'weekly',
            'bi_weekly',
            'monthly',
          ]),
          timeUtc: z.string(),
          questions: z.array(z.string()),
          enabled: z.boolean(),
          nextRunAt: z.number(),
          createdBy: z.string(),
          createdAt: z.number(),
        })
        .strict(),
    ),
    checkinResponses: z.array(
      z
        .object({
          id: z.string(),
          scheduleId: z.string(),
          responderAgentId: z.string(),
          responderName: z.string().nullable(),
          answers: z.record(z.string(), z.string()),
          blockers: z.array(z.string()).nullable(),
          submittedAt: z.number(),
        })
        .strict(),
    ),
    teamMembers: z.array(
      z
        .object({
          id: z.string(),
          agentId: z.string(),
          displayName: z.string(),
          role: z.string().nullable(),
          isAdmin: z.boolean(),
          joinedAt: z.number(),
          lastActiveAt: z.number(),
          stats: z
            .object({
              totalCheckins: z.number(),
              checkinStreak: z.number(),
              todosCompleted: z.number(),
            })
            .strict(),
        })
        .strict(),
    ),
    metadata: JsonObjectSchema,
    updatedAt: z.number(),
  })
  .strict()

// OrgToolState schema matches types.ts OrgToolState (used by org-agent.ts)
export const OrgToolStateSchema = z
  .object({
    orgId: z.string(),
    botId: z.string(),
    botType: z.literal('org_tool'),
    todos: z.array(
      z
        .object({
          id: z.string(),
          orgId: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          priority: z.enum(['low', 'medium', 'high']),
          status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
          assigneeAgentId: z.string().nullable(),
          createdBy: z.string(),
          dueDate: z.number().nullable(),
          tags: z.array(z.string()),
          createdAt: z.number(),
          updatedAt: z.number(),
        })
        .strict(),
    ),
    checkinSchedules: z.array(
      z
        .object({
          id: z.string(),
          orgId: z.string(),
          roomId: z.string().nullable(),
          name: z.string(),
          checkinType: z.enum(['standup', 'retrospective', 'checkin']),
          frequency: z.enum(['daily', 'weekdays', 'weekly', 'monthly']),
          timeUtc: z.string(),
          questions: z.array(z.string()),
          active: z.boolean(),
          createdAt: z.number(),
        })
        .strict(),
    ),
    checkinResponses: z.array(
      z
        .object({
          id: z.string(),
          scheduleId: z.string(),
          responderAgentId: z.string(),
          answers: z.record(z.string(), z.string()),
          submittedAt: z.number(),
        })
        .strict(),
    ),
    teamMembers: z.array(
      z
        .object({
          agentId: z.string(),
          orgId: z.string(),
          role: z.string(),
          joinedAt: z.number(),
          lastActiveAt: z.number(),
          stats: z
            .object({
              todosCompleted: z.number(),
              checkinsCompleted: z.number(),
              contributions: z.number(),
            })
            .strict(),
        })
        .strict(),
    ),
    version: z.number().int().min(0),
    updatedAt: z.number(),
  })
  .strict()

export const TradingBotStrategyArraySchema = z.array(TradingBotStrategySchema)
export const TradingBotChainArraySchema = z.array(TradingBotChainSchema)
export const StringArraySchema = z.array(z.string())
export const RoomMemberSchema = z
  .object({
    agentId: z.string().transform((val) => BigInt(val)),
    role: z.enum([
      'participant',
      'moderator',
      'red_team',
      'blue_team',
      'observer',
    ]),
    joinedAt: z.number(),
    lastActiveAt: z.number(),
    score: z.number().nullable(),
  })
  .strict()

export const RoomMemberArraySchema = z.array(RoomMemberSchema)

export const RoomConfigSchema = z
  .object({
    maxMembers: z.number().int().min(1).max(100),
    turnBased: z.boolean(),
    turnTimeout: z.number().int().min(1).max(3600).nullable(),
    scoringRules: z
      .object({
        actionPoints: z.number(),
        winBonus: z.number(),
        violationPenalty: z.number(),
        custom: z.record(z.string(), z.number()).nullable(),
      })
      .strict()
      .nullable(),
    visibility: z.enum(['public', 'private', 'members_only']),
  })
  .strict()

export const RoomSchema = z
  .object({
    roomId: z.string().transform((val) => BigInt(val)),
    name: z.string(),
    description: z.string(),
    owner: AddressSchema,
    stateCid: z.string(),
    members: RoomMemberArraySchema,
    roomType: RoomTypeSchema,
    config: RoomConfigSchema,
    active: z.boolean(),
    createdAt: z.number(),
  })
  .strict()

export const AgentActionSchema = z
  .object({
    type: z.string(),
    target: z.string().nullable(),
    params: ActionParamsSchema.nullable(),
    result: ActionResultSchema.nullable(),
    success: z.boolean(),
  })
  .strict()

export const RoomMessageSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    content: z.string(),
    timestamp: z.number(),
    action: z.string().nullish(),
    metadata: MessageMetadataSchema.nullish(),
  })
  .strict()

export const ExecutionOutputSchema = z
  .object({
    response: z.string().nullable(),
    actions: z.array(AgentActionSchema).nullable(),
    stateUpdates: StateUpdatesSchema.nullable(),
    roomMessages: z.array(RoomMessageSchema).nullable(),
  })
  .strict()

export const ExecutionCostSchema = z
  .object({
    total: z
      .union([z.string().transform((val) => BigInt(val)), z.bigint()])
      .transform((val) => (typeof val === 'bigint' ? val : BigInt(val))),
    inference: z
      .union([z.string().transform((val) => BigInt(val)), z.bigint()])
      .transform((val) => (typeof val === 'bigint' ? val : BigInt(val))),
    storage: z
      .union([z.string().transform((val) => BigInt(val)), z.bigint()])
      .transform((val) => (typeof val === 'bigint' ? val : BigInt(val))),
    executionFee: z
      .union([z.string().transform((val) => BigInt(val)), z.bigint()])
      .transform((val) => (typeof val === 'bigint' ? val : BigInt(val))),
    currency: z.string(),
    txHash: z.string().nullable(),
  })
  .strict()

export const ExecutionMetadataSchema = z
  .object({
    startedAt: z.number(),
    completedAt: z.number(),
    latencyMs: z.number(),
    model: z.string().nullable(),
    tokensUsed: z
      .object({
        input: z.number(),
        output: z.number(),
      })
      .strict()
      .nullable(),
    executor: AddressSchema,
    attestationHash: z.string().nullable(),
  })
  .strict()

export const ExecutionResultSchema = z
  .object({
    executionId: z.string(),
    agentId: z
      .union([z.string().transform((val) => BigInt(val)), z.bigint()])
      .transform((val) => (typeof val === 'bigint' ? val : BigInt(val))),
    status: z.string(), // ExecutionStatus from @jejunetwork/types
    output: ExecutionOutputSchema.nullable(),
    newStateCid: z.string().nullable(),
    cost: ExecutionCostSchema,
    metadata: ExecutionMetadataSchema,
  })
  .strict()

// =============================================================================
// DEX Adapter Schemas for Solana
// =============================================================================

/** Jupiter quote response (full format for DEX adapters) */
export const JupiterQuoteResponseSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  priceImpactPct: z.string(),
  routePlan: z.array(
    z.object({
      swapInfo: z.object({
        ammKey: z.string(),
        label: z.string(),
        inputMint: z.string(),
        outputMint: z.string(),
        inAmount: z.string(),
        outAmount: z.string(),
        feeAmount: z.string(),
        feeMint: z.string(),
      }),
      percent: z.number(),
    }),
  ),
})

/** Jupiter swap response (full format for DEX adapters) */
export const JupiterSwapResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number().nullable(),
  prioritizationFeeLamports: z.number().nullable(),
})

export const JupiterPriceResponseSchema = z
  .object({
    data: z.record(
      z.string(),
      z
        .object({
          price: z.number(),
        })
        .strict(),
    ),
  })
  .strict()

export const RaydiumQuoteResponseSchema = z
  .object({
    success: z.boolean(),
    data: z
      .object({
        inputMint: z.string(),
        outputMint: z.string(),
        inputAmount: z.string(),
        outputAmount: z.string(),
        priceImpactPct: z.number(),
        routePlan: z.array(
          z
            .object({
              poolId: z.string(),
              inputMint: z.string(),
              outputMint: z.string(),
              inputAmount: z.string(),
              outputAmount: z.string(),
              feeAmount: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()

export const RaydiumSwapResponseSchema = z
  .object({
    data: z
      .object({
        transaction: z.string(),
      })
      .strict(),
  })
  .strict()

export const RaydiumPoolsResponseSchema = z
  .object({
    success: z.boolean(),
    data: z
      .object({
        data: z.array(
          z
            .object({
              id: z.string(),
              mintA: z
                .object({
                  address: z.string(),
                  symbol: z.string(),
                  decimals: z.number(),
                })
                .strict(),
              mintB: z
                .object({
                  address: z.string(),
                  symbol: z.string(),
                  decimals: z.number(),
                })
                .strict(),
              tvl: z.number(),
              feeRate: z.number(),
              apr24h: z.number(),
              volume24h: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()

export const RaydiumLiquidityResponseSchema = z
  .object({
    data: z
      .object({
        transaction: z.string(),
      })
      .strict(),
  })
  .strict()

export const RaydiumPositionsResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(
      z
        .object({
          poolId: z.string(),
          mintA: z
            .object({
              address: z.string(),
              symbol: z.string(),
              decimals: z.number(),
            })
            .strict(),
          mintB: z
            .object({
              address: z.string(),
              symbol: z.string(),
              decimals: z.number(),
            })
            .strict(),
          amountA: z.string(),
          amountB: z.string(),
          valueUsd: z.number(),
          positionId: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict()

export const OrcaQuoteResponseSchema = z
  .object({
    inputMint: z.string(),
    outputMint: z.string(),
    inAmount: z.string(),
    outAmount: z.string(),
    priceImpact: z.number(),
    route: z.array(
      z
        .object({
          whirlpool: z.string(),
          inputMint: z.string(),
          outputMint: z.string(),
          inputAmount: z.string(),
          outputAmount: z.string(),
        })
        .strict(),
    ),
  })
  .strict()

export const OrcaSwapResponseSchema = z
  .object({
    transaction: z.string(),
  })
  .strict()

export const OrcaPoolsResponseSchema = z
  .object({
    whirlpools: z.array(
      z
        .object({
          address: z.string(),
          tokenMintA: z.string(),
          tokenMintB: z.string(),
          tickSpacing: z.number(),
          feeRate: z.number(),
          tvl: z.number(),
          volume24h: z.number(),
          apr24h: z.number(),
        })
        .strict(),
    ),
  })
  .strict()

export const OrcaPoolResponseSchema = z
  .object({
    address: z.string(),
    tokenMintA: z.string(),
    tokenMintB: z.string(),
    tickSpacing: z.number(),
    feeRate: z.number(),
    tvl: z.number(),
    currentTick: z.number(),
    sqrtPrice: z.string(),
  })
  .strict()

export const OrcaLiquidityResponseSchema = z
  .object({
    transaction: z.string(),
  })
  .strict()

export const OrcaPositionsResponseSchema = z
  .object({
    positions: z.array(
      z
        .object({
          address: z.string(),
          whirlpool: z.string(),
          tickLower: z.number(),
          tickUpper: z.number(),
          liquidity: z.string(),
          tokenA: z.object({ mint: z.string(), amount: z.string() }).strict(),
          tokenB: z.object({ mint: z.string(), amount: z.string() }).strict(),
          valueUsd: z.number(),
          feesOwed: z.object({ a: z.string(), b: z.string() }).strict(),
          inRange: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()

export const MeteoraQuoteResponseSchema = z
  .object({
    inputMint: z.string(),
    outputMint: z.string(),
    inAmount: z.string(),
    outAmount: z.string(),
    priceImpact: z.number(),
    poolAddress: z.string(),
  })
  .strict()

export const MeteoraSwapResponseSchema = z
  .object({
    transaction: z.string(),
  })
  .strict()

export const MeteoraPoolsResponseSchema = z.array(
  z
    .object({
      address: z.string(),
      name: z.string(),
      mintX: z.string(),
      mintY: z.string(),
      reserveX: z.string(),
      reserveY: z.string(),
      baseFee: z.number(),
      binStep: z.number(),
      tvl: z.number(),
      apr: z.number(),
      volume24h: z.number(),
    })
    .strict(),
)

export const MeteoraPoolResponseSchema = z
  .object({
    address: z.string(),
    name: z.string(),
    mintX: z.string(),
    mintY: z.string(),
    reserveX: z.string(),
    reserveY: z.string(),
    baseFee: z.number(),
    binStep: z.number(),
    tvl: z.number(),
    activeBin: z.number(),
  })
  .strict()

export const MeteoraLiquidityResponseSchema = z
  .object({
    transaction: z.string(),
  })
  .strict()

export const MeteoraPositionsResponseSchema = z.array(
  z
    .object({
      publicKey: z.string(),
      poolAddress: z.string(),
      mintX: z.string(),
      mintY: z.string(),
      amountX: z.string(),
      amountY: z.string(),
      valueUsd: z.number(),
      lowerBinId: z.number(),
      upperBinId: z.number(),
      totalClaimedFees: z.object({ x: z.string(), y: z.string() }).strict(),
    })
    .strict(),
)

export const OneInchQuoteResponseSchema = z
  .object({
    dstAmount: z.string(),
    gas: z.number().nullable(),
    estimatedGas: z.number().nullable(),
  })
  .strict()

export const ParaswapQuoteResponseSchema = z
  .object({
    priceRoute: z
      .object({
        destAmount: z.string(),
        gasCost: z.string(),
        gasCostUSD: z.string().nullable(),
        srcUSD: z.string().nullable(),
        destUSD: z.string().nullable(),
      })
      .strict()
      .nullable(),
    error: z.string().nullable(),
  })
  .strict()

// =============================================================================
// Chat API Schemas
// =============================================================================

/** Schema for chat request body (server.ts chat endpoint) */
export const ChatRequestSchema = z
  .object({
    text: z.string().min(1, 'Text is required'),
    userId: z.string().nullable(),
    roomId: z.string().nullable(),
  })
  .strict()

/** Schema for agent start request body (autonomous agents endpoint) */
export const AgentStartRequestSchema = z
  .object({
    characterId: z.string().min(1, 'Character ID is required'),
    tickIntervalMs: z.number().int().min(1000).max(3600000).nullable(),
    capabilities: z.record(z.string(), z.boolean()).nullable(),
  })
  .strict()

/** Schema for Alchemy pending transaction data */
const AlchemyPendingTxSchema = z.object({
  hash: z.string(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  gasPrice: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  maxFeePerGas: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  maxPriorityFeePerGas: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  gas: z.string(),
  input: z.string(),
  nonce: z.string(),
})

/** Schema for Alchemy subscription message */
export const AlchemySubscriptionMessageSchema = z.object({
  method: z.literal('eth_subscription').nullable(),
  params: z
    .object({
      result: AlchemyPendingTxSchema.nullable(),
    })
    .nullable(),
})

/** Schema for WebSocket eth_subscription message (hash only) */
export const WebSocketEthSubscriptionMessageSchema = z.object({
  method: z.literal('eth_subscription').nullable(),
  params: z
    .object({
      result: z.string().nullable(),
    })
    .nullable(),
})

/** Schema for Bot API A2A request (simplified JSON-RPC style) */
export const BotA2ARequestSchema = z
  .object({
    jsonrpc: z.literal('2.0').nullable(),
    method: z.string().min(1, 'Method is required'),
    params: JsonObjectSchema.nullable(),
    id: z.union([z.number(), z.string()]).nullable(),
  })
  .strict()

// =============================================================================
// Hyperliquid API Response Schemas
// =============================================================================

/** Hyperliquid metadata response */
export const HyperliquidMetaSchema = z.object({
  universe: z.array(
    z.object({
      name: z.string(),
      szDecimals: z.number(),
    }),
  ),
})

/** Hyperliquid asset context */
export const HyperliquidAssetCtxSchema = z.object({
  funding: z.string(),
  openInterest: z.string(),
  prevDayPx: z.string(),
  dayNtlVlm: z.string(),
  premium: z.string().nullable(),
  oraclePx: z.string(),
  markPx: z.string(),
})

/** Hyperliquid meta and asset contexts response tuple */
export const HyperliquidMetaAndAssetCtxsSchema = z.tuple([
  HyperliquidMetaSchema,
  z.array(HyperliquidAssetCtxSchema),
])

/** Hyperliquid all mids response (price map) */
export const HyperliquidAllMidsSchema = z.record(z.string(), z.string())

/** Hyperliquid clearinghouse state response */
export const HyperliquidStateSchema = z.object({
  assetPositions: z.array(
    z.object({
      position: z.object({
        coin: z.string(),
        szi: z.string(),
        entryPx: z.string(),
        positionValue: z.string(),
        unrealizedPnl: z.string(),
        leverage: z.object({
          type: z.string(),
          value: z.number(),
        }),
      }),
    }),
  ),
  marginSummary: z.object({
    accountValue: z.string(),
    totalMarginUsed: z.string(),
    totalNtlPos: z.string(),
  }),
})

/** Hyperliquid order result response */
export const HyperliquidOrderResultSchema = z.object({
  status: z.string(),
  response: z
    .object({
      data: z
        .object({
          statuses: z.array(
            z.object({
              resting: z.object({ oid: z.number() }).nullable(),
            }),
          ),
        })
        .nullable(),
    })
    .nullable(),
})

/** DWS node stats response */
export const DWSNodeStatsSchema = z.object({
  inference: z
    .object({
      activeNodes: z.number().nullable(),
    })
    .nullable(),
})

/** DWS chat completion response */
export const DWSChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string(),
        content: z.string(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  node: z.string().nullable(),
  provider: z.string().nullable(),
  error: z.string().nullable(),
  message: z.string().nullable(),
})

/** DWS inference response (alternate format) */
export const DWSInferenceAltSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }).nullable(),
      }),
    )
    .nullable(),
  content: z.string().nullable(),
})

/** DWS OpenAI-compatible response format */
export const DWSOpenAICompatSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }).nullable(),
    }),
  ),
  model: z.string().nullable(),
  usage: z
    .object({
      prompt_tokens: z.number().nullable(),
      completion_tokens: z.number().nullable(),
    })
    .nullable(),
  cost: z.union([z.string(), z.number()]).nullable(),
})

// =============================================================================
// Flashbots/MEV Builder Response Schemas
// =============================================================================

/** Flashbots bundle submission response */
export const FlashbotsBundleResponseSchema = z.object({
  result: z
    .object({
      bundleHash: z.string().nullable(),
    })
    .nullable(),
  error: z.object({ message: z.string() }).nullable(),
})

/** Flashbots simulation response */
export const FlashbotsSimulationResponseSchema = z.object({
  result: z
    .object({
      results: z
        .array(
          z.object({
            txHash: z.string(),
            gasUsed: z.string(),
            revert: z.string().nullable(),
          }),
        )
        .nullable(),
      totalGasUsed: z.string().nullable(),
      coinbaseDiff: z.string().nullable(),
    })
    .nullable(),
  error: z.object({ message: z.string() }).nullable(),
})

/** Flashbots bundle stats response */
export const FlashbotsBundleStatsSchema = z.object({
  result: z
    .object({
      isSimulated: z.boolean().nullable(),
      isIncluded: z.boolean().nullable(),
      blockNumber: z.string().nullable(),
    })
    .nullable(),
})

/** L2 raw transaction response */
export const L2RawTxResponseSchema = z.object({
  result: z.string().nullable(),
  error: z.object({ message: z.string() }).nullable(),
})

/** MEV-Share private transaction response */
export const MevSharePrivateTxResponseSchema = z.object({
  result: z
    .union([z.string(), z.object({ txHash: z.string().nullable() })])
    .nullable(),
  error: z.object({ message: z.string() }).nullable(),
})

/** MEV-Share cancel response */
export const MevShareCancelResponseSchema = z.object({
  result: z.boolean().nullable(),
})

/** Redstone price response */
export const RedstonePriceResponseSchema = z.record(
  z.string(),
  z.object({
    value: z.number(),
    timestamp: z.number(),
  }),
)

// =============================================================================
// Solana DEX/Jupiter Response Schemas (External API)
// =============================================================================

/** Jupiter quote response */
export const JupiterQuoteApiResponseSchema = z.object({
  inputMint: z.string().nullable(),
  outputMint: z.string().nullable(),
  inAmount: z.string().nullable(),
  outAmount: z.string(),
  priceImpactPct: z.string().nullable(),
  routePlan: z
    .array(
      z.object({
        swapInfo: z.object({
          ammKey: z.string().nullable(),
          label: z.string(),
        }),
      }),
    )
    .nullable(),
})

/** Jupiter swap response */
export const JupiterSwapApiResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number().nullable(),
})

/** Jito bundle status response */
export const JitoBundleStatusSchema = z.object({
  result: z
    .object({
      value: z.array(
        z.object({
          confirmation_status: z.string(),
        }),
      ),
    })
    .nullable(),
})

/** Jito bundle submission response */
export const JitoBundleSubmitSchema = z.object({
  result: z.string().nullable(),
  error: z.object({ message: z.string() }).nullable(),
})

/** Generic pool data from Solana DEX APIs */
export const SolanaDexPoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  tvl: z.number(),
  volume24h: z.number(),
  apr: z
    .object({
      trading: z.number().nullable(),
      rewards: z.number().nullable(),
    })
    .nullable(),
  tokenA: z.object({
    symbol: z.string(),
    mint: z.string(),
    decimals: z.number(),
  }),
  tokenB: z.object({
    symbol: z.string(),
    mint: z.string(),
    decimals: z.number(),
  }),
  fee: z.number().nullable(),
})

/** Solana DEX pools response */
export const SolanaDexPoolsResponseSchema = z.object({
  data: z.array(SolanaDexPoolSchema).nullable(),
})

/** Solana lending market data */
export const SolanaLendingMarketSchema = z.object({
  mint: z.string(),
  symbol: z.string(),
  decimals: z.number(),
  supplyApr: z.number(),
  borrowApr: z.number(),
  tvl: z.number(),
  utilization: z.number(),
})

/** Solana lending markets response */
export const SolanaLendingMarketsResponseSchema = z.object({
  markets: z.array(SolanaLendingMarketSchema).nullable(),
})

// =============================================================================
// EVM RPC Response Schemas
// =============================================================================

/** Eth getTransactionByHash response */
export const EthGetTransactionResponseSchema = z.object({
  result: z
    .object({
      hash: z.string(),
      from: z.string(),
      to: z.string(),
      value: z.string(),
      gasPrice: z.string().nullable(),
      maxFeePerGas: z.string().nullable(),
      maxPriorityFeePerGas: z.string().nullable(),
      gas: z.string(),
      input: z.string(),
      nonce: z.string(),
    })
    .nullable()
    .nullable(),
})

/** Chat API response */
export const ChatApiResponseSchema = z.object({
  text: z.string(),
})

/** ZK Bridge transaction response */
export const ZKBridgeTxResponseSchema = z.object({
  txHash: z.string(),
})
