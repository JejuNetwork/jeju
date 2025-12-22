/**
 * CQL Sync Layer
 *
 * Syncs indexer data from PostgreSQL to CovenantSQL for decentralized reads.
 * Uses the @jejunetwork/db client for CQL operations.
 */

import { type CQLClient, getCQL } from '@jejunetwork/db'
import type { DataSource, EntityMetadata } from 'typeorm'

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

// ============================================================================
// Configuration
// ============================================================================

const CQL_ENABLED = process.env.CQL_SYNC_ENABLED === 'true'
const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'indexer-sync'

function getSyncIntervalMs(): number {
  const interval = parseInt(process.env.CQL_SYNC_INTERVAL ?? '30000', 10)
  if (Number.isNaN(interval) || interval <= 0) {
    throw new Error(
      `Invalid CQL_SYNC_INTERVAL: ${process.env.CQL_SYNC_INTERVAL}. Must be a positive integer.`,
    )
  }
  return interval
}

function getBatchSize(): number {
  const batch = parseInt(process.env.CQL_SYNC_BATCH_SIZE ?? '1000', 10)
  if (Number.isNaN(batch) || batch <= 0) {
    throw new Error(
      `Invalid CQL_SYNC_BATCH_SIZE: ${process.env.CQL_SYNC_BATCH_SIZE}. Must be a positive integer.`,
    )
  }
  return batch
}

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
  private client: CQLClient
  private dataSource: DataSource | null = null
  private syncInterval: ReturnType<typeof setInterval> | null = null
  private running = false
  private syncIntervalMs: number
  private batchSize: number

  constructor() {
    this.client = getCQL()
    this.syncIntervalMs = CQL_ENABLED ? getSyncIntervalMs() : 30000
    this.batchSize = CQL_ENABLED ? getBatchSize() : 1000
  }

  async initialize(dataSource: DataSource): Promise<void> {
    if (!dataSource) {
      throw new Error('DataSource is required')
    }

    if (!CQL_ENABLED) {
      console.log('[CQLSync] Disabled - set CQL_SYNC_ENABLED=true to enable')
      return
    }

    // Verify CQL is healthy
    const healthy = await this.client.isHealthy()
    if (!healthy) {
      throw new Error(
        '[CQLSync] CQL is not healthy. Ensure CovenantSQL is running.',
      )
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
    console.log(`[CQLSync] Starting sync every ${this.syncIntervalMs}ms`)

    // Initial sync
    await this.sync()

    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.sync().catch((err) => {
        console.error('[CQLSync] Sync error:', err)
      })
    }, this.syncIntervalMs)
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

    query.orderBy(`${tableName}.${primaryColumns[0]}`, 'ASC').take(this.batchSize)

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
    // Validate table name for SQL safety
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`)
    }

    const columns = meta.columns.map((c) => c.databaseName)
    const params: SqlParam[] = []
    const placeholders: string[] = []

    // Validate all column names
    for (const colName of columns) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
        throw new Error(`Invalid column name: ${colName}`)
      }
    }

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

    // Validate primary column names
    for (const colName of primaryCols) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
        throw new Error(`Invalid primary column name: ${colName}`)
      }
    }

    const nonPrimaryCols = columns.filter((c) => !primaryCols.includes(c))
    const updateSet = nonPrimaryCols
      .map((c) => {
        const colIndex = columns.indexOf(c)
        return `${c} = $${colIndex + 1}`
      })
      .join(', ')

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

    // Create sync states table first
    await this.client
      .exec(
        `
        CREATE TABLE IF NOT EXISTS _cql_sync_states (
          entity TEXT PRIMARY KEY,
          last_synced_id TEXT,
          last_synced_at INTEGER NOT NULL,
          total_synced INTEGER NOT NULL
        )
      `.trim(),
        [],
        CQL_DATABASE_ID,
      )
      .catch((err: Error) => {
        console.warn(
          `[CQLSync] Sync states table creation warning: ${err.message}`,
        )
      })

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
        console.warn(
          `[CQLSync] Table creation for ${meta.tableName} warning: ${err.message}`,
        )
      })
  }

  private async loadSyncStates(): Promise<void> {
    const result = await this.client
      .query<{
        entity: string
        last_synced_id: string | null
        last_synced_at: number
        total_synced: number
      }>('SELECT * FROM _cql_sync_states', undefined, CQL_DATABASE_ID)
      .catch((err: Error) => {
        console.log(
          `[CQLSync] Loading sync states: ${err.message} (will populate on first sync)`,
        )
        return { rows: [], rowCount: 0 }
      })

    for (const row of result.rows) {
      syncStates.set(row.entity, {
        entity: row.entity,
        lastSyncedId: row.last_synced_id,
        lastSyncedAt: row.last_synced_at,
        totalSynced: row.total_synced,
      })
    }
  }

  private async saveSyncState(state: SyncState): Promise<void> {
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
      console.log(
        `[CQLSync] Saving sync state for ${state.entity}: ${err.message}`,
      )
    })
  }

  async getCQLReadClient(): Promise<CQLClient> {
    return this.client
  }

  /**
   * Query from CQL - for internal indexer use
   */
  async queryFromCQL<T>(
    sql: string,
    params?: SqlParam[],
  ): Promise<QueryResult<T>> {
    // Basic SQL injection protection
    if (sql.includes(';') && sql.indexOf(';') !== sql.length - 1) {
      throw new Error('Multiple SQL statements not allowed')
    }
    const result = await this.client.query<T>(sql, params, CQL_DATABASE_ID)
    return { rows: result.rows, rowCount: result.rowCount }
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

// Re-export config type for external use
export type { CQLClient as CQLClientConfig }
