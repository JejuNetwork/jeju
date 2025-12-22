/**
 * CQL Eden Client
 *
 * Type-safe HTTP client for CovenantSQL API.
 */

import type { Address } from 'viem'
import { isAddress } from 'viem'
import { z } from 'zod'
import type {
  DatabaseConfig,
  DatabaseInfo,
  GrantRequest,
  QueryParam,
  RentalPlan,
  RevokeRequest,
} from './types.js'

// ============================================================================
// Zod Schemas for API Response Validation
// ============================================================================

const AddressSchema = z.custom<Address>(
  (val): val is Address => typeof val === 'string' && isAddress(val),
  { message: 'Invalid address' },
)

/** SQL row value type - matches what databases can return */
const SQLRowValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

const CQLQueryResponseSchema = z
  .object({
    rows: z.array(z.record(z.string(), SQLRowValueSchema)),
    rowCount: z.number().int().nonnegative(),
    columns: z.array(z.string()),
    blockHeight: z.number().int().nonnegative(),
  })
  .strict()

const CQLExecResponseSchema = z
  .object({
    rowsAffected: z.number().int().nonnegative(),
    lastInsertId: z.string().optional(),
    txHash: z.string().min(1),
    blockHeight: z.number().int().nonnegative(),
    gasUsed: z.string().min(1),
  })
  .strict()

const DatabaseStatusSchema = z.enum([
  'creating',
  'running',
  'stopped',
  'migrating',
  'error',
])

const DatabaseInfoSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  owner: AddressSchema,
  nodeCount: z.number().int().positive(),
  consistencyMode: z.enum(['eventual', 'strong']),
  status: DatabaseStatusSchema,
  blockHeight: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  monthlyCost: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
})

const CQLDatabaseListResponseSchema = z
  .object({
    databases: z.array(DatabaseInfoSchema),
    total: z.number().int().nonnegative(),
  })
  .strict()

const CQLCreateDatabaseResponseSchema = z.object({
  id: z.string(),
  dsn: z.string(),
  owner: AddressSchema,
})

const CQLHealthResponseSchema = z
  .object({
    status: z.string().min(1),
    version: z.string().min(1),
    uptime: z.number().nonnegative(),
    databases: z.number().int().nonnegative(),
  })
  .strict()

const RentalPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodeCount: z.number().int().positive(),
  storageBytes: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  queriesPerMonth: z
    .union([z.bigint(), z.string()])
    .transform((v) => BigInt(v)),
  pricePerMonth: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  paymentToken: AddressSchema,
})

const CQLPlanListResponseSchema = z
  .object({
    plans: z.array(RentalPlanSchema),
  })
  .strict()

// ============================================================================
// API Response Types (inferred from schemas)
// ============================================================================

/** SQL row value - primitive types that databases return */
export type SQLRowValue = string | number | boolean | null

/**
 * CQL API response types
 */
export interface CQLQueryResponse {
  rows: Record<string, SQLRowValue>[]
  rowCount: number
  columns: string[]
  blockHeight: number
}

export interface CQLExecResponse {
  rowsAffected: number
  lastInsertId?: string
  txHash: string
  blockHeight: number
  gasUsed: string
}

export interface CQLDatabaseListResponse {
  databases: DatabaseInfo[]
  total: number
}

export interface CQLCreateDatabaseResponse {
  id: string
  dsn: string
  owner: Address
}

export interface CQLHealthResponse {
  status: string
  version: string
  uptime: number
  databases: number
}

export interface CQLPlanListResponse {
  plans: RentalPlan[]
}

/**
 * CQL Eden Client with typed fetch wrappers
 */
export class CQLEdenClient {
  private endpoint: string
  private timeout: number

  constructor(endpoint: string, timeout = 30000) {
    this.endpoint = endpoint.replace(/\/$/, '')
    this.timeout = timeout
  }

  private async fetchAndValidate<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`CQL API error (${response.status}): ${error}`)
    }

    const rawData: unknown = await response.json()
    return schema.parse(rawData)
  }

  private async fetchVoid(path: string, options?: RequestInit): Promise<void> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`CQL API error (${response.status}): ${error}`)
    }
  }

  async checkHealth(): Promise<CQLHealthResponse | null> {
    const response = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (!response?.ok) return null
    const rawData: unknown = await response.json()
    return CQLHealthResponseSchema.parse(rawData)
  }

  async query(
    databaseId: string,
    sql: string,
    params?: QueryParam[],
    owner?: Address,
  ): Promise<CQLQueryResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (owner) headers['x-jeju-address'] = owner

    return this.fetchAndValidate('/api/v1/query', CQLQueryResponseSchema, {
      method: 'POST',
      headers,
      body: JSON.stringify({ databaseId, sql, params }),
    })
  }

  async exec(
    databaseId: string,
    sql: string,
    params?: QueryParam[],
    owner?: Address,
  ): Promise<CQLExecResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (owner) headers['x-jeju-address'] = owner

    return this.fetchAndValidate('/api/v1/exec', CQLExecResponseSchema, {
      method: 'POST',
      headers,
      body: JSON.stringify({ databaseId, sql, params }),
    })
  }

  async listDatabases(owner?: Address): Promise<CQLDatabaseListResponse> {
    const headers: Record<string, string> = {}
    if (owner) headers['x-jeju-address'] = owner

    return this.fetchAndValidate(
      '/api/v1/databases',
      CQLDatabaseListResponseSchema,
      {
        headers,
      },
    )
  }

  async createDatabase(
    config: DatabaseConfig,
    owner: Address,
  ): Promise<CQLCreateDatabaseResponse> {
    return this.fetchAndValidate(
      '/api/v1/databases',
      CQLCreateDatabaseResponseSchema,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': owner,
        },
        body: JSON.stringify(config),
      },
    )
  }

  async getDatabase(databaseId: string): Promise<DatabaseInfo> {
    return this.fetchAndValidate(
      `/api/v1/databases/${databaseId}`,
      DatabaseInfoSchema,
    )
  }

  async deleteDatabase(databaseId: string, owner: Address): Promise<void> {
    return this.fetchVoid(`/api/v1/databases/${databaseId}`, {
      method: 'DELETE',
      headers: { 'x-jeju-address': owner },
    })
  }

  async grant(request: GrantRequest, owner: Address): Promise<void> {
    return this.fetchVoid('/api/v1/acl/grant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify(request),
    })
  }

  async revoke(request: RevokeRequest, owner: Address): Promise<void> {
    return this.fetchVoid('/api/v1/acl/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify(request),
    })
  }

  async listPlans(): Promise<CQLPlanListResponse> {
    return this.fetchAndValidate('/api/v1/plans', CQLPlanListResponseSchema)
  }

  getEndpoint(): string {
    return this.endpoint
  }
}

let cqlClient: CQLEdenClient | null = null

export function getCQLEdenClient(endpoint?: string): CQLEdenClient {
  const cqlEndpoint = endpoint ?? process.env.CQL_ENDPOINT
  if (!cqlEndpoint) {
    throw new Error('CQL_ENDPOINT is required')
  }

  if (!cqlClient || cqlClient.getEndpoint() !== cqlEndpoint) {
    cqlClient = new CQLEdenClient(cqlEndpoint)
  }
  return cqlClient
}

export function resetCQLEdenClient(): void {
  cqlClient = null
}
