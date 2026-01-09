/**
 * SQLit v2 Client
 *
 * TypeScript client for connecting to SQLit v2 nodes.
 * Supports connection pooling, automatic failover, and
 * read-your-writes consistency.
 */

import type { Hex } from 'viem'
import type {
  BatchExecuteResponse,
  CreateDatabaseRequest,
  CreateDatabaseResponse,
  ExecuteResponse,
} from './types'
import { SQLitError, SQLitErrorCode } from './types'

export interface SQLitClientConfig {
  /** Primary endpoint URL */
  endpoint: string
  /** Database ID */
  databaseId: string
  /** Fallback endpoints for failover */
  fallbackEndpoints?: string[]
  /** Request timeout in milliseconds */
  timeoutMs?: number
  /** Session ID for read-your-writes consistency */
  sessionId?: string
  /** Operator signature for authenticated queries */
  signature?: Hex
  /** Enable debug logging */
  debug?: boolean
}

export interface QueryOptions {
  /** Request timeout override */
  timeoutMs?: number
  /** Required WAL position for strong consistency */
  requiredWalPosition?: bigint
  /** Query type hint */
  queryType?: 'read' | 'write' | 'ddl'
}

interface APIResponse<T> {
  success: boolean
  status?: string
  error?: string
  code?: string
  data?: T
}

/**
 * SQLit v2 Client
 */
export class SQLitClient {
  private config: Required<
    Pick<SQLitClientConfig, 'endpoint' | 'databaseId' | 'timeoutMs'>
  > &
    SQLitClientConfig
  private lastWalPosition: bigint = BigInt(0)
  private currentEndpointIndex = 0

  constructor(config: SQLitClientConfig) {
    this.config = {
      timeoutMs: 30000,
      fallbackEndpoints: [],
      ...config,
    }
  }

  // ============ Query API ============

  /**
   * Execute a SELECT query and return rows
   */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
    options?: QueryOptions,
  ): Promise<T[]> {
    const result = await this.execute(sql, params, {
      ...options,
      queryType: 'read',
    })
    return result.rows as T[]
  }

  /**
   * Execute a single row query
   */
  async queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
    options?: QueryOptions,
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params, options)
    return rows[0] ?? null
  }

  /**
   * Execute a write query (INSERT, UPDATE, DELETE)
   */
  async run(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
    options?: QueryOptions,
  ): Promise<{ rowsAffected: number; lastInsertId: bigint }> {
    const result = await this.execute(sql, params, {
      ...options,
      queryType: 'write',
    })
    return {
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
    }
  }

  /**
   * Execute a raw SQL query
   */
  async execute(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
    options?: QueryOptions,
  ): Promise<ExecuteResponse> {
    const endpoint = this.getCurrentEndpoint()
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs

    const body = {
      databaseId: this.config.databaseId,
      sql,
      params: params?.map((p) => (typeof p === 'bigint' ? p.toString() : p)),
      queryType: options?.queryType,
      sessionId: this.config.sessionId,
      requiredWalPosition: options?.requiredWalPosition?.toString(),
      signature: this.config.signature,
      timestamp: Date.now(),
    }

    try {
      const response = await fetch(`${endpoint}/v2/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })

      const result = (await response.json()) as APIResponse<ExecuteResponse> &
        ExecuteResponse

      if (!result.success) {
        throw new SQLitError(
          result.error ?? 'Query failed',
          (result.code as string) ?? SQLitErrorCode.DATABASE_UNAVAILABLE,
        )
      }

      // Update WAL position for consistency tracking
      if (result.walPosition) {
        this.lastWalPosition = BigInt(result.walPosition)
      }

      return result
    } catch (error) {
      // Try failover
      if (this.config.fallbackEndpoints?.length) {
        return this.executeWithFailover(sql, params, options)
      }
      throw error
    }
  }

  /**
   * Execute a batch of queries
   */
  async batch(
    queries: Array<{
      sql: string
      params?: (string | number | boolean | null | bigint)[]
    }>,
    transactional = true,
  ): Promise<BatchExecuteResponse> {
    const endpoint = this.getCurrentEndpoint()

    const body = {
      databaseId: this.config.databaseId,
      queries: queries.map((q) => ({
        sql: q.sql,
        params: q.params?.map((p) =>
          typeof p === 'bigint' ? p.toString() : p,
        ),
      })),
      transactional,
    }

    const response = await fetch(`${endpoint}/v2/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    const result =
      (await response.json()) as APIResponse<BatchExecuteResponse> &
        BatchExecuteResponse

    if (!result.success) {
      throw new SQLitError(
        result.error ?? 'Batch query failed',
        (result.code as string) ?? SQLitErrorCode.DATABASE_UNAVAILABLE,
      )
    }

    if (result.walPosition) {
      this.lastWalPosition = BigInt(result.walPosition)
    }

    return result
  }

  // ============ Transaction API ============

  /**
   * Begin a transaction and execute callback
   */
  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    await this.execute('BEGIN TRANSACTION')
    const tx = new TransactionClient(this)

    try {
      const result = await fn(tx)
      await this.execute('COMMIT')
      return result
    } catch (error) {
      await this.execute('ROLLBACK')
      throw error
    }
  }

  // ============ Database Management ============

  /**
   * Create a new database
   */
  async createDatabase(
    request: CreateDatabaseRequest,
  ): Promise<CreateDatabaseResponse> {
    const endpoint = this.getCurrentEndpoint()

    const response = await fetch(`${endpoint}/v2/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    const result =
      (await response.json()) as APIResponse<CreateDatabaseResponse> &
        CreateDatabaseResponse

    if (!result.success) {
      throw new SQLitError(
        result.error ?? 'Failed to create database',
        (result.code as string) ?? SQLitErrorCode.DATABASE_UNAVAILABLE,
      )
    }

    return result
  }

  /**
   * Delete a database
   */
  async deleteDatabase(): Promise<void> {
    const endpoint = this.getCurrentEndpoint()

    const response = await fetch(
      `${endpoint}/v2/databases/${this.config.databaseId}`,
      {
        method: 'DELETE',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      },
    )

    const result = (await response.json()) as APIResponse<void>

    if (!result.success) {
      throw new SQLitError(
        result.error ?? 'Failed to delete database',
        (result.code as string) ?? SQLitErrorCode.DATABASE_UNAVAILABLE,
      )
    }
  }

  // ============ Generic Request API ============

  /**
   * Make a generic HTTP request to the SQLit v2 API
   * Used for vector operations, ACL, and other extended features
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const endpoint = this.getCurrentEndpoint()
    const url = `${endpoint}${path}`

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(this.config.timeoutMs),
    })

    const result = (await response.json()) as {
      success: boolean
      error?: string
      code?: string
    } & T

    if (!result.success) {
      throw new SQLitError(
        result.error ?? 'Request failed',
        (result.code as string) ?? SQLitErrorCode.DATABASE_UNAVAILABLE,
      )
    }

    return result
  }

  // ============ ACL Operations ============

  /**
   * Grant permissions to an address
   */
  async grant(
    dbId: string,
    request: {
      grantee: `0x${string}`
      permissions: Array<'read' | 'write' | 'admin'>
    },
  ): Promise<void> {
    await this.request('/v2/acl/grant', {
      method: 'POST',
      body: JSON.stringify({ databaseId: dbId, ...request }),
    })
  }

  /**
   * Revoke permissions from an address
   */
  async revoke(
    dbId: string,
    request: {
      grantee: `0x${string}`
      permissions?: Array<'read' | 'write' | 'admin'>
    },
  ): Promise<void> {
    await this.request('/v2/acl/revoke', {
      method: 'POST',
      body: JSON.stringify({ databaseId: dbId, ...request }),
    })
  }

  /**
   * List ACL rules for a database
   */
  async listACL(dbId: string): Promise<
    Array<{
      grantee: `0x${string}`
      permissions: Array<'read' | 'write' | 'admin'>
      grantedAt: number
      expiresAt?: number
    }>
  > {
    const result = await this.request<{
      data: Array<{
        grantee: `0x${string}`
        permissions: Array<'read' | 'write' | 'admin'>
        grantedAt: number
        expiresAt?: number
      }>
    }>(`/v2/acl/list?databaseId=${dbId}`, { method: 'GET' })
    return result.data ?? []
  }

  // ============ Vector Operations ============

  /**
   * Create a vector index
   */
  async createVectorIndex(
    dbId: string,
    config: {
      tableName: string
      dimensions: number
      metadataColumns?: Array<{ name: string; type: string }>
      partitionKey?: string
    },
  ): Promise<void> {
    await this.request('/v2/vector/create-index', {
      method: 'POST',
      body: JSON.stringify({ databaseId: dbId, ...config }),
    })
  }

  /**
   * Insert a vector
   */
  async insertVector(
    dbId: string,
    request: {
      tableName: string
      vector: number[]
      rowid?: number
      metadata?: Record<string, string | number | boolean | null>
      partitionValue?: string | number
    },
  ): Promise<{ rowid: number }> {
    return this.request('/v2/vector/insert', {
      method: 'POST',
      body: JSON.stringify({ databaseId: dbId, ...request }),
    })
  }

  /**
   * Batch insert vectors
   */
  async batchInsertVectors(
    dbId: string,
    request: {
      tableName: string
      vectors: Array<{
        vector: number[]
        rowid?: number
        metadata?: Record<string, string | number | boolean | null>
        partitionValue?: string | number
      }>
    },
  ): Promise<{ rowids: number[] }> {
    return this.request('/v2/vector/batch-insert', {
      method: 'POST',
      body: JSON.stringify({ databaseId: dbId, ...request }),
    })
  }

  /**
   * Search for similar vectors
   */
  async searchVectors(
    dbId: string,
    request: {
      tableName: string
      vector: number[]
      k: number
      partitionValue?: string | number
      metadataFilter?: string
      includeMetadata?: boolean
    },
  ): Promise<
    Array<{
      rowid: number
      distance: number
      metadata?: Record<string, string | number | boolean | null>
    }>
  > {
    return this.request('/v2/vector/search', {
      method: 'POST',
      body: JSON.stringify({ databaseId: dbId, ...request }),
    })
  }

  // ============ Connection Management ============

  /**
   * Connect to the database (no-op for HTTP client, returns self)
   */
  async connect(): Promise<this> {
    return this
  }

  /**
   * Get connection pool (returns null for HTTP client)
   */
  getPool(): null {
    return null
  }

  /**
   * Get circuit breaker state (returns null for HTTP client)
   */
  getCircuitState(): null {
    return null
  }

  // ============ Health & Status ============

  /**
   * Check if the endpoint is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const endpoint = this.getCurrentEndpoint()
      const response = await fetch(`${endpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      const result = (await response.json()) as { success: boolean }
      return result.success === true
    } catch {
      return false
    }
  }

  /**
   * Get current WAL position for consistency
   */
  getLastWalPosition(): bigint {
    return this.lastWalPosition
  }

  /**
   * Get current endpoint
   */
  getEndpoint(): string {
    return this.getCurrentEndpoint()
  }

  // ============ Private Methods ============

  private getCurrentEndpoint(): string {
    if (this.currentEndpointIndex === 0) {
      return this.config.endpoint
    }
    const fallbacks = this.config.fallbackEndpoints ?? []
    return fallbacks[this.currentEndpointIndex - 1] ?? this.config.endpoint
  }

  private async executeWithFailover(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
    options?: QueryOptions,
  ): Promise<ExecuteResponse> {
    const allEndpoints = [
      this.config.endpoint,
      ...(this.config.fallbackEndpoints ?? []),
    ]

    for (let i = 0; i < allEndpoints.length; i++) {
      this.currentEndpointIndex = i
      try {
        const result = await this.execute(sql, params, options)
        return result
      } catch (error) {
        if (this.config.debug) {
          console.warn(
            `[SQLit Client] Endpoint ${allEndpoints[i]} failed:`,
            error,
          )
        }
        if (i === allEndpoints.length - 1) {
          throw error
        }
      }
    }

    throw new SQLitError(
      'All endpoints failed',
      SQLitErrorCode.DATABASE_UNAVAILABLE,
    )
  }
}

/**
 * Transaction client for executing queries within a transaction
 */
class TransactionClient {
  constructor(private client: SQLitClient) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
  ): Promise<T[]> {
    return this.client.query<T>(sql, params)
  }

  async queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
  ): Promise<T | null> {
    return this.client.queryOne<T>(sql, params)
  }

  async run(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
  ): Promise<{ rowsAffected: number; lastInsertId: bigint }> {
    return this.client.run(sql, params)
  }

  async execute(
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
  ): Promise<ExecuteResponse> {
    return this.client.execute(sql, params)
  }

  async savepoint(name: string): Promise<void> {
    await this.execute(`SAVEPOINT ${name}`)
  }

  async release(name: string): Promise<void> {
    await this.execute(`RELEASE SAVEPOINT ${name}`)
  }

  async rollbackTo(name: string): Promise<void> {
    await this.execute(`ROLLBACK TO SAVEPOINT ${name}`)
  }
}

/**
 * Create a SQLit client instance
 */
export function createClient(config: SQLitClientConfig): SQLitClient {
  return new SQLitClient(config)
}
