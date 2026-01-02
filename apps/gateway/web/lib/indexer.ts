/**
 * Indexer GraphQL client with Zod validation
 *
 * Provides type-safe queries to the Jeju Network indexer
 */

import { z } from 'zod'
import { INDEXER_URL } from '../../lib/config'

// ============================================================================
// Common Schemas
// ============================================================================

export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)
export const HashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
export const BigIntStringSchema = z.string().regex(/^\d+$/)
export const TimestampSchema = z.string().datetime()

// ============================================================================
// Agent/Identity Schemas
// ============================================================================

export const AgentSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  owner: AddressSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  tokenURI: z.string().optional(),
  a2aEndpoint: z.string().optional(),
  mcpEndpoint: z.string().optional(),
  serviceType: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  stakeToken: AddressSchema.optional(),
  stakeAmount: BigIntStringSchema.optional(),
  isActive: z.boolean(),
  registeredAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
})

export type Agent = z.infer<typeof AgentSchema>

export const AgentsResponseSchema = z.object({
  agents: z.array(AgentSchema),
})

// ============================================================================
// Transaction Schemas
// ============================================================================

export const TransactionTypeSchema = z.enum([
  'transfer',
  'deposit',
  'withdraw',
  'stake',
  'unstake',
  'register',
  'claim',
  'bridge',
  'swap',
])

export const TransactionStatusSchema = z.enum([
  'pending',
  'confirmed',
  'failed',
])

export const TransactionSchema = z.object({
  id: z.string(),
  type: TransactionTypeSchema,
  hash: HashSchema,
  from: AddressSchema,
  to: AddressSchema.optional(),
  amount: BigIntStringSchema,
  tokenSymbol: z.string(),
  tokenAddress: AddressSchema.optional(),
  status: TransactionStatusSchema,
  timestamp: TimestampSchema,
  chainId: z.number().optional(),
  destinationChainId: z.number().optional(),
  blockNumber: z.number().optional(),
})

export type Transaction = z.infer<typeof TransactionSchema>

export const TransactionsResponseSchema = z.object({
  transactions: z.array(TransactionSchema),
})

// ============================================================================
// Voucher/XLP Schemas
// ============================================================================

export const VoucherStatusSchema = z.enum([
  'PENDING',
  'FULFILLED',
  'EXPIRED',
  'REFUNDED',
])

export const VoucherRequestSchema = z.object({
  requestId: z.string(),
  sourceAmount: BigIntStringSchema,
  sourceToken: AddressSchema,
  destinationToken: AddressSchema,
  destinationChain: z.number(),
  recipient: AddressSchema,
  status: VoucherStatusSchema,
  createdAt: TimestampSchema,
})

export const VoucherFulfillmentSchema = z.object({
  id: z.string(),
  voucherRequest: VoucherRequestSchema,
  feeEarned: BigIntStringSchema.optional(),
  fulfilledAt: TimestampSchema.optional(),
})

export type VoucherFulfillment = z.infer<typeof VoucherFulfillmentSchema>

export const VoucherHistoryResponseSchema = z.object({
  voucherFulfillments: z.array(VoucherFulfillmentSchema),
})

// ============================================================================
// EIL Stats Schemas
// ============================================================================

export const EILStatsSchema = z.object({
  totalBridged: BigIntStringSchema,
  totalFees: BigIntStringSchema,
  activeXLPs: z.number(),
  pendingVouchers: z.number(),
  fulfilledVouchers: z.number(),
  totalTransactions: z.number(),
})

export type EILStats = z.infer<typeof EILStatsSchema>

export const EILStatsResponseSchema = z.object({
  eilStats: EILStatsSchema.optional(),
  globalStats: z
    .object({
      totalBridgedVolume: BigIntStringSchema.optional(),
      totalFeesEarned: BigIntStringSchema.optional(),
      activeXLPCount: z.number().optional(),
      voucherStats: z
        .object({
          pending: z.number().optional(),
          fulfilled: z.number().optional(),
          total: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})

// ============================================================================
// Protocol Stats Schemas
// ============================================================================

export const ProtocolStatsSchema = z.object({
  totalRegistered: z.number(),
  activeAgents: z.number(),
  totalStaked: BigIntStringSchema,
  totalTransactions: z.number(),
})

export type ProtocolStats = z.infer<typeof ProtocolStatsSchema>

// ============================================================================
// GraphQL Client
// ============================================================================

interface GraphQLError {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: string[]
}

interface GraphQLResponse<T> {
  data?: T
  errors?: GraphQLError[]
}

export class IndexerError extends Error {
  constructor(
    message: string,
    public readonly errors?: GraphQLError[],
  ) {
    super(message)
    this.name = 'IndexerError'
  }
}

/**
 * Execute a GraphQL query against the indexer
 */
export async function query<T>(
  queryString: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: queryString,
      variables,
    }),
  })

  if (!response.ok) {
    throw new IndexerError(`Indexer request failed: ${response.statusText}`)
  }

  const result: GraphQLResponse<T> = await response.json()

  if (result.errors && result.errors.length > 0) {
    throw new IndexerError(result.errors[0].message, result.errors)
  }

  if (!result.data) {
    throw new IndexerError('No data returned from indexer')
  }

  return result.data
}

/**
 * Execute a GraphQL query with Zod validation
 */
export async function queryValidated<T>(
  queryString: string,
  schema: z.ZodType<T>,
  variables?: Record<string, unknown>,
): Promise<T> {
  const data = await query<unknown>(queryString, variables)
  const result = schema.safeParse(data)

  if (!result.success) {
    console.error('Indexer response validation failed:', result.error)
    throw new IndexerError(`Invalid indexer response: ${result.error.message}`)
  }

  return result.data
}

// ============================================================================
// Pre-built Queries
// ============================================================================

export const AGENTS_QUERY = `
  query Agents($offset: Int!, $limit: Int!) {
    agents(
      where: { isActive_eq: true }
      orderBy: registeredAt_DESC
      offset: $offset
      limit: $limit
    ) {
      id
      agentId
      owner
      name
      description
      tokenURI
      a2aEndpoint
      mcpEndpoint
      serviceType
      category
      tags
      stakeToken
      stakeAmount
      isActive
      registeredAt
      updatedAt
    }
  }
`

export const TRANSACTIONS_QUERY = `
  query UserTransactions($address: String!, $limit: Int!) {
    transactions(
      where: { from_eq: $address }
      orderBy: timestamp_DESC
      limit: $limit
    ) {
      id
      type
      hash
      from
      to
      amount
      tokenSymbol
      tokenAddress
      status
      timestamp
      chainId
      destinationChainId
      blockNumber
    }
  }
`

export const VOUCHER_HISTORY_QUERY = `
  query XLPVoucherHistory($xlp: String!, $limit: Int!) {
    voucherFulfillments(
      where: { xlp_eq: $xlp }
      orderBy: createdAt_DESC
      limit: $limit
    ) {
      id
      voucherRequest {
        requestId
        sourceAmount
        sourceToken
        destinationToken
        destinationChain
        recipient
        status
        createdAt
      }
      feeEarned
      fulfilledAt
    }
  }
`

export const EIL_STATS_QUERY = `
  query EILStats {
    globalStats {
      totalBridgedVolume
      totalFeesEarned
      activeXLPCount
      voucherStats {
        pending
        fulfilled
        total
      }
    }
  }
`

// ============================================================================
// Query Functions
// ============================================================================

export async function fetchAgents(offset = 0, limit = 50): Promise<Agent[]> {
  const result = await queryValidated(AGENTS_QUERY, AgentsResponseSchema, {
    offset,
    limit,
  })
  return result.agents
}

export async function fetchTransactions(
  address: string,
  limit = 50,
): Promise<Transaction[]> {
  const result = await queryValidated(
    TRANSACTIONS_QUERY,
    TransactionsResponseSchema,
    { address: address.toLowerCase(), limit },
  )
  return result.transactions
}

export async function fetchVoucherHistory(
  xlpAddress: string,
  limit = 50,
): Promise<VoucherFulfillment[]> {
  const result = await queryValidated(
    VOUCHER_HISTORY_QUERY,
    VoucherHistoryResponseSchema,
    { xlp: xlpAddress.toLowerCase(), limit },
  )
  return result.voucherFulfillments
}

export async function fetchEILStats(): Promise<EILStats | null> {
  const result = await queryValidated(
    EIL_STATS_QUERY,
    EILStatsResponseSchema,
    {},
  )

  if (!result.globalStats) return null

  return {
    totalBridged: result.globalStats.totalBridgedVolume ?? '0',
    totalFees: result.globalStats.totalFeesEarned ?? '0',
    activeXLPs: result.globalStats.activeXLPCount ?? 0,
    pendingVouchers: result.globalStats.voucherStats?.pending ?? 0,
    fulfilledVouchers: result.globalStats.voucherStats?.fulfilled ?? 0,
    totalTransactions: result.globalStats.voucherStats?.total ?? 0,
  }
}
