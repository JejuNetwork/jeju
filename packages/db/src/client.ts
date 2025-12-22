/**
 * CovenantSQL Client with circuit breaker pattern
 *
 * Automatically uses network-aware configuration from @jejunetwork/config.
 * No env vars required - just set JEJU_NETWORK=localnet|testnet|mainnet.
 */

import { getCQLMinerUrl, getCQLUrl } from '@jejunetwork/config'
import { createPool, type Pool } from 'generic-pool'
import CircuitBreakerLib from 'opossum'
import pino from 'pino'
import type { Address, Hex } from 'viem'
import { isAddress, isHex, toHex } from 'viem'
import { z } from 'zod'
import type {
  ACLRule,
  BlockProducerInfo,
  CQLConfig,
  CQLConnection,
  CQLConnectionPool,
  CQLTransaction,
  CreateRentalRequest,
  DatabaseConfig,
  DatabaseInfo,
  ExecResult,
  GrantRequest,
  QueryParam,
  QueryResult,
  RentalInfo,
  RentalPlan,
  RevokeRequest,
} from './types.js'
import { parseTimeout } from './utils.js'

const HexSchema = z.custom<Hex>(
  (val): val is Hex => typeof val === 'string' && isHex(val),
  { message: 'Invalid hex string' },
)

const AddressSchema = z.custom<Address>(
  (val): val is Address => typeof val === 'string' && isAddress(val),
  { message: 'Invalid address' },
)

// Zod schemas for API response validation
const QueryResponseSchema = z.object({
  rows: z.array(z.object({}).passthrough()),
  rowCount: z.number(),
  columns: z.array(z.string()),
  blockHeight: z.number(),
})

const ExecResponseSchema = z.object({
  rowsAffected: z.number(),
  lastInsertId: z.string().optional(),
  txHash: z.string(),
  blockHeight: z.number(),
  gasUsed: z.string(),
})

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
  nodeCount: z.number(),
  consistencyMode: z.enum(['eventual', 'strong']),
  status: DatabaseStatusSchema,
  blockHeight: z.number(),
  sizeBytes: z.number(),
  monthlyCost: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
})

const DatabaseListResponseSchema = z.object({
  databases: z.array(DatabaseInfoSchema),
})

const ACLPermissionSchema = z.enum([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'ALL',
])

const ACLRuleSchema = z.object({
  grantee: z.union([AddressSchema, z.literal('*')]),
  table: z.string(),
  columns: z.union([z.array(z.string()), z.literal('*')]),
  permissions: z.array(ACLPermissionSchema),
  condition: z.string().optional(),
})

const ACLListResponseSchema = z.object({
  rules: z.array(ACLRuleSchema),
})

const RentalPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodeCount: z.number(),
  storageBytes: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  queriesPerMonth: z
    .union([z.bigint(), z.string()])
    .transform((v) => BigInt(v)),
  pricePerMonth: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  paymentToken: AddressSchema,
})

const RentalPlanListResponseSchema = z.object({
  plans: z.array(RentalPlanSchema),
})

const RentalInfoSchema = z.object({
  id: z.string(),
  databaseId: z.string(),
  renter: AddressSchema,
  planId: z.string(),
  startedAt: z.number(),
  expiresAt: z.number(),
  autoRenew: z.boolean(),
  paymentStatus: z.enum(['current', 'overdue', 'cancelled']),
})

const BlockProducerInfoSchema = z.object({
  address: AddressSchema,
  endpoint: z.string(),
  blockHeight: z.number(),
  databases: z.number(),
  stake: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  status: z.enum(['active', 'syncing', 'offline']),
})

// Zod schema for CQL config validation
const CQLConfigSchema = z.object({
  blockProducerEndpoint: z.string().url(),
  minerEndpoint: z.string().url().optional(),
  privateKey: HexSchema.optional(),
  databaseId: z.string().min(1).optional(),
  timeout: z.number().int().positive().optional(),
  debug: z.boolean().optional(),
})

// Structured logger using pino
const log = pino({
  name: 'cql',
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
})

// Circuit breaker using opossum
const circuitBreakerOptions = {
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
}

// Typed circuit breaker that wraps async functions
type CircuitBreakerAction<T> = () => Promise<T>
const circuitBreaker = new CircuitBreakerLib<
  [CircuitBreakerAction<Response>],
  Response
>(async (fn: CircuitBreakerAction<Response>) => fn(), circuitBreakerOptions)

circuitBreaker.on('open', () => log.warn('Circuit breaker opened'))
circuitBreaker.on('halfOpen', () =>
  log.info('Circuit breaker half-open, attempting recovery'),
)
circuitBreaker.on('close', () =>
  log.info('Circuit breaker closed, service recovered'),
)

async function request<T>(
  url: string,
  schema: z.ZodSchema<T>,
  options?: RequestInit,
): Promise<T> {
  const response = await circuitBreaker.fire(async () => {
    const res = await fetch(url, options)
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    return res
  })
  const rawData: unknown = await response.json()
  return schema.parse(rawData)
}

async function requestVoid(url: string, options?: RequestInit): Promise<void> {
  await circuitBreaker.fire(async () => {
    const response = await fetch(url, options)
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    return response
  })
}

class CQLConnectionImpl implements CQLConnection {
  id: string
  databaseId: string
  active = true
  private endpoint: string
  private timeout: number
  private debug: boolean

  constructor(id: string, databaseId: string, config: CQLConfig) {
    this.id = id
    this.databaseId = databaseId
    this.endpoint = config.minerEndpoint ?? config.blockProducerEndpoint
    this.timeout = config.timeout ?? 30000
    this.debug = config.debug ?? false
  }

  async query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>> {
    return this.execute('query', sql, params) as Promise<QueryResult<T>>
  }

  async exec(sql: string, params?: QueryParam[]): Promise<ExecResult> {
    return this.execute('exec', sql, params) as Promise<ExecResult>
  }

  async beginTransaction(): Promise<CQLTransaction> {
    const txId = `tx-${crypto.randomUUID()}`
    await this.exec('BEGIN TRANSACTION')
    return new CQLTransactionImpl(txId, this)
  }

  async close(): Promise<void> {
    this.active = false
  }

  private async execute(
    type: 'query' | 'exec',
    sql: string,
    params?: QueryParam[],
  ): Promise<QueryResult<unknown> | ExecResult> {
    const startTime = Date.now()
    const payload = {
      database: this.databaseId,
      type,
      sql,
      params: params?.map((p) =>
        p === null || p === undefined
          ? null
          : typeof p === 'bigint'
            ? p.toString()
            : p instanceof Uint8Array
              ? toHex(p)
              : p,
      ),
      timestamp: Date.now(),
    }

    const response = await fetch(`${this.endpoint}/api/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      // Log full error for debugging, but don't expose to callers to prevent info leak
      const errorText = await response.text()
      if (this.debug)
        console.error(`[CQL] ${type} error: ${response.status} - ${errorText}`)
      throw new Error(`CQL ${type} failed: ${response.status}`)
    }

    const rawResult = await response.json()
    const executionTime = Date.now() - startTime
    // Log query type and timing without exposing potentially sensitive SQL content
    if (this.debug)
      console.log(
        `[CQL] ${type}: query executed (${executionTime}ms, params: ${params?.length ?? 0})`,
      )

    if (type === 'query') {
      const result = QueryResponseSchema.parse(rawResult)
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        columns: result.columns.map((name) => ({
          name,
          type: 'TEXT' as const,
          nullable: true,
          primaryKey: false,
          autoIncrement: false,
        })),
        executionTime,
        blockHeight: result.blockHeight,
      }
    } else {
      const result = ExecResponseSchema.parse(rawResult)
      return {
        rowsAffected: result.rowsAffected,
        lastInsertId: result.lastInsertId
          ? BigInt(result.lastInsertId)
          : undefined,
        txHash: result.txHash as Hex,
        blockHeight: result.blockHeight,
        gasUsed: BigInt(result.gasUsed),
      }
    }
  }
}

class CQLTransactionImpl implements CQLTransaction {
  id: string
  private conn: CQLConnectionImpl
  private done = false

  constructor(id: string, conn: CQLConnectionImpl) {
    this.id = id
    this.conn = conn
  }

  async query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>> {
    if (this.done) throw new Error('Transaction completed')
    return this.conn.query<T>(sql, params)
  }

  async exec(sql: string, params?: QueryParam[]): Promise<ExecResult> {
    if (this.done) throw new Error('Transaction completed')
    return this.conn.exec(sql, params)
  }

  async commit(): Promise<void> {
    if (this.done) throw new Error('Transaction completed')
    await this.conn.exec('COMMIT')
    this.done = true
  }

  async rollback(): Promise<void> {
    if (this.done) return
    await this.conn.exec('ROLLBACK')
    this.done = true
  }
}

class CQLConnectionPoolImpl implements CQLConnectionPool {
  private pool: Pool<CQLConnectionImpl>

  constructor(config: CQLConfig, dbId: string, maxSize = 10) {
    this.pool = createPool<CQLConnectionImpl>(
      {
        create: async () => {
          const id = `conn-${crypto.randomUUID()}`
          return new CQLConnectionImpl(id, dbId, config)
        },
        destroy: async (conn) => {
          await conn.close()
        },
        validate: async (conn) => conn.active,
      },
      {
        max: maxSize,
        min: 2,
        acquireTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
      },
    )
  }

  async acquire(): Promise<CQLConnection> {
    const conn = await this.pool.acquire()
    conn.active = true
    return conn
  }

  release(conn: CQLConnection): void {
    const impl = conn as CQLConnectionImpl
    impl.active = false
    this.pool.release(impl)
  }

  async close(): Promise<void> {
    await this.pool.drain()
    await this.pool.clear()
  }

  stats() {
    return {
      active: this.pool.borrowed,
      idle: this.pool.available,
      total: this.pool.size,
    }
  }
}

export class CQLClient {
  private config: CQLConfig
  private pools = new Map<string, CQLConnectionPool>()
  private get endpoint() {
    return this.config.blockProducerEndpoint
  }

  constructor(config: CQLConfig) {
    this.config = config
  }

  getPool(dbId: string): CQLConnectionPool {
    let pool = this.pools.get(dbId)
    if (!pool) {
      pool = new CQLConnectionPoolImpl(this.config, dbId)
      this.pools.set(dbId, pool)
    }
    return pool
  }

  async connect(dbId?: string): Promise<CQLConnection> {
    const id = dbId ?? this.config.databaseId
    if (!id) throw new Error('Database ID required')
    return this.getPool(id).acquire()
  }

  async query<T>(
    sql: string,
    params?: QueryParam[],
    dbId?: string,
  ): Promise<QueryResult<T>> {
    const conn = await this.connect(dbId)
    try {
      return await conn.query<T>(sql, params)
    } finally {
      this.getPool(conn.databaseId).release(conn)
    }
  }

  async exec(
    sql: string,
    params?: QueryParam[],
    dbId?: string,
  ): Promise<ExecResult> {
    const conn = await this.connect(dbId)
    try {
      return await conn.exec(sql, params)
    } finally {
      this.getPool(conn.databaseId).release(conn)
    }
  }

  // Database Management
  async createDatabase(config: DatabaseConfig): Promise<DatabaseInfo> {
    return request(`${this.endpoint}/api/v1/databases`, DatabaseInfoSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeCount: config.nodeCount,
        useEventualConsistency: config.useEventualConsistency ?? false,
        regions: config.regions,
        schema: config.schema,
        owner: config.owner,
        paymentToken: config.paymentToken,
      }),
    })
  }

  async getDatabase(id: string): Promise<DatabaseInfo> {
    return request(
      `${this.endpoint}/api/v1/databases/${id}`,
      DatabaseInfoSchema,
    )
  }

  async listDatabases(owner: Address): Promise<DatabaseInfo[]> {
    const response = await request(
      `${this.endpoint}/api/v1/databases?owner=${owner}`,
      DatabaseListResponseSchema,
    )
    return response.databases
  }

  async deleteDatabase(id: string): Promise<void> {
    return requestVoid(`${this.endpoint}/api/v1/databases/${id}`, {
      method: 'DELETE',
    })
  }

  // Access Control
  async grant(dbId: string, req: GrantRequest): Promise<void> {
    return requestVoid(`${this.endpoint}/api/v1/databases/${dbId}/acl/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
  }

  async revoke(dbId: string, req: RevokeRequest): Promise<void> {
    return requestVoid(`${this.endpoint}/api/v1/databases/${dbId}/acl/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
  }

  async listACL(dbId: string): Promise<ACLRule[]> {
    const response = await request(
      `${this.endpoint}/api/v1/databases/${dbId}/acl`,
      ACLListResponseSchema,
    )
    return response.rules
  }

  // Rental Management
  async listPlans(): Promise<RentalPlan[]> {
    const response = await request(
      `${this.endpoint}/api/v1/plans`,
      RentalPlanListResponseSchema,
    )
    return response.plans
  }

  async createRental(req: CreateRentalRequest): Promise<RentalInfo> {
    return request(`${this.endpoint}/api/v1/rentals`, RentalInfoSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
  }

  async getRental(id: string): Promise<RentalInfo> {
    return request(`${this.endpoint}/api/v1/rentals/${id}`, RentalInfoSchema)
  }

  async extendRental(id: string, months: number): Promise<RentalInfo> {
    return request(
      `${this.endpoint}/api/v1/rentals/${id}/extend`,
      RentalInfoSchema,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months }),
      },
    )
  }

  async cancelRental(id: string): Promise<void> {
    return requestVoid(`${this.endpoint}/api/v1/rentals/${id}`, {
      method: 'DELETE',
    })
  }

  // Status
  async getBlockProducerInfo(): Promise<BlockProducerInfo> {
    return request(`${this.endpoint}/api/v1/status`, BlockProducerInfoSchema)
  }

  async isHealthy(): Promise<boolean> {
    const response = await circuitBreaker
      .fire(async () => {
        const res = await fetch(`${this.endpoint}/health`, {
          signal: AbortSignal.timeout(5000),
        })
        return res
      })
      .catch(() => null)
    return response?.ok ?? false
  }

  getCircuitState() {
    return {
      state: circuitBreaker.opened
        ? 'open'
        : circuitBreaker.halfOpen
          ? 'half-open'
          : 'closed',
      failures: circuitBreaker.stats.failures,
    }
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.pools.values()).map((p) => p.close()))
    this.pools.clear()
  }
}

let cqlClient: CQLClient | null = null

const DEFAULT_TIMEOUT = 30000

/**
 * Get a CQL client with automatic network-aware configuration.
 * Configuration is resolved in this order:
 * 1. Explicit config parameter
 * 2. Environment variable override
 * 3. Network-based config from services.json (based on JEJU_NETWORK)
 */
export function getCQL(config?: Partial<CQLConfig>): CQLClient {
  if (!cqlClient) {
    const blockProducerEndpoint = config?.blockProducerEndpoint ?? getCQLUrl()
    const minerEndpoint = config?.minerEndpoint ?? getCQLMinerUrl()

    if (!blockProducerEndpoint) {
      throw new Error(
        'CQL blockProducerEndpoint is required. Set via config, CQL_BLOCK_PRODUCER_ENDPOINT env var, or JEJU_NETWORK.',
      )
    }

    const resolvedConfig = {
      blockProducerEndpoint,
      minerEndpoint,
      privateKey:
        config?.privateKey ?? (process.env.CQL_PRIVATE_KEY as Hex | undefined),
      databaseId: config?.databaseId ?? process.env.CQL_DATABASE_ID,
      timeout:
        config?.timeout ??
        parseTimeout(process.env.CQL_TIMEOUT, DEFAULT_TIMEOUT),
      debug: config?.debug ?? process.env.CQL_DEBUG === 'true',
    }

    // Validate the resolved config
    const validated = CQLConfigSchema.parse(resolvedConfig)

    cqlClient = new CQLClient(validated as CQLConfig)
  }
  return cqlClient
}

export async function resetCQL(): Promise<void> {
  if (cqlClient) {
    await cqlClient.close()
    cqlClient = null
  }
}

export { CQLClient as CovenantSQLClient }
