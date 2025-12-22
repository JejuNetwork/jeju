/**
 * Zod Schemas for Crucible API Validation
 *
 * Comprehensive validation schemas for all API endpoints, request/response types,
 * and internal data structures. All schemas use strict validation with fail-fast patterns.
 */

import { isAddress } from 'viem'
import { z } from 'zod'

// =============================================================================
// Address Validation
// =============================================================================

const AddressSchema = z
  .string()
  .refine(isAddress, { error: 'Invalid Ethereum address' })
  .transform((val) => val as `0x${string}`)

// =============================================================================
// JSON Value Schemas (for truly polymorphic external data)
// =============================================================================

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

// =============================================================================
// Trading Bot Schemas
// =============================================================================

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
    cooldownMs: z.number().int().min(0).optional(),
  })
  .strict()

export const TradingBotChainSchema = z
  .object({
    chainId: z.number().int().min(1),
    name: z.string().min(1),
    rpcUrl: z.string().url(),
    wsUrl: z.string().url().optional(),
    blockTime: z.number().int().min(1).max(60000),
    isL2: z.boolean(),
    nativeSymbol: z.string().min(1),
    explorerUrl: z.string().url().optional(),
  })
  .strict()

// =============================================================================
// Action Types Schemas
// =============================================================================

/** Schema for action parameters */
export const ActionParamsSchema = z
  .object({
    content: z.string().optional(),
    target: z.string().optional(),
    amount: z.string().optional(),
  })
  .catchall(JsonValueSchema)

/** Schema for action result - union of possible result types */
export const ActionResultSchema = z.union([
  z.string(), // Transaction hash
  z.object({ txHash: z.string(), success: z.boolean().optional() }).strict(),
  z.object({ success: z.boolean(), error: z.string().optional() }).strict(),
  JsonObjectSchema, // Complex structured result
])

// =============================================================================
// State Update Schemas
// =============================================================================

// Forward declare AgentActionSchema for use in StateUpdatesSchema
const AgentActionSchemaForStateUpdates = z
  .object({
    type: z.string(),
    target: z.string().optional(),
    params: ActionParamsSchema.optional(),
    result: ActionResultSchema.optional(),
    success: z.boolean(),
  })
  .strict()

export const StateUpdatesSchema = z
  .object({
    lastResponse: z.string().optional(),
    lastActions: z.array(AgentActionSchemaForStateUpdates).optional(),
    actionSuccessRate: z.number().min(0).max(1).optional(),
  })
  .strict()

// =============================================================================
// Context and Metadata Schemas
// =============================================================================

export const LastExecutionInfoSchema = z
  .object({
    executionId: z.string(),
    timestamp: z.number(),
    triggerId: z.string().optional(),
  })
  .strict()

/** Agent context schema - allows lastExecution plus arbitrary JSON values */
export const AgentContextSchema = z
  .object({
    lastExecution: LastExecutionInfoSchema.optional(),
  })
  .catchall(JsonValueSchema)

/** Room state metadata schema */
export const RoomStateMetadataSchema = z
  .object({
    topic: z.string().optional(),
    rules: z.array(z.string()).optional(),
  })
  .catchall(JsonValueSchema)

/** Message metadata schema */
export const MessageMetadataSchema = z
  .object({
    source: z.string().optional(),
    replyTo: z.string().optional(),
    attachments: z.array(z.string()).optional(),
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
        embedding: z.string().optional(),
      })
      .optional(),
    mcpServers: z.array(z.string()).optional(),
    a2aCapabilities: z.array(z.string()).optional(),
  })
  .strict()

export const RegisterAgentRequestSchema = z
  .object({
    character: AgentCharacterSchema,
    initialFunding: z
      .string()
      .regex(/^\d+$/, 'Initial funding must be a valid number string')
      .optional(),
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
    importance: z.number().min(0).max(1).optional(),
    roomId: z.string().optional(),
    userId: z.string().optional(),
  })
  .strict()

// =============================================================================
// Room Schemas
// =============================================================================

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
        maxMembers: z.number().int().min(1).max(100).optional(),
        turnBased: z.boolean().optional(),
        turnTimeout: z.number().int().min(1).max(3600).optional(),
      })
      .strict()
      .optional(),
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
    action: z.string().optional(),
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
    message: z.string().optional(),
    roomId: z.string().optional(),
    userId: z.string().optional(),
    context: JsonObjectSchema.optional(),
  })
  .strict()

export const ExecutionOptionsSchema = z
  .object({
    maxTokens: z.number().int().min(1).max(100000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    requireTee: z.boolean().optional(),
    maxCost: z
      .string()
      .regex(/^\d+$/, 'Max cost must be a valid number string')
      .optional(),
    timeout: z.number().int().min(1).max(300).optional(),
  })
  .strict()

export const ExecuteRequestSchema = z
  .object({
    agentId: z.string().regex(/^\d+$/, 'Agent ID must be a valid number'),
    triggerId: z.string().optional(),
    input: ExecutionInputSchema,
    options: ExecutionOptionsSchema.optional(),
  })
  .strict()

// =============================================================================
// Search Schemas
// =============================================================================

export const AgentSearchQuerySchema = z
  .object({
    name: z.string().optional(),
    owner: AddressSchema.optional(),
    active: z
      .string()
      .optional()
      .transform((val) => val === 'true'),
    limit: z
      .string()
      .regex(/^\d+$/, 'Limit must be a valid number')
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .optional(),
  })
  .strict()

// =============================================================================
// Bot Management Schemas
// =============================================================================

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
                text: z.string().optional(),
                data: JsonObjectSchema.optional(),
              }),
            ),
          })
          .optional(),
      })
      .optional(),
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
    arguments: JsonObjectSchema.optional(),
  })
  .strict()

// =============================================================================
// Bot API Schemas
// =============================================================================

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
  schema: z.ZodSchema<T>,
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
export function safeParse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): T | null {
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

// =============================================================================
// Response Schemas (for external API responses)
// =============================================================================

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
          // Accept both string and number for backward compatibility
          pricePerInputToken: z
            .union([z.string(), z.number()])
            .transform((val) => BigInt(val)),
          pricePerOutputToken: z
            .union([z.string(), z.number()])
            .transform((val) => BigInt(val)),
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
  characterCid: z.string().optional(),
  stateCid: z.string(),
  vaultAddress: AddressSchema,
  botType: z
    .enum(['ai_agent', 'trading_bot', 'org_tool'])
    .optional()
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
          embedding: z.array(z.number()).optional(),
          importance: z.number().min(0).max(1),
          createdAt: z.number(),
          roomId: z.string().optional(),
          userId: z.string().optional(),
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
          action: z.string().optional(),
          metadata: MessageMetadataSchema.optional(),
        })
        .strict(),
    ),
    scores: z.record(z.string(), z.number()),
    currentTurn: z.string().optional(),
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
    characterCid: z.string().optional(),
    stateCid: z.string(),
    vaultAddress: AddressSchema,
    active: z.boolean(),
    registeredAt: z.number(),
    lastExecutedAt: z.number(),
    executionCount: z.number(),
    strategies: z.array(TradingBotStrategySchema).optional(),
    chains: z.array(TradingBotChainSchema).optional(),
    treasuryAddress: AddressSchema.optional(),
    orgId: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .strict()

// =============================================================================
// Org Schemas
// =============================================================================

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
          description: z.string().optional(),
          priority: z.enum(['low', 'medium', 'high', 'urgent']),
          status: z.string(), // TodoStatus from @jejunetwork/types
          dueDate: z.number().optional(),
          assigneeAgentId: z.string().optional(),
          assigneeName: z.string().optional(),
          tags: z.array(z.string()),
          createdBy: z.string(),
          createdAt: z.number(),
          updatedAt: z.number(),
          completedAt: z.number().optional(),
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
          responderName: z.string().optional(),
          answers: z.record(z.string(), z.string()),
          blockers: z.array(z.string()).optional(),
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
          role: z.string().optional(),
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
          description: z.string().optional(),
          priority: z.enum(['low', 'medium', 'high']),
          status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
          assigneeAgentId: z.string().optional(),
          createdBy: z.string(),
          dueDate: z.number().optional(),
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
          roomId: z.string().optional(),
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

// =============================================================================
// JSON Array Schemas (for JSON.parse validation)
// =============================================================================

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
    score: z.number().optional(),
  })
  .strict()

export const RoomMemberArraySchema = z.array(RoomMemberSchema)

export const RoomConfigSchema = z
  .object({
    maxMembers: z.number().int().min(1).max(100),
    turnBased: z.boolean(),
    turnTimeout: z.number().int().min(1).max(3600).optional(),
    scoringRules: z
      .object({
        actionPoints: z.number(),
        winBonus: z.number(),
        violationPenalty: z.number(),
        custom: z.record(z.string(), z.number()).optional(),
      })
      .strict()
      .optional(),
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
    target: z.string().optional(),
    params: ActionParamsSchema.optional(),
    result: ActionResultSchema.optional(),
    success: z.boolean(),
  })
  .strict()

export const RoomMessageSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    content: z.string(),
    timestamp: z.number(),
    action: z.string().optional(),
    metadata: MessageMetadataSchema.optional(),
  })
  .strict()

export const ExecutionOutputSchema = z
  .object({
    response: z.string().optional(),
    actions: z.array(AgentActionSchema).optional(),
    stateUpdates: StateUpdatesSchema.optional(),
    roomMessages: z.array(RoomMessageSchema).optional(),
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
    txHash: z.string().optional(),
  })
  .strict()

export const ExecutionMetadataSchema = z
  .object({
    startedAt: z.number(),
    completedAt: z.number(),
    latencyMs: z.number(),
    model: z.string().optional(),
    tokensUsed: z
      .object({
        input: z.number(),
        output: z.number(),
      })
      .strict()
      .optional(),
    executor: AddressSchema,
    attestationHash: z.string().optional(),
  })
  .strict()

export const ExecutionResultSchema = z
  .object({
    executionId: z.string(),
    agentId: z
      .union([z.string().transform((val) => BigInt(val)), z.bigint()])
      .transform((val) => (typeof val === 'bigint' ? val : BigInt(val))),
    status: z.string(), // ExecutionStatus from @jejunetwork/types
    output: ExecutionOutputSchema.optional(),
    newStateCid: z.string().optional(),
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
  lastValidBlockHeight: z.number().optional(),
  prioritizationFeeLamports: z.number().optional(),
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
          positionId: z.string().optional(),
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

// =============================================================================
// DEX Aggregator (EVM) Schemas
// =============================================================================

export const OneInchQuoteResponseSchema = z
  .object({
    dstAmount: z.string(),
    gas: z.number().optional(),
    estimatedGas: z.number().optional(),
  })
  .strict()

export const ParaswapQuoteResponseSchema = z
  .object({
    priceRoute: z
      .object({
        destAmount: z.string(),
        gasCost: z.string(),
        gasCostUSD: z.string().optional(),
        srcUSD: z.string().optional(),
        destUSD: z.string().optional(),
      })
      .strict()
      .optional(),
    error: z.string().optional(),
  })
  .strict()

// =============================================================================
// Chat API Schemas
// =============================================================================

/** Schema for chat request body (server.ts chat endpoint) */
export const ChatRequestSchema = z
  .object({
    text: z.string().min(1, 'Text is required'),
    userId: z.string().optional(),
    roomId: z.string().optional(),
  })
  .strict()

/** Schema for agent start request body (autonomous agents endpoint) */
export const AgentStartRequestSchema = z
  .object({
    characterId: z.string().min(1, 'Character ID is required'),
    tickIntervalMs: z.number().int().min(1000).max(3600000).optional(),
    capabilities: z.record(z.string(), z.boolean()).optional(),
  })
  .strict()

// =============================================================================
// WebSocket Message Schemas (External Data Validation)
// =============================================================================

/** Schema for Alchemy pending transaction data */
const AlchemyPendingTxSchema = z.object({
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

/** Schema for Alchemy subscription message */
export const AlchemySubscriptionMessageSchema = z.object({
  method: z.literal('eth_subscription').optional(),
  params: z
    .object({
      result: AlchemyPendingTxSchema.optional(),
    })
    .optional(),
})

/** Schema for WebSocket eth_subscription message (hash only) */
export const WebSocketEthSubscriptionMessageSchema = z.object({
  method: z.literal('eth_subscription').optional(),
  params: z
    .object({
      result: z.string().optional(),
    })
    .optional(),
})

/** Schema for Bot API A2A request (simplified JSON-RPC style) */
export const BotA2ARequestSchema = z
  .object({
    jsonrpc: z.literal('2.0').optional(),
    method: z.string().min(1, 'Method is required'),
    params: JsonObjectSchema.optional(),
    id: z.union([z.number(), z.string()]).optional(),
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
  premium: z.string().optional(),
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
              resting: z.object({ oid: z.number() }).optional(),
            }),
          ),
        })
        .optional(),
    })
    .optional(),
})

// =============================================================================
// DWS (Decentralized Workstation Service) Response Schemas
// =============================================================================

/** DWS node stats response */
export const DWSNodeStatsSchema = z.object({
  inference: z
    .object({
      activeNodes: z.number().optional(),
    })
    .optional(),
})

/** DWS chat completion response */
export const DWSChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string(),
        content: z.string(),
      }),
      finish_reason: z.string().optional(),
    }),
  ),
  node: z.string().optional(),
  provider: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
})

/** DWS inference response (alternate format) */
export const DWSInferenceAltSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }).optional(),
      }),
    )
    .optional(),
  content: z.string().optional(),
})

/** DWS OpenAI-compatible response format */
export const DWSOpenAICompatSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }).optional(),
    }),
  ),
  model: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
  cost: z.union([z.string(), z.number()]).optional(),
})

// =============================================================================
// Flashbots/MEV Builder Response Schemas
// =============================================================================

/** Flashbots bundle submission response */
export const FlashbotsBundleResponseSchema = z.object({
  result: z
    .object({
      bundleHash: z.string().optional(),
    })
    .optional(),
  error: z.object({ message: z.string() }).optional(),
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
            revert: z.string().optional(),
          }),
        )
        .optional(),
      totalGasUsed: z.string().optional(),
      coinbaseDiff: z.string().optional(),
    })
    .optional(),
  error: z.object({ message: z.string() }).optional(),
})

/** Flashbots bundle stats response */
export const FlashbotsBundleStatsSchema = z.object({
  result: z
    .object({
      isSimulated: z.boolean().optional(),
      isIncluded: z.boolean().optional(),
      blockNumber: z.string().optional(),
    })
    .optional(),
})

/** L2 raw transaction response */
export const L2RawTxResponseSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
})

/** MEV-Share private transaction response */
export const MevSharePrivateTxResponseSchema = z.object({
  result: z.union([z.string(), z.object({ txHash: z.string().optional() })]).optional(),
  error: z.object({ message: z.string() }).optional(),
})

/** MEV-Share cancel response */
export const MevShareCancelResponseSchema = z.object({
  result: z.boolean().optional(),
})

// =============================================================================
// Redstone Finance Response Schemas
// =============================================================================

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
  inputMint: z.string().optional(),
  outputMint: z.string().optional(),
  inAmount: z.string().optional(),
  outAmount: z.string(),
  priceImpactPct: z.string().optional(),
  routePlan: z
    .array(
      z.object({
        swapInfo: z.object({
          ammKey: z.string().optional(),
          label: z.string(),
        }),
      }),
    )
    .optional(),
})

/** Jupiter swap response */
export const JupiterSwapApiResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number().optional(),
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
    .optional(),
})

/** Jito bundle submission response */
export const JitoBundleSubmitSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
})

// =============================================================================
// Solana DEX Pool API Response Schemas
// =============================================================================

/** Generic pool data from Solana DEX APIs */
export const SolanaDexPoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  tvl: z.number(),
  volume24h: z.number(),
  apr: z
    .object({
      trading: z.number().optional(),
      rewards: z.number().optional(),
    })
    .optional(),
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
  fee: z.number().optional(),
})

/** Solana DEX pools response */
export const SolanaDexPoolsResponseSchema = z.object({
  data: z.array(SolanaDexPoolSchema).optional(),
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
  markets: z.array(SolanaLendingMarketSchema).optional(),
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
      gasPrice: z.string().optional(),
      maxFeePerGas: z.string().optional(),
      maxPriorityFeePerGas: z.string().optional(),
      gas: z.string(),
      input: z.string(),
      nonce: z.string(),
    })
    .nullable()
    .optional(),
})

// =============================================================================
// Chat/Agent API Response Schemas
// =============================================================================

/** Chat API response */
export const ChatApiResponseSchema = z.object({
  text: z.string(),
})

/** ZK Bridge transaction response */
export const ZKBridgeTxResponseSchema = z.object({
  txHash: z.string(),
})
