/**
 * SQLit Client
 *
 * The main database client for Jeju Network applications.
 * Uses SQLit distributed database infrastructure.
 *
 * @example
 * ```typescript
 * import { getSQLit } from '@jejunetwork/db'
 *
 * const db = getSQLit()
 * const users = await db.query('SELECT * FROM users')
 * await db.exec('INSERT INTO users (name) VALUES (?)', ['Alice'])
 * ```
 */

import {
  getLogLevel,
  getSQLitDatabaseId,
  getSQLitTimeout,
  getSQLitUrl,
  isSQLitDebug,
} from '@jejunetwork/config'
import {
  type SQLitClientConfig,
  SQLitClient as SQLitCoreClient,
} from '@jejunetwork/sqlit/client'
import pino from 'pino'
import type { Hex } from 'viem'
import type {
  ACLRule,
  DatabaseConfig,
  DatabaseInfo,
  ExecResult,
  GrantRequest,
  QueryParam,
  QueryResult,
  RevokeRequest,
  VectorBatchInsertRequest,
  VectorIndexConfig,
  VectorInsertRequest,
  VectorSearchRequest,
  VectorSearchResult,
} from './types.js'
import { parseTimeout } from './utils.js'

const log = pino({
  name: 'sqlit-client',
  level: getLogLevel(),
})

const DEFAULT_TIMEOUT = 30000

/**
 * SQLit Client - Main database interface for Jeju Network apps
 */
export class SQLitClient {
  private client: SQLitCoreClient
  private config: SQLitClientConfig

  constructor(config: SQLitClientConfig) {
    this.config = config
    this.client = new SQLitCoreClient(config)
  }

  /**
   * Execute a query and return results
   */
  async query<T = Record<string, string | number | boolean | null>>(
    sql: string,
    params?: QueryParam[],
    _dbId?: string,
  ): Promise<QueryResult<T>> {
    // Convert params to sqlit expected types (no Uint8Array support)
    const convertedParams = params?.map((p) =>
      p instanceof Uint8Array ? null : p,
    )
    const rows = await this.client.query<T & Record<string, unknown>>(
      sql,
      convertedParams,
    )
    return {
      rows: rows as T[],
      rowCount: rows.length,
      columns: [],
      executionTime: 0,
      blockHeight: 0,
    }
  }

  /**
   * Execute a write query
   */
  async exec(
    sql: string,
    params?: QueryParam[],
    _dbId?: string,
  ): Promise<ExecResult> {
    // Convert params to sqlit expected types (no Uint8Array support)
    const convertedParams = params?.map((p) =>
      p instanceof Uint8Array ? null : p,
    )
    const result = await this.client.execute(sql, convertedParams)
    return {
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
      txHash: `0x${'0'.repeat(64)}` as Hex,
      blockHeight: 0,
      gasUsed: BigInt(0),
    }
  }

  /**
   * Create a new database
   */
  async createDatabase(config: DatabaseConfig): Promise<DatabaseInfo> {
    const result = await this.client.createDatabase({
      name: config.schema?.slice(0, 50) ?? 'database',
      encryptionMode: 'none',
      replication: { replicaCount: config.nodeCount ?? 2 },
      schema: config.schema,
    })

    return {
      id: result.databaseId,
      createdAt: Date.now(),
      owner: config.owner ?? (`0x${'0'.repeat(40)}` as `0x${string}`),
      nodeCount: config.nodeCount ?? 2,
      consistencyMode: config.useEventualConsistency ? 'eventual' : 'strong',
      status: 'running',
      blockHeight: 0,
      sizeBytes: 0,
      monthlyCost: BigInt(0),
    }
  }

  /**
   * Delete a database
   */
  async deleteDatabase(_id: string): Promise<void> {
    // Note: deleteDatabase uses the client's configured databaseId
    await this.client.deleteDatabase()
  }

  /**
   * Grant permissions
   */
  async grant(dbId: string, req: GrantRequest): Promise<void> {
    await this.client.grant(dbId, {
      grantee: req.grantee,
      permissions: req.permissions.map((p) =>
        p === 'SELECT'
          ? 'read'
          : p === 'INSERT' || p === 'UPDATE' || p === 'DELETE'
            ? 'write'
            : 'admin',
      ) as Array<'read' | 'write' | 'admin'>,
    })
  }

  /**
   * Revoke permissions
   */
  async revoke(dbId: string, req: RevokeRequest): Promise<void> {
    await this.client.revoke(dbId, {
      grantee: req.grantee,
      permissions: req.permissions?.map((p) =>
        p === 'SELECT'
          ? 'read'
          : p === 'INSERT' || p === 'UPDATE' || p === 'DELETE'
            ? 'write'
            : 'admin',
      ) as Array<'read' | 'write' | 'admin'>,
    })
  }

  /**
   * List ACL rules
   */
  async listACL(dbId: string): Promise<ACLRule[]> {
    const rules = await this.client.listACL(dbId)
    return rules.map((r) => ({
      grantee: r.grantee,
      table: '*',
      columns: '*',
      permissions: r.permissions.map((p) =>
        p === 'read'
          ? ('SELECT' as const)
          : p === 'write'
            ? ('INSERT' as const)
            : ('ALL' as const),
      ),
    }))
  }

  /**
   * Create a vector index
   */
  async createVectorIndex(
    config: VectorIndexConfig,
    dbId?: string,
  ): Promise<ExecResult> {
    const id = dbId ?? this.config.databaseId ?? 'default'
    await this.client.createVectorIndex(id, {
      tableName: config.tableName,
      dimensions: config.dimensions,
      metadataColumns: config.metadataColumns,
      partitionKey: config.partitionKey,
    })
    return {
      rowsAffected: 0,
      lastInsertId: BigInt(0),
      txHash: `0x${'0'.repeat(64)}` as Hex,
      blockHeight: 0,
      gasUsed: BigInt(0),
    }
  }

  /**
   * Insert a vector
   */
  async insertVector(
    request: VectorInsertRequest,
    dbId?: string,
  ): Promise<ExecResult> {
    const id = dbId ?? this.config.databaseId ?? 'default'
    const result = await this.client.insertVector(id, {
      tableName: request.tableName,
      vector: request.vector,
      rowid: request.rowid,
      metadata: request.metadata,
      partitionValue: request.partitionValue,
    })
    return {
      rowsAffected: 1,
      lastInsertId: BigInt(result.rowid),
      txHash: `0x${'0'.repeat(64)}` as Hex,
      blockHeight: 0,
      gasUsed: BigInt(0),
    }
  }

  /**
   * Batch insert vectors
   */
  async insertVectorBatch(
    request: VectorBatchInsertRequest,
    dbId?: string,
  ): Promise<ExecResult[]> {
    const id = dbId ?? this.config.databaseId ?? 'default'
    const result = await this.client.batchInsertVectors(id, {
      tableName: request.tableName,
      vectors: request.vectors.map((v) => ({
        vector: v.vector,
        rowid: v.rowid,
        metadata: v.metadata,
        partitionValue: v.partitionValue,
      })),
    })
    return result.rowids.map((rowid) => ({
      rowsAffected: 1,
      lastInsertId: BigInt(rowid),
      txHash: `0x${'0'.repeat(64)}` as Hex,
      blockHeight: 0,
      gasUsed: BigInt(0),
    }))
  }

  /**
   * Search for similar vectors
   */
  async searchVectors(
    request: VectorSearchRequest,
    dbId?: string,
  ): Promise<VectorSearchResult[]> {
    const id = dbId ?? this.config.databaseId ?? 'default'
    const results = await this.client.searchVectors(id, {
      tableName: request.tableName,
      vector: request.vector,
      k: request.k,
      partitionValue: request.partitionValue,
      metadataFilter: request.metadataFilter,
      includeMetadata: request.includeMetadata,
    })
    return results.map((r) => ({
      rowid: r.rowid,
      distance: r.distance,
      metadata: r.metadata,
    }))
  }

  /**
   * Check if the database is healthy
   */
  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy()
  }

  /**
   * Connect to the database (returns a connection-like wrapper)
   */
  async connect(_dbId?: string): Promise<SQLitConnection> {
    // Return a connection wrapper that delegates to the client
    return {
      query: <T = Record<string, string | number | boolean | null>>(
        sql: string,
        params?: QueryParam[],
      ) => this.query<T>(sql, params, _dbId),
      exec: (sql: string, params?: QueryParam[]) =>
        this.exec(sql, params, _dbId),
      beginTransaction: async () => this.beginTransaction(_dbId),
      close: async () => {},
    }
  }

  /**
   * Get connection pool (returns a minimal pool interface)
   */
  getPool(_dbId?: string): SQLitPool {
    return {
      release: () => {},
      acquire: async () => this.connect(_dbId),
    }
  }

  /**
   * Get circuit breaker state (not applicable for HTTP client)
   */
  getCircuitState(): {
    state: 'open' | 'closed' | 'half-open'
    failures: number
  } {
    return { state: 'closed', failures: 0 }
  }

  /**
   * Begin a transaction
   */
  private async beginTransaction(_dbId?: string): Promise<SQLitTransaction> {
    // Begin transaction on the v2 client
    await this.client.execute('BEGIN TRANSACTION')
    return {
      query: <T = Record<string, string | number | boolean | null>>(
        sql: string,
        params?: QueryParam[],
      ) => this.query<T>(sql, params, _dbId),
      exec: (sql: string, params?: QueryParam[]) =>
        this.exec(sql, params, _dbId),
      commit: async () => {
        await this.client.execute('COMMIT')
      },
      rollback: async () => {
        await this.client.execute('ROLLBACK')
      },
    }
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    // SQLitCoreClient doesn't need explicit close
  }
}

/** Connection interface for compatibility */
interface SQLitConnection {
  query<T = Record<string, string | number | boolean | null>>(
    sql: string,
    params?: QueryParam[],
  ): Promise<QueryResult<T>>
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>
  beginTransaction(): Promise<SQLitTransaction>
  close(): Promise<void>
}

/** Pool interface for compatibility */
interface SQLitPool {
  release(conn: SQLitConnection): void
  acquire(): Promise<SQLitConnection>
}

/** Transaction interface for compatibility */
interface SQLitTransaction {
  query<T = Record<string, string | number | boolean | null>>(
    sql: string,
    params?: QueryParam[],
  ): Promise<QueryResult<T>>
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>
  commit(): Promise<void>
  rollback(): Promise<void>
}

// Singleton instance
let sqlitClient: SQLitClient | null = null

/**
 * Get a SQLit client with automatic network-aware configuration.
 */
export function getSQLit(config?: Partial<SQLitClientConfig>): SQLitClient {
  if (!sqlitClient) {
    const endpoint =
      config?.endpoint ?? getSQLitUrl() ?? 'http://localhost:8546'
    const databaseId = config?.databaseId ?? getSQLitDatabaseId() ?? 'default'
    const timeout =
      config?.timeoutMs ?? parseTimeout(getSQLitTimeout(), DEFAULT_TIMEOUT)
    const debug = config?.debug ?? isSQLitDebug()

    const resolvedConfig: SQLitClientConfig = {
      endpoint,
      databaseId,
      timeoutMs: timeout,
      debug,
    }

    log.debug({ config: resolvedConfig }, 'Creating SQLit client')
    sqlitClient = new SQLitClient(resolvedConfig)
  }
  return sqlitClient
}

/**
 * Reset the singleton client
 */
export async function resetSQLit(): Promise<void> {
  if (sqlitClient) {
    await sqlitClient.close()
    sqlitClient = null
  }
}
