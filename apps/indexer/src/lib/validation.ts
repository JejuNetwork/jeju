/**
 * Indexer validation schemas using Zod
 *
 * All API endpoints should use these schemas for input validation.
 * Fail-fast pattern: throw immediately on validation errors.
 *
 * Core validation helpers and schemas are imported from @jejunetwork/types/validation.
 * Indexer-specific schemas are defined locally.
 */

import { AddressSchema, HashSchema } from '@jejunetwork/types'
import { z } from 'zod'

// ============================================================================
// Re-export shared validation from @jejunetwork/types
// ============================================================================

export {
  // Core schemas
  AddressSchema,
  BigIntSchema,
  ChainIdSchema,
  CidSchema,
  // Validation helpers
  expect,
  expectAddress,
  expectBigInt,
  expectChainId,
  expectDefined,
  expectHex,
  expectJson,
  expectNonEmpty,
  expectNonEmptyString,
  expectNonNegative,
  expectPositive,
  expectTrue,
  expectValid,
  HashSchema,
  HexSchema,
  NonNegativeBigIntSchema,
  PositiveBigIntSchema,
  TimestampSchema,
  UrlSchema,
  validateOrNull,
  validateOrThrow,
} from '@jejunetwork/types'

// ============================================================================
// Pagination schema (defined locally as not exported from @jejunetwork/types)
// ============================================================================

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// ============================================================================
// Backwards-compatible aliases for local names
// ============================================================================

export const addressSchema = AddressSchema
export const hashSchema = HashSchema

// ============================================================================
// Indexer-specific Primitives
// ============================================================================

export const blockNumberSchema = z.number().int().positive()
export const bigIntStringSchema = z
  .string()
  .regex(/^\d+$/, 'Must be a string representation of a positive integer')

export type PaginationParams = z.infer<typeof paginationSchema>

// ============================================================================
// Search
// ============================================================================

export const endpointTypeSchema = z.enum([
  'a2a',
  'mcp',
  'rest',
  'graphql',
  'all',
])
export const serviceCategorySchema = z.enum([
  'agent',
  'workflow',
  'app',
  'game',
  'oracle',
  'marketplace',
  'compute',
  'storage',
  'all',
])

// REST API search params (query string format)
export const restSearchParamsSchema = z.object({
  q: z.string().optional(),
  type: endpointTypeSchema.optional(),
  tags: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').filter(Boolean) : undefined)),
  category: serviceCategorySchema.optional(),
  minTier: z.coerce.number().int().min(0).optional(),
  verified: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

// Internal search params (normalized format)
export const searchParamsSchema = z.object({
  query: z.string().optional(),
  endpointType: endpointTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  category: serviceCategorySchema.optional(),
  minStakeTier: z.number().int().min(0).optional(),
  verified: z.boolean().optional(),
  active: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export type SearchParams = z.infer<typeof searchParamsSchema>
export type EndpointType = z.infer<typeof endpointTypeSchema>
export type ServiceCategory = z.infer<typeof serviceCategorySchema>

// ============================================================================
// Agents
// ============================================================================

export const agentIdSchema = z
  .string()
  .regex(/^\d+$/, 'Agent ID must be a numeric string')
  .transform((val) => BigInt(val))
export const agentIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Agent ID must be a numeric string'),
})

export const agentsQuerySchema = paginationSchema.extend({
  active: z.coerce.boolean().optional(),
})

export const agentTagParamSchema = z.object({
  tag: z.string().min(1, 'Tag cannot be empty'),
})

// ============================================================================
// Blocks
// ============================================================================

export const blockNumberOrHashParamSchema = z.object({
  numberOrHash: z.string().refine((val) => {
    if (val.startsWith('0x')) {
      return /^0x[a-fA-F0-9]{64}$/.test(val)
    }
    return /^\d+$/.test(val) && parseInt(val, 10) > 0
  }, 'Must be a block number (positive integer) or block hash (0x followed by 64 hex chars)'),
})

export const blocksQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ============================================================================
// Transactions
// ============================================================================

export const transactionHashParamSchema = z.object({
  hash: hashSchema,
})

export const transactionsQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ============================================================================
// Accounts
// ============================================================================

export const accountAddressParamSchema = z.object({
  address: addressSchema,
})

// ============================================================================
// Contracts
// ============================================================================

export const contractTypeSchema = z.enum([
  'UNKNOWN',
  'ERC20',
  'ERC721',
  'ERC1155',
  'PROXY',
  'MULTISIG',
  'DEX',
  'LENDING',
  'NFT_MARKETPLACE',
  'GAME',
  'PREDICTION_MARKET',
  'GOVERNANCE',
])

export const contractsQuerySchema = paginationSchema.extend({
  type: contractTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ============================================================================
// Tokens
// ============================================================================

export const tokenTransfersQuerySchema = paginationSchema.extend({
  token: addressSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ============================================================================
// Nodes
// ============================================================================

export const nodesQuerySchema = paginationSchema.extend({
  active: z.coerce.boolean().optional(),
})

// ============================================================================
// Providers
// ============================================================================

export const providerTypeSchema = z.enum(['compute', 'storage'])

export const providersQuerySchema = paginationSchema.extend({
  type: providerTypeSchema.optional(),
})

// ============================================================================
// Containers
// ============================================================================

export const containersQuerySchema = paginationSchema.extend({
  verified: z.coerce.boolean().optional(),
  gpu: z.coerce.boolean().optional(),
  tee: z.coerce.boolean().optional(),
})

export const containerCidParamSchema = z.object({
  cid: z.string().min(1, 'CID cannot be empty'),
})

// ============================================================================
// Cross-Service Requests
// ============================================================================

export const crossServiceRequestStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
])
export const crossServiceRequestTypeSchema = z.enum([
  'TRANSFER',
  'COPY',
  'MIGRATE',
])

export const crossServiceRequestsQuerySchema = paginationSchema.extend({
  status: crossServiceRequestStatusSchema.optional(),
  type: crossServiceRequestTypeSchema.optional(),
})

// ============================================================================
// Oracle Feeds
// ============================================================================

export const oracleFeedCategorySchema = z.enum([
  'PRICE',
  'VOLUME',
  'LIQUIDITY',
  'METRICS',
  'CUSTOM',
])

export const oracleFeedsQuerySchema = paginationSchema.extend({
  category: oracleFeedCategorySchema.optional(),
  active: z.coerce.boolean().optional(),
})

export const oracleFeedIdParamSchema = z.object({
  feedId: z.string().min(1, 'Feed ID cannot be empty'),
})

// ============================================================================
// Oracle Operators
// ============================================================================

export const oracleOperatorsQuerySchema = paginationSchema.extend({
  active: z.coerce.boolean().optional(),
  jailed: z.coerce.boolean().optional(),
})

export const oracleOperatorAddressParamSchema = z.object({
  address: addressSchema,
})

// ============================================================================
// Oracle Reports
// ============================================================================

export const oracleReportsQuerySchema = paginationSchema.extend({
  feedId: z.string().optional(),
  disputed: z.coerce.boolean().optional(),
})

// ============================================================================
// Oracle Disputes
// ============================================================================

export const oracleDisputeStatusSchema = z.enum([
  'OPEN',
  'CHALLENGED',
  'RESOLVED',
  'EXPIRED',
])

export const oracleDisputesQuerySchema = paginationSchema.extend({
  status: oracleDisputeStatusSchema.optional(),
})

// ============================================================================
// A2A Request Validation
// ============================================================================

// A2A message part data can contain JSON-serializable values from external protocols
// Using primitive types that JSON can represent
export const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

export const a2aRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('message/send'),
  params: z.object({
    message: z.object({
      messageId: z.string().min(1),
      parts: z.array(
        z.object({
          kind: z.string(),
          text: z.string().optional(),
          data: z.record(z.string(), JsonValueSchema).optional(),
        }),
      ),
    }),
  }),
  id: z.union([z.number(), z.string()]),
})

export type A2ARequest = z.infer<typeof a2aRequestSchema>

// A2A skill params are JSON-serializable values
export const a2aSkillParamsSchema = z.record(z.string(), JsonValueSchema)

// Skill-specific schemas
export const getBlockSkillSchema = z
  .object({
    blockNumber: blockNumberSchema.optional(),
    blockHash: hashSchema.optional(),
  })
  .refine(
    (data) => data.blockNumber !== undefined || data.blockHash !== undefined,
    {
      message: 'Either blockNumber or blockHash must be provided',
    },
  )

export const getTransactionSkillSchema = z.object({
  hash: hashSchema,
})

export const getLogsSkillSchema = z.object({
  address: addressSchema.optional(),
  topics: z.array(z.string()).optional(),
  fromBlock: blockNumberSchema.optional(),
  toBlock: blockNumberSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})

export const getAccountSkillSchema = z.object({
  address: addressSchema,
})

export const getTokenBalancesSkillSchema = z.object({
  address: addressSchema,
})

export const getAgentSkillSchema = z.object({
  agentId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
})

export const getAgentsSkillSchema = z.object({
  role: z.string().optional(),
  active: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
})

export const getAgentReputationSkillSchema = z.object({
  agentId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
})

export const getIntentSkillSchema = z.object({
  intentId: z.string().min(1),
})

export const getSolverSkillSchema = z.object({
  address: addressSchema,
})

export const getProposalSkillSchema = z.object({
  proposalId: z.string().min(1),
})

export const getProposalsSkillSchema = z.object({
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

// ============================================================================
// MCP Request Validation
// ============================================================================

export const mcpResourceUriSchema = z.enum([
  'indexer://blocks/latest',
  'indexer://transactions/recent',
  'indexer://agents',
  'indexer://intents/active',
  'indexer://proposals/active',
  'indexer://stats/network',
  'indexer://stats/defi',
])

export const mcpResourceReadSchema = z.object({
  uri: mcpResourceUriSchema,
})

export const mcpToolCallSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), JsonValueSchema),
})

// MCP Prompt argument schemas
export const analyzeTransactionPromptArgsSchema = z.object({
  hash: hashSchema,
})

export const summarizeAgentActivityPromptArgsSchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  days: z.coerce.number().int().positive().optional().default(30),
})

export const explainProposalPromptArgsSchema = z.object({
  proposalId: z.string().min(1, 'proposalId is required'),
})

export const mcpPromptGetSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), JsonValueSchema),
})

// ============================================================================
// Indexer-specific Helper Functions
// These use ZodTypeAny generics for compatibility with indexer schemas
// ============================================================================

/**
 * Query string parameter type from HTTP frameworks (Express, Hono, etc.)
 * Express's ParsedQs allows nested objects and arrays.
 * Using an interface allows proper recursive typing.
 */
interface QueryParams {
  [key: string]: string | string[] | QueryParams | QueryParams[] | undefined
}

/**
 * Validates query parameters from Express/Hono request
 */
export function validateQuery<T extends z.ZodTypeAny>(
  schema: T,
  query: QueryParams,
  context?: string,
): z.infer<T> {
  const result = schema.safeParse(query)
  if (!result.success) {
    const errors = result.error.issues
      .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new Error(
      `Validation failed${context ? ` in ${context}` : ''}: ${errors}`,
    )
  }
  return result.data
}

/**
 * Path parameter type from HTTP frameworks (Express, Hono, etc.)
 * Path params are string values extracted from URL patterns.
 */
type PathParams = Record<string, string>

/**
 * Validates path parameters from Express/Hono request
 */
export function validateParams<T extends z.ZodTypeAny>(
  schema: T,
  params: PathParams,
  context?: string,
): z.infer<T> {
  const result = schema.safeParse(params)
  if (!result.success) {
    const errors = result.error.issues
      .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new Error(
      `Validation failed${context ? ` in ${context}` : ''}: ${errors}`,
    )
  }
  return result.data
}

/**
 * Validates request body from Express/Hono request.
 * Request body is JSON-parsed, so it contains JsonValue types.
 */
export function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  body: JsonValue,
  context?: string,
): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) {
    const errors = result.error.issues
      .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new Error(
      `Validation failed${context ? ` in ${context}` : ''}: ${errors}`,
    )
  }
  return result.data
}
