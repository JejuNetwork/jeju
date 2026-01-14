import {
  AddressSchema,
  expect as baseExpect,
  expectTrue,
  expectValid,
  JsonValueSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

// Validation Helpers

export const expect = baseExpect
export { expectTrue }

/** Parse and throw with context */
export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string,
): T {
  return expectValid(schema, data, context)
}

// Internal Schemas (not exported but used by exported schemas)

const BigIntStringSchema = z.string().regex(/^\d+$/, 'Must be numeric string')

const JsonObjectSchema = z.record(z.string(), JsonValueSchema)

// Agent Request Schemas

export const AgentIdParamSchema = z.object({
  agentId: z.coerce.number().int().positive(),
})

export const BotIdParamSchema = z.object({
  botId: z.coerce.number().int().positive(),
  agentId: z.coerce.number().int().positive().optional(),
})

// BigInt-compatible string schema (validates numeric strings that can be safely converted)
const BigIntStringParamSchema = z
  .string()
  .min(1)
  .regex(/^\d+$/, 'Must be a valid numeric string for BigInt conversion')

export const RoomIdParamSchema = z.object({
  roomId: BigIntStringParamSchema,
})

export const RegisterAgentRequestSchema = z.object({
  name: NonEmptyStringSchema,
  characterCid: NonEmptyStringSchema.optional(),
  botType: z.enum(['ai_agent', 'trading_bot', 'org_tool']).default('ai_agent'),
  // Extended fields for full agent registration
  character: z
    .object({
      id: z.string().optional(),
      name: z.string(),
      description: z.string().optional(),
      system: z.string().optional(),
      bio: z.array(z.string()).optional(),
      messageExamples: z
        .array(
          z.array(
            z.object({
              name: z.string(),
              content: z.object({ text: z.string() }),
            }),
          ),
        )
        .optional(),
      topics: z.array(z.string()).optional(),
      adjectives: z.array(z.string()).optional(),
      style: z
        .object({
          all: z.array(z.string()),
          chat: z.array(z.string()),
          post: z.array(z.string()),
        })
        .optional(),
    })
    .optional(),
  initialFunding: z.string().optional(),
  capabilities: z
    .object({
      canTrade: z.boolean().optional(),
      canChat: z.boolean().optional(),
      canPropose: z.boolean().optional(),
      canVote: z.boolean().optional(),
      canStake: z.boolean().optional(),
      a2a: z.boolean().optional(),
      compute: z.boolean().optional(),
    })
    .optional(),
  autonomous: z
    .object({
      enabled: z.boolean(),
      tickIntervalMs: z.number().int().positive().optional(),
      watchRoom: NonEmptyStringSchema.optional(),
      postToRoom: NonEmptyStringSchema.optional(),
    })
    .optional(),
})

export const AgentStartRequestSchema = z.object({
  // Numeric agent ID (for on-chain registered agents)
  agentId: z.coerce.number().int().positive().optional(),
  // Character CID or built-in character ID
  characterCid: NonEmptyStringSchema.optional(),
  characterId: NonEmptyStringSchema.optional(),
  // Autonomous agent config
  tickIntervalMs: z.number().int().positive().optional(),
  capabilities: z
    .object({
      canTrade: z.boolean().optional(),
      canChat: z.boolean().optional(),
      canPropose: z.boolean().optional(),
      canVote: z.boolean().optional(),
      canDelegate: z.boolean().optional(),
      canStake: z.boolean().optional(),
      canBridge: z.boolean().optional(),
      a2a: z.boolean().optional(),
      compute: z.boolean().optional(),
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

export const ToggleAutonomousRequestSchema = z.object({
  enabled: z.boolean(),
  tickIntervalMs: z.number().int().positive().optional(),
  watchRoom: NonEmptyStringSchema.optional(),
  postToRoom: NonEmptyStringSchema.optional(),
  capabilities: z
    .object({
      canTrade: z.boolean().optional(),
      canChat: z.boolean().optional(),
      canPropose: z.boolean().optional(),
      canVote: z.boolean().optional(),
      canDelegate: z.boolean().optional(),
      canStake: z.boolean().optional(),
      canBridge: z.boolean().optional(),
      a2a: z.boolean().optional(),
      compute: z.boolean().optional(),
    })
    .optional(),
})

// Room Request Schemas

export const CreateRoomRequestSchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().optional(),
  roomType: z
    .enum(['collaboration', 'adversarial', 'debate', 'board'])
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
  agentId: z.string().min(1), // Supports both numeric IDs and wallet addresses
})

export const SetPhaseRequestSchema = z.object({
  phase: z.enum(['setup', 'active', 'paused', 'completed', 'archived']),
})

export const RoomSearchQuerySchema = z.object({
  name: z.string().optional(),
  roomType: z
    .enum(['collaboration', 'adversarial', 'debate', 'board'])
    .optional(),
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
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
  capabilities: z
    .object({
      canTrade: z.boolean().optional(),
      canChat: z.boolean().optional(),
      canPropose: z.boolean().optional(),
      canVote: z.boolean().optional(),
      canStake: z.boolean().optional(),
      a2a: z.boolean().optional(),
      compute: z.boolean().optional(),
    })
    .optional(),
})

export const StorageUploadResponseSchema = z.object({
  cid: NonEmptyStringSchema,
  size: NonNegativeIntSchema.optional(),
})

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

// State Schemas (for storage)

const MemoryEntrySchema = z.object({
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

// MessageMetadata schema - must match lib/types.ts interface with JsonValue index signature
const MessageMetadataSchema = z
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

const RoomMessageSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  content: z.string(),
  timestamp: z.number(),
  action: z.string().nullable().optional(),
  metadata: MessageMetadataSchema.nullable().optional(),
})

const RoomStateMetadataSchema = z
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

// Type Exports

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
export type RoomSearchQuery = z.infer<typeof RoomSearchQuerySchema>
export type ChatApiResponse = z.infer<typeof ChatApiResponseSchema>
export type AgentCharacter = z.infer<typeof AgentCharacterSchema>
export type StorageUploadResponse = z.infer<typeof StorageUploadResponseSchema>
