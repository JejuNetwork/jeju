/**
 * SQLit Client with circuit breaker pattern
 *
 * Automatically uses network-aware configuration from @jejunetwork/config.
 * No env vars required - just set JEJU_NETWORK=localnet|testnet|mainnet.
 */

import {
  getSQLitMinerUrl,
  getSQLitUrl,
  getSQLitDatabaseId,
  getSQLitKeyId,
  getSQLitTimeout,
  getLogLevel,
  isSQLitDebug,
} from '@jejunetwork/config'
import { createPool, type Pool } from 'generic-pool'
import pino from 'pino'
import type { Address, Hex } from 'viem'
import { isAddress, toHex } from 'viem'
import { z } from 'zod'
import type {
  ACLRule,
  BlockProducerInfo,
  CreateRentalRequest,
  DatabaseConfig,
  DatabaseInfo,
  SQLitConfig,
  SQLitConnection,
  SQLitConnectionPool,
  SQLitTransaction,
  ExecResult,
  GrantRequest,
  QueryParam,
  QueryResult,
  RentalInfo,
  RentalPlan,
  RevokeRequest,
  VectorBatchInsertRequest,
  VectorIndexConfig,
  VectorInsertRequest,
  VectorSearchRequest,
  VectorSearchResult,
} from './types.js'
import {
  parseTimeout,
  validateSQLIdentifier,
  validateSQLIdentifiers,
} from './utils.js'
import {
  generateCreateVectorTableSQL,
  generateVectorInsertSQL,
  parseVectorSearchResults,
  serializeVector,
  validateVectorValues,
} from './vector.js'

const AddressSchema = z.custom<Address>(
  (val): val is Address => typeof val === 'string' && isAddress(val),
  { message: 'Invalid address' },
)

const QueryResponseSchema = z
  .object({
    rows: z.preprocess(
      (val) => (Array.isArray(val) ? val : []),
      z.array(
        z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.null()]),
        ),
      ),
    ),
    rowCount: z.preprocess(
      (val) => (typeof val === 'number' ? val : 0),
      z.number().int().nonnegative(),
    ),
    columns: z.preprocess(
      (val) => (Array.isArray(val) ? val : []),
      z.array(z.string()),
    ),
    blockHeight: z.preprocess(
      (val) => (typeof val === 'number' ? val : 0),
      z.number().int().nonnegative(),
    ),
    executionTime: z.number().int().nonnegative().optional(),
    success: z.boolean().optional(),
  })
  .passthrough()

const ExecResponseSchema = z
  .object({
    rowsAffected: z.number().int().nonnegative(),
    lastInsertId: z.string().optional(),
    txHash: z.string().min(1),
    blockHeight: z.number().int().nonnegative(),
    gasUsed: z.string().min(1),
    // Additional fields for dev mode compatibility
    success: z.boolean().optional(),
    executionTime: z.number().int().nonnegative().optional(),
  })
  .passthrough()

const DatabaseStatusSchema = z.enum([
  'creating',
  'running',
  'stopped',
  'migrating',
  'error',
])

const DatabaseInfoSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    owner: AddressSchema,
    nodeCount: z.number().int().positive(),
    consistencyMode: z.enum(['eventual', 'strong']),
    status: DatabaseStatusSchema,
    blockHeight: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
    monthlyCost: z.union([z.bigint(), z.string()]).transform((v) => BigInt(v)),
  })
  .strict()

const DatabaseListResponseSchema = z
  .object({
    databases: z.array(DatabaseInfoSchema),
  })
  .strict()

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

const ACLListResponseSchema = z
  .object({
    rules: z.array(ACLRuleSchema),
  })
  .strict()

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

const RentalPlanListResponseSchema = z
  .object({
    plans: z.array(RentalPlanSchema),
  })
  .strict()

const RentalInfoSchema = z
  .object({
    id: z.string().min(1),
    databaseId: z.string().min(1),
    renter: AddressSchema,
    planId: z.string().min(1),
    startedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    autoRenew: z.boolean(),
    paymentStatus: z.enum(['current', 'overdue', 'cancelled']),
  })
  .strict()

const BlockProducerInfoSchema = z
  .object({
    // Required fields
    blockHeight: z.number().int().nonnegative(),
    databases: z.number().int().nonnegative(),
    status: z.string(),
    // Optional fields (may not be present in dev mode)
    address: AddressSchema.optional(),
    endpoint: z.string().url().optional(),
    stake: z
      .union([z.bigint(), z.string()])
      .transform((v) => BigInt(v))
      .optional(),
    // Dev server fields
    type: z.string().optional(),
    nodeCount: z.number().int().nonnegative().optional(),
  })
  .passthrough()

const SQLitConfigSchema = z
  .object({
    blockProducerEndpoint: z.string().url(),
    minerEndpoint: z.string().url().optional(),
    keyId: z.string().min(1).optional(),
    privateKey: z
      .string()
      .regex(/^0x[a-fA-F0-9]+$/)
      .optional(),
    databaseId: z.string().min(1).optional(),
    timeout: z.number().int().positive().max(600000).optional(),
    debug: z.boolean().optional(),
  })
  .strict()

const log = pino({
  name: 'sqlit',
  level: getLogLevel(),
})

// Native Circuit Breaker implementation
interface CircuitState {
  state: 'closed' | 'open' | 'half-open'
  failures: number
  lastFailure: number
  halfOpenAttempts: number
}

const circuitState: CircuitState = {
  state: 'closed',
  failures: 0,
  lastFailure: 0,
  halfOpenAttempts: 0,
}

const circuitConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenRequests: 3,
}

class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open')
    this.name = 'CircuitOpenError'
  }
}

const circuitBreaker = {
  get opened() {
    return circuitState.state === 'open'
  },
  get halfOpen() {
    return circuitState.state === 'half-open'
  },
  stats: {
    get failures() {
      return circuitState.failures
    },
  },
  async fire<T>(fn: () => Promise<T>): Promise<T> {
    // Check state transitions
    if (circuitState.state === 'open') {
      if (Date.now() - circuitState.lastFailure >= circuitConfig.resetTimeout) {
        circuitState.state = 'half-open'
        circuitState.halfOpenAttempts = 0
        log.info('Circuit breaker half-open, attempting recovery')
      } else {
        throw new CircuitOpenError()
      }
    }

    if (circuitState.state === 'half-open') {
      if (circuitState.halfOpenAttempts >= circuitConfig.halfOpenRequests) {
        circuitState.state = 'open'
        log.warn('Circuit breaker opened')
        throw new CircuitOpenError()
      }
      circuitState.halfOpenAttempts++
    }

    try {
      const result = await fn()
      // Success - reset or close circuit
      if (circuitState.state === 'half-open') {
        circuitState.state = 'closed'
        circuitState.failures = 0
        log.info('Circuit breaker closed, service recovered')
      } else {
        circuitState.failures = 0
      }
      return result
    } catch (error) {
      circuitState.failures++
      circuitState.lastFailure = Date.now()

      if (circuitState.failures >= circuitConfig.failureThreshold) {
        circuitState.state = 'open'
        log.warn('Circuit breaker opened')
      }

      throw error
    }
  },
}

async function request<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
  options?: RequestInit,
): Promise<z.output<S>> {
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

class SQLitConnectionImpl implements SQLitConnection {
  id: string
  databaseId: string
  active = true
  private endpoint: string
  private timeout: number
  private debug: boolean

  constructor(id: string, databaseId: string, config: SQLitConfig) {
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

  async beginTransaction(): Promise<SQLitTransaction> {
    const txId = `tx-${crypto.randomUUID()}`
    await this.exec('BEGIN TRANSACTION')
    return new SQLitTransactionImpl(txId, this)
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

    const response = await fetch(`${this.endpoint}/v1/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assoc: true, ...payload }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const errorText = await response.text()
      if (this.debug)
        console.error(
          `[SQLit] ${type} error: ${response.status} - ${errorText}`,
        )
      throw new Error(`SQLit ${type} failed: ${response.status}`)
    }

    const rawResult: unknown = await response.json()
    const executionTime = Date.now() - startTime
    if (this.debug)
      console.log(
        `[SQLit] ${type}: executed (${executionTime}ms, params: ${params?.length ?? 0})`,
      )

    // SQLit returns HTTP 200 with success: false for errors
    if (
      typeof rawResult === 'object' &&
      rawResult !== null &&
      'success' in rawResult &&
      rawResult.success === false
    ) {
      const errorMsg =
        'error' in rawResult ? String(rawResult.error) : 'Unknown error'
      throw new Error(`SQLit ${type} failed: ${errorMsg}`)
    }

    if (type === 'query') {
      // Handle response wrapped in 'data' or 'result' field
      const responseData =
        typeof rawResult === 'object' && rawResult !== null
          ? 'data' in rawResult && typeof rawResult.data === 'object'
            ? rawResult.data
            : 'result' in rawResult && typeof rawResult.result === 'object'
              ? rawResult.result
              : rawResult
          : rawResult
      const parseResult = QueryResponseSchema.safeParse(responseData)
      if (!parseResult.success && this.debug) {
        console.error(
          `[SQLit] Query response validation failed:`,
          parseResult.error.issues,
          `\nRaw response:`,
          JSON.stringify(rawResult).slice(0, 500),
        )
      }
      const result = parseResult.success
        ? parseResult.data
        : { rows: [], rowCount: 0, columns: [], blockHeight: 0 }
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

class SQLitTransactionImpl implements SQLitTransaction {
  id: string
  private conn: SQLitConnectionImpl
  private done = false

  constructor(id: string, conn: SQLitConnectionImpl) {
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

class SQLitConnectionPoolImpl implements SQLitConnectionPool {
  private pool: Pool<SQLitConnectionImpl>

  constructor(config: SQLitConfig, dbId: string, maxSize = 10) {
    this.pool = createPool<SQLitConnectionImpl>(
      {
        create: async () => {
          const id = `conn-${crypto.randomUUID()}`
          return new SQLitConnectionImpl(id, dbId, config)
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

  async acquire(): Promise<SQLitConnection> {
    const conn = await this.pool.acquire()
    conn.active = true
    return conn
  }

  release(conn: SQLitConnection): void {
    const impl = conn as SQLitConnectionImpl
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

export class SQLitClient {
  private config: SQLitConfig
  private pools = new Map<string, SQLitConnectionPool>()
  private get endpoint() {
    return this.config.blockProducerEndpoint
  }

  constructor(config: SQLitConfig) {
    this.config = config
  }

  getPool(dbId: string): SQLitConnectionPool {
    let pool = this.pools.get(dbId)
    if (!pool) {
      pool = new SQLitConnectionPoolImpl(this.config, dbId)
      this.pools.set(dbId, pool)
    }
    return pool
  }

  async connect(dbId?: string): Promise<SQLitConnection> {
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

  async getBlockProducerInfo(): Promise<BlockProducerInfo> {
    return request(`${this.endpoint}/api/v1/status`, BlockProducerInfoSchema)
  }

  async isHealthy(): Promise<boolean> {
    const response = await circuitBreaker
      .fire(async () => {
        const res = await fetch(`${this.endpoint}/v1/status`, {
          signal: AbortSignal.timeout(5000),
        })
        return res
      })
      .catch(() => null)
    return response?.ok ?? false
  }

  getCircuitState(): {
    state: 'open' | 'closed' | 'half-open'
    failures: number
  } {
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

  // Vector Search Methods (powered by sqlite-vec)

  /**
   * Create a vector index (vec0 virtual table)
   *
   * @example
   * ```typescript
   * await sqlit.createVectorIndex({
   *   tableName: 'embeddings',
   *   dimensions: 384,
   *   metadataColumns: [
   *     { name: 'title', type: 'TEXT' },
   *     { name: 'source', type: 'TEXT' }
   *   ]
   * }, 'db-id')
   * ```
   */
  async createVectorIndex(
    config: VectorIndexConfig,
    dbId?: string,
  ): Promise<ExecResult> {
    const sql = generateCreateVectorTableSQL(config)
    return this.exec(sql, undefined, dbId)
  }

  /**
   * Insert a vector into a vec0 table
   *
   * @example
   * ```typescript
   * await sqlit.insertVector({
   *   tableName: 'embeddings',
   *   vector: [0.1, 0.2, 0.3, ...], // 384 dimensions
   *   metadata: { title: 'My Document', source: 'wiki' }
   * }, 'db-id')
   * ```
   */
  async insertVector(
    request: VectorInsertRequest,
    dbId?: string,
  ): Promise<ExecResult> {
    const { tableName, rowid, vector, metadata, partitionValue } = request

    validateVectorValues(vector)

    const blob = serializeVector(vector, 'float32')
    const params: QueryParam[] = []

    if (rowid !== undefined) {
      params.push(rowid)
    }
    params.push(blob)

    const metadataColumns = metadata ? Object.keys(metadata) : []
    if (metadata) {
      for (const key of metadataColumns) {
        const value = metadata[key]
        params.push(value === null ? null : (value as QueryParam))
      }
    }

    if (partitionValue !== undefined) {
      params.push(partitionValue as QueryParam)
    }

    const sql = generateVectorInsertSQL(
      tableName,
      rowid !== undefined,
      metadataColumns,
      partitionValue !== undefined ? 'partition_key' : undefined,
    )

    return this.exec(sql, params, dbId)
  }

  /**
   * Batch insert vectors into a vec0 table
   *
   * @example
   * ```typescript
   * await sqlit.insertVectorBatch({
   *   tableName: 'embeddings',
   *   vectors: [
   *     { vector: [...], metadata: { title: 'Doc 1' } },
   *     { vector: [...], metadata: { title: 'Doc 2' } },
   *   ]
   * }, 'db-id')
   * ```
   */
  async insertVectorBatch(
    request: VectorBatchInsertRequest,
    dbId?: string,
  ): Promise<ExecResult[]> {
    const results: ExecResult[] = []

    for (const item of request.vectors) {
      const result = await this.insertVector(
        {
          tableName: request.tableName,
          rowid: item.rowid,
          vector: item.vector,
          metadata: item.metadata,
          partitionValue: item.partitionValue,
        },
        dbId,
      )
      results.push(result)
    }

    return results
  }

  /**
   * Search for similar vectors using KNN
   *
   * @example
   * ```typescript
   * const results = await sqlit.searchVectors({
   *   tableName: 'embeddings',
   *   vector: queryEmbedding,
   *   k: 10,
   *   includeMetadata: true
   * }, 'db-id')
   *
   * for (const result of results) {
   *   console.log(`Row ${result.rowid}: distance ${result.distance}`)
   *   console.log(`  Title: ${result.metadata?.title}`)
   * }
   * ```
   */
  async searchVectors(
    request: VectorSearchRequest,
    dbId?: string,
    metadataColumns: string[] = [],
  ): Promise<VectorSearchResult[]> {
    const {
      tableName,
      vector,
      k,
      partitionValue,
      metadataFilter,
      includeMetadata,
    } = request

    // Validate inputs to prevent SQL injection
    validateSQLIdentifier(tableName, 'table')
    if (metadataColumns.length > 0) {
      validateSQLIdentifiers(metadataColumns, 'column')
    }
    if (!Number.isInteger(k) || k <= 0 || k > 10000) {
      throw new Error(
        `Invalid k value: ${k}, must be positive integer <= 10000`,
      )
    }

    validateVectorValues(vector)

    const blob = serializeVector(vector, 'float32')
    const params: QueryParam[] = [blob]

    if (partitionValue !== undefined) {
      params.push(partitionValue as QueryParam)
    }

    // Build SELECT columns
    const selectCols = ['rowid', 'distance']
    if (includeMetadata && metadataColumns.length > 0) {
      for (const col of metadataColumns) {
        selectCols.push(col)
      }
    }

    // sqlite-vec uses MATCH syntax for KNN
    let sql = `SELECT ${selectCols.join(', ')}
FROM ${tableName}
WHERE embedding MATCH ?
  AND k = ${k}`

    if (partitionValue !== undefined) {
      sql += '\n  AND partition_key = ?'
    }

    if (metadataFilter) {
      // Note: metadataFilter is caller-constructed SQL - callers must use parameters
      sql += `\n  AND ${metadataFilter}`
    }

    sql += '\nORDER BY distance'

    const result = await this.query<
      Record<string, string | number | boolean | null>
    >(sql, params, dbId)

    return parseVectorSearchResults(
      result.rows,
      includeMetadata ? metadataColumns : [],
    )
  }

  /**
   * Delete vectors from a vec0 table
   *
   * @example
   * ```typescript
   * await sqlit.deleteVectors('embeddings', [1, 2, 3], 'db-id')
   * ```
   */
  async deleteVectors(
    tableName: string,
    rowids: number[],
    dbId?: string,
  ): Promise<ExecResult> {
    validateSQLIdentifier(tableName, 'table')
    if (rowids.length === 0) {
      // No-op: nothing to delete
      return {
        rowsAffected: 0,
        txHash: '0x' as Hex,
        blockHeight: 0,
        gasUsed: 0n,
      }
    }
    const placeholders = rowids.map(() => '?').join(', ')
    const sql = `DELETE FROM ${tableName} WHERE rowid IN (${placeholders})`
    return this.exec(sql, rowids, dbId)
  }

  /**
   * Get vector count in a vec0 table
   */
  async getVectorCount(tableName: string, dbId?: string): Promise<number> {
    validateSQLIdentifier(tableName, 'table')
    const result = await this.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${tableName}`,
      undefined,
      dbId,
    )
    const firstRow = result.rows[0]
    if (!firstRow || typeof firstRow.count !== 'number') {
      throw new Error('Unexpected COUNT(*) result structure')
    }
    return firstRow.count
  }

  /**
   * Check if sqlite-vec extension is available
   */
  async checkVecExtension(
    dbId?: string,
  ): Promise<{ available: boolean; version?: string }> {
    const result = await this.query<{ version: string }>(
      `SELECT vec_version() as version`,
      undefined,
      dbId,
    ).catch(() => null)

    if (result?.rows[0]) {
      return { available: true, version: result.rows[0].version }
    }
    return { available: false }
  }
}

let sqlitClient: SQLitClient | null = null

const DEFAULT_TIMEOUT = 30000

/**
 * Get a SQLit client with automatic network-aware configuration.
 * Configuration is resolved in this order:
 * 1. Explicit config parameter
 * 2. Environment variable override
 * 3. Network-based config from services.json (based on JEJU_NETWORK)
 */
export function getSQLit(config?: Partial<SQLitConfig>): SQLitClient {
  if (!sqlitClient) {
    const blockProducerEndpoint =
      config?.blockProducerEndpoint ?? getSQLitUrl()
    const minerEndpoint = config?.minerEndpoint ?? getSQLitMinerUrl()

    if (!blockProducerEndpoint) {
      throw new Error(
        'SQLit blockProducerEndpoint is required. Set via config, SQLIT_BLOCK_PRODUCER_ENDPOINT env var, or JEJU_NETWORK.',
      )
    }

    // Support either KMS keyId (production) or privateKey (local development)
    const keyId = config?.keyId ?? getSQLitKeyId()
    const privateKey =
      config?.privateKey ??
      (process.env.SQLIT_PRIVATE_KEY as `0x${string}` | undefined)

    if (!keyId && !privateKey) {
      throw new Error(
        'SQLit requires either keyId (for KMS) or privateKey (for local dev). Set via config, SQLIT_KEY_ID, or SQLIT_PRIVATE_KEY env var.',
      )
    }

    const resolvedConfig: SQLitConfig = {
      blockProducerEndpoint,
      minerEndpoint,
      keyId,
      privateKey,
      databaseId: config?.databaseId ?? getSQLitDatabaseId(),
      timeout:
        config?.timeout ?? parseTimeout(getSQLitTimeout(), DEFAULT_TIMEOUT),
      debug: config?.debug ?? isSQLitDebug(),
    }

    const validated = SQLitConfigSchema.parse(resolvedConfig)

    sqlitClient = new SQLitClient(validated as SQLitConfig)
  }
  return sqlitClient
}

export async function resetSQLit(): Promise<void> {
  if (sqlitClient) {
    await sqlitClient.close()
    sqlitClient = null
  }
}
