/**
 * CQL Sync Layer
 *
 * STATUS: REFERENCE IMPLEMENTATION - Not wired into app entry point.
 * DEPENDENCY: Requires CovenantSQL service.
 *
 * Syncs indexer data from PostgreSQL to CovenantSQL for decentralized reads.
 * Uses centralized config for CQL endpoint.
 */

// Stubbed imports - CQL sync is reference implementation only
// import { CovenantSQLClient, type QueryResult } from '@jejunetwork/db';
// import { getCQLUrl } from '@jejunetwork/config';

// SQL parameter types - values that can be safely passed to SQL queries
type SqlPrimitive = string | number | boolean | null | bigint | Date
type SqlParam = SqlPrimitive | SqlPrimitive[]
type SqlRowValue = string | number | boolean | null
type SqlRow = Record<string, SqlRowValue>

// Entity record value types - possible values stored in TypeORM entities
type EntityValue =
  | string
  | number
  | boolean
  | bigint
  | Date
  | null
  | undefined
  | object
type EntityRecord = Record<string, EntityValue>

interface QueryResult<T = SqlRow> {
  rows: T[]
  rowCount: number
}
const getCQLUrl = (): string => process.env.CQL_URL || 'http://localhost:4661'

// Stub CovenantSQLClient
interface CovenantSQLClientConfig {
  blockProducerEndpoint: string
  databaseId: string
}

class CovenantSQLClient {
  constructor(_config: CovenantSQLClientConfig) {}
  async query<T = SqlRow>(
    _sql: string,
    _params?: SqlParam[],
    _dbId?: string,
  ): Promise<QueryResult<T>> {
    return { rows: [], rowCount: 0 }
  }
  async exec(
    _sql: string,
    _params?: SqlParam | SqlParam[],
    _dbId?: string,
  ): Promise<void> {}
  async close(): Promise<void> {}
}

import type { DataSource, EntityMetadata } from 'typeorm'

// ============================================================================
// Configuration
// ============================================================================

const CQL_ENABLED = process.env.CQL_SYNC_ENABLED === 'true'
const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'indexer-sync'
const SYNC_INTERVAL_MS = (() => {
  const interval = parseInt(process.env.CQL_SYNC_INTERVAL ?? '30000', 10)
  if (Number.isNaN(interval) || interval <= 0) {
    throw new Error(
      `Invalid CQL_SYNC_INTERVAL: ${process.env.CQL_SYNC_INTERVAL}. Must be a positive integer.`,
    )
  }
  return interval
})()
const BATCH_SIZE = (() => {
  const batch = parseInt(process.env.CQL_SYNC_BATCH_SIZE ?? '1000', 10)
  if (Number.isNaN(batch) || batch <= 0) {
    throw new Error(
      `Invalid CQL_SYNC_BATCH_SIZE: ${process.env.CQL_SYNC_BATCH_SIZE}. Must be a positive integer.`,
    )
  }
  return batch
})()

// ============================================================================
// Sync State
// ============================================================================

interface SyncState {
  entity: string
  lastSyncedId: string | null
  lastSyncedAt: number
  totalSynced: number
}

const syncStates: Map<string, SyncState> = new Map()

// ============================================================================
// CQL Sync Service
// ============================================================================

export class CQLSyncService {
  private client: CovenantSQLClient
  private dataSource: DataSource | null = null
  private syncInterval: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor() {
    // Use centralized config for CQL endpoint
    this.client = new CovenantSQLClient({
      blockProducerEndpoint: getCQLUrl(),
      databaseId: CQL_DATABASE_ID,
    })
  }

  async initialize(dataSource: DataSource): Promise<void> {
    if (!dataSource) {
      throw new Error('DataSource is required')
    }

    if (!CQL_ENABLED) {
      console.log('[CQLSync] Disabled - set CQL_SYNC_ENABLED=true to enable')
      return
    }

    this.dataSource = dataSource

    // Create tables in CQL matching PostgreSQL schema
    await this.createCQLTables()

    // Load sync states
    await this.loadSyncStates()

    console.log('[CQLSync] Initialized')
  }

  async start(): Promise<void> {
    if (!CQL_ENABLED || this.running) return

    this.running = true
    console.log(`[CQLSync] Starting sync every ${SYNC_INTERVAL_MS}ms`)

    // Initial sync
    await this.sync()

    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.sync().catch((err) => {
        console.error('[CQLSync] Sync error:', err)
      })
    }, SYNC_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
    this.running = false
    console.log('[CQLSync] Stopped')
  }

  async sync(): Promise<void> {
    if (!this.dataSource?.isInitialized) return

    const entities = this.dataSource.entityMetadatas

    for (const entity of entities) {
      await this.syncEntity(entity)
    }
  }

  private async syncEntity(meta: EntityMetadata): Promise<void> {
    if (!this.dataSource) return

    const tableName = meta.tableName
    const primaryColumns = meta.primaryColumns.map((c) => c.databaseName)

    if (primaryColumns.length === 0) {
      console.warn(`[CQLSync] Skipping ${tableName} - no primary key`)
      return
    }

    const state = syncStates.get(tableName) ?? {
      entity: tableName,
      lastSyncedId: null,
      lastSyncedAt: 0,
      totalSynced: 0,
    }

    // Build query for new/updated records
    const repo = this.dataSource.getRepository(meta.target)
    const query = repo.createQueryBuilder(tableName)

    if (state.lastSyncedId) {
      query.where(`${tableName}.${primaryColumns[0]} > :lastId`, {
        lastId: state.lastSyncedId,
      })
    }

    query.orderBy(`${tableName}.${primaryColumns[0]}`, 'ASC').take(BATCH_SIZE)

    const records = await query.getMany()

    if (records.length === 0) return

    // Sync to CQL
    for (const record of records) {
      await this.upsertToCQL(tableName, meta, record)
    }

    // Update sync state
    const lastRecord = records[records.length - 1] as EntityRecord
    const lastId = String(lastRecord[primaryColumns[0]])
    state.lastSyncedId = lastId
    state.lastSyncedAt = Date.now()
    state.totalSynced += records.length
    syncStates.set(tableName, state)

    await this.saveSyncState(state)

    console.log(`[CQLSync] Synced ${records.length} records from ${tableName}`)
  }

  private async upsertToCQL(
    tableName: string,
    meta: EntityMetadata,
    record: EntityRecord,
  ): Promise<void> {
    // SECURITY: Use parameterized queries to prevent SQL injection
    const columns = meta.columns.map((c) => c.databaseName)
    const params: SqlParam[] = []
    const placeholders: string[] = []

    meta.columns.forEach((c, index) => {
      const value = record[c.propertyName]
      placeholders.push(`$${index + 1}`)

      if (value === null || value === undefined) {
        params.push(null)
      } else if (typeof value === 'string') {
        params.push(value)
      } else if (typeof value === 'number') {
        params.push(value)
      } else if (typeof value === 'boolean') {
        params.push(value)
      } else if (typeof value === 'bigint') {
        params.push(value)
      } else if (value instanceof Date) {
        params.push(value)
      } else if (typeof value === 'object') {
        params.push(JSON.stringify(value))
      } else {
        params.push(String(value))
      }
    })

    const primaryCols = meta.primaryColumns.map((c) => c.databaseName)
    const nonPrimaryCols = columns.filter((c) => !primaryCols.includes(c))
    const updateSet = nonPrimaryCols
      .map((c) => {
        const colIndex = columns.indexOf(c)
        return `${c} = $${colIndex + 1}`
      })
      .join(', ')

    // Validate table name contains only valid characters (alphanumeric and underscore)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`)
    }

    // Validate all column names to prevent SQL injection
    for (const colName of columns) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
        throw new Error(`Invalid column name: ${colName}`)
      }
    }
    for (const colName of primaryCols) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
        throw new Error(`Invalid primary column name: ${colName}`)
      }
    }

    const sql = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${primaryCols.join(', ')})
      DO UPDATE SET ${updateSet}
    `.trim()

    await this.client.exec(sql, params, CQL_DATABASE_ID)
  }

  private async createCQLTables(): Promise<void> {
    if (!this.dataSource) return

    for (const meta of this.dataSource.entityMetadatas) {
      await this.createCQLTable(meta)
    }
  }

  private async createCQLTable(meta: EntityMetadata): Promise<void> {
    // Validate table name for SQL safety
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(meta.tableName)) {
      throw new Error(`Invalid table name for CQL: ${meta.tableName}`)
    }

    const columns = meta.columns.map((col) => {
      // Validate column name for SQL safety
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col.databaseName)) {
        throw new Error(`Invalid column name for CQL: ${col.databaseName}`)
      }
      let type = 'TEXT'
      switch (col.type) {
        case 'int':
        case 'integer':
        case Number:
          type = 'INTEGER'
          break
        case 'bigint':
          type = 'BIGINT'
          break
        case 'boolean':
        case Boolean:
          type = 'BOOLEAN'
          break
        case 'timestamp':
        case 'timestamp with time zone':
        case Date:
          type = 'TIMESTAMP'
          break
        case 'numeric':
        case 'decimal':
          type = 'DECIMAL'
          break
        case 'json':
        case 'jsonb':
          type = 'TEXT' // CQL stores JSON as text
          break
      }

      const nullable = col.isNullable ? '' : ' NOT NULL'
      return `${col.databaseName} ${type}${nullable}`
    })

    const primaryCols = meta.primaryColumns.map((c) => c.databaseName)

    const sql = `
      CREATE TABLE IF NOT EXISTS ${meta.tableName} (
        ${columns.join(',\n        ')},
        PRIMARY KEY (${primaryCols.join(', ')})
      )
    `.trim()

    await this.client
      .exec(sql, undefined, CQL_DATABASE_ID)
      .catch((err: Error) => {
        // Table creation is idempotent - log warning but continue
        console.warn(
          `[CQLSync] Table creation for ${meta.tableName} failed: ${err.message}`,
        )
      })
  }

  private async loadSyncStates(): Promise<void> {
    const result = await this.client
      .query<SyncState>(
        'SELECT * FROM _cql_sync_states',
        undefined,
        CQL_DATABASE_ID,
      )
      .catch((err: Error) => {
        // Table may not exist on first run - this is expected
        console.log(
          `[CQLSync] Loading sync states: ${err.message} (will create table on first sync)`,
        )
        return { rows: [] as SyncState[], rowCount: 0 }
      })

    for (const row of result.rows) {
      syncStates.set(row.entity, row)
    }
  }

  private async saveSyncState(state: SyncState): Promise<void> {
    // SECURITY: Use parameterized queries to prevent SQL injection
    const sql = `
      INSERT INTO _cql_sync_states (entity, last_synced_id, last_synced_at, total_synced)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (entity)
      DO UPDATE SET last_synced_id = $2, 
                    last_synced_at = $3, 
                    total_synced = $4
    `.trim()

    const params: SqlParam[] = [
      state.entity,
      state.lastSyncedId,
      state.lastSyncedAt,
      state.totalSynced,
    ]

    await this.client.exec(sql, params, CQL_DATABASE_ID).catch((err: Error) => {
      // Sync state table may not exist on first run - this is expected
      console.log(
        `[CQLSync] Saving sync state for ${state.entity}: ${err.message}`,
      )
    })
  }

  async getCQLReadClient(): Promise<CovenantSQLClient> {
    return this.client
  }

  /**
   * Query from CQL - INTERNAL USE ONLY
   * WARNING: This method accepts raw SQL. Never pass user input directly.
   * Use parameterized queries via the Subsquid TypeORM store for user-facing queries.
   */
  async queryFromCQL<T>(
    sql: string,
    params?: SqlParam[],
  ): Promise<QueryResult<T>> {
    // Basic SQL injection check - this method should only be used internally
    // with pre-defined queries, not with user input
    if (sql.includes(';') && sql.indexOf(';') !== sql.length - 1) {
      throw new Error('Multiple SQL statements not allowed')
    }
    return this.client.query<T>(sql, params, CQL_DATABASE_ID)
  }

  getStats(): {
    enabled: boolean
    running: boolean
    entities: number
    states: Record<string, SyncState>
  } {
    return {
      enabled: CQL_ENABLED,
      running: this.running,
      entities: syncStates.size,
      states: Object.fromEntries(syncStates),
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let cqlSyncService: CQLSyncService | null = null

export function getCQLSync(): CQLSyncService {
  if (!cqlSyncService) {
    cqlSyncService = new CQLSyncService()
  }
  return cqlSyncService
}

export function resetCQLSync(): void {
  if (cqlSyncService) {
    cqlSyncService.stop().catch((err: Error) => {
      console.warn(`[CQLSync] Error during shutdown: ${err.message}`)
    })
    cqlSyncService = null
  }
}
