/**
 * EQLite sync layer
 */

import type { QueryParam } from '@jejunetwork/db'
import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import type { DataSource, EntityMetadata } from 'typeorm'
import { config } from '../config'

type SqlPrimitive = string | number | boolean | null | bigint | Date
type SqlParam = SqlPrimitive | SqlPrimitive[]

/** Convert our SqlParam to QueryParam for the EQLite layer */
function convertToQueryParam(value: SqlParam): QueryParam {
  if (Array.isArray(value)) {
    // Convert array to JSON string for storage
    return JSON.stringify(
      value.map((v) => (v instanceof Date ? v.toISOString() : v)),
    )
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  // primitives including bigint pass through
  return value as QueryParam
}
type SqlRowValue = string | number | boolean | null
type SqlRow = Record<string, SqlRowValue>

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

const EQLITE_ENABLED = config.eqliteSyncEnabled
const EQLITE_DATABASE_ID = config.eqliteDatabaseId

function getSyncIntervalMs(): number {
  const interval = config.eqliteSyncInterval
  if (interval <= 0) {
    throw new Error(
      `Invalid EQLITE_SYNC_INTERVAL: ${interval}. Must be a positive integer.`,
    )
  }
  return interval
}

function getBatchSize(): number {
  const batch = config.eqliteSyncBatchSize
  if (batch <= 0) {
    throw new Error(
      `Invalid EQLITE_SYNC_BATCH_SIZE: ${batch}. Must be a positive integer.`,
    )
  }
  return batch
}

interface SyncState {
  entity: string
  lastSyncedId: string | null
  lastSyncedAt: number
  totalSynced: number
}

const syncStates: Map<string, SyncState> = new Map()

export class EQLiteSyncService {
  private client: EQLiteClient
  private dataSource: DataSource | null = null
  private syncInterval: ReturnType<typeof setInterval> | null = null
  private running = false
  private syncIntervalMs: number
  private batchSize: number

  constructor() {
    this.client = getEQLite()
    this.syncIntervalMs = EQLITE_ENABLED ? getSyncIntervalMs() : 30000
    this.batchSize = EQLITE_ENABLED ? getBatchSize() : 1000
  }

  async initialize(dataSource: DataSource): Promise<void> {
    if (!dataSource) {
      throw new Error('DataSource is required')
    }

    if (!EQLITE_ENABLED) {
      console.log(
        '[EQLiteSync] Disabled - set EQLITE_SYNC_ENABLED=true to enable',
      )
      return
    }

    // Verify EQLite is healthy with retries (EQLite might be starting up)
    let healthy = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      healthy = await this.client.isHealthy()
      if (healthy) break
      console.log(`[EQLiteSync] Waiting for EQLite (attempt ${attempt}/3)...`)
      await new Promise((r) => setTimeout(r, 2000))
    }

    if (!healthy) {
      console.warn('[EQLiteSync] EQLite not available - sync disabled')
      return
    }

    this.dataSource = dataSource

    // Create tables in EQLite matching PostgreSQL schema
    await this.createEQLiteTables()

    // Load sync states
    await this.loadSyncStates()

    console.log('[EQLiteSync] Initialized')
  }

  async start(): Promise<void> {
    if (!EQLITE_ENABLED || this.running) return

    this.running = true
    console.log(`[EQLiteSync] Starting sync every ${this.syncIntervalMs}ms`)

    // Initial sync
    await this.sync()

    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.sync().catch((err) => {
        console.error('[EQLiteSync] Sync error:', err)
      })
    }, this.syncIntervalMs)
  }

  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
    this.running = false
    console.log('[EQLiteSync] Stopped')
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
      throw new Error(
        `[EQLiteSync] Table ${tableName} has no primary key - cannot sync`,
      )
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

    query
      .orderBy(`${tableName}.${primaryColumns[0]}`, 'ASC')
      .take(this.batchSize)

    const records = await query.getMany()

    if (records.length === 0) return

    // Sync to EQLite
    for (const record of records) {
      await this.upsertToEQLite(tableName, meta, record)
    }

    // Update sync state
    const lastRecord = records[records.length - 1] as EntityRecord
    const lastId = String(lastRecord[primaryColumns[0]])
    state.lastSyncedId = lastId
    state.lastSyncedAt = Date.now()
    state.totalSynced += records.length
    syncStates.set(tableName, state)

    await this.saveSyncState(state)

    console.log(
      `[EQLiteSync] Synced ${records.length} records from ${tableName}`,
    )
  }

  private async upsertToEQLite(
    tableName: string,
    meta: EntityMetadata,
    record: EntityRecord,
  ): Promise<void> {
    // Validate table name for SQL safety
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      console.warn(`[EQLiteSync] Invalid table name: ${tableName}`)
      return
    }

    const columns = meta.columns.map((c) => c.databaseName)
    const quotedColumns = columns.map((c) => this.quoteIdent(c))
    const params: SqlParam[] = []
    const placeholders: string[] = []

    // Validate all column names
    for (const colName of columns) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
        console.warn(`[EQLiteSync] Invalid column name: ${colName}`)
        return
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
    const quotedPrimaryCols = primaryCols.map((c) => this.quoteIdent(c))

    // Validate primary column names
    for (const colName of primaryCols) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) {
        console.warn(`[EQLiteSync] Invalid primary column name: ${colName}`)
        return
      }
    }

    const nonPrimaryCols = columns.filter((c) => !primaryCols.includes(c))
    const updateSet = nonPrimaryCols
      .map((c) => {
        const colIndex = columns.indexOf(c)
        return `${this.quoteIdent(c)} = $${colIndex + 1}`
      })
      .join(', ')

    const sql = `
      INSERT INTO ${this.quoteIdent(tableName)} (${quotedColumns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${quotedPrimaryCols.join(', ')})
      DO UPDATE SET ${updateSet}
    `.trim()

    await this.client
      .exec(sql, params.map(convertToQueryParam), EQLITE_DATABASE_ID)
      .catch((err: Error) => {
        console.warn(
          `[EQLiteSync] Upsert to ${tableName} warning: ${err.message}`,
        )
      })
  }

  private async createEQLiteTables(): Promise<void> {
    if (!this.dataSource) return

    // Create sync states table first
    await this.client
      .exec(
        `
        CREATE TABLE IF NOT EXISTS _eqlite_sync_states (
          entity TEXT PRIMARY KEY,
          last_synced_id TEXT,
          last_synced_at INTEGER NOT NULL,
          total_synced INTEGER NOT NULL
        )
      `.trim(),
        [],
        EQLITE_DATABASE_ID,
      )
      .catch((err: Error) => {
        console.warn(
          `[EQLiteSync] Sync states table creation warning: ${err.message}`,
        )
      })

    for (const meta of this.dataSource.entityMetadatas) {
      await this.createEQLiteTable(meta)
    }
  }

  /** Quote identifier to handle reserved SQL keywords like "transaction" */
  private quoteIdent(name: string): string {
    // Double-quote the identifier and escape any existing quotes
    return `"${name.replace(/"/g, '""')}"`
  }

  private async createEQLiteTable(meta: EntityMetadata): Promise<void> {
    // Validate table name for SQL safety
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(meta.tableName)) {
      throw new Error(`Invalid table name for EQLite: ${meta.tableName}`)
    }

    const columns = meta.columns.map((col) => {
      // Validate column name for SQL safety
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col.databaseName)) {
        throw new Error(`Invalid column name for EQLite: ${col.databaseName}`)
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
          type = 'TEXT' // EQLite stores JSON as text
          break
      }

      const nullable = col.isNullable ? '' : ' NOT NULL'
      return `${this.quoteIdent(col.databaseName)} ${type}${nullable}`
    })

    const primaryCols = meta.primaryColumns.map((c) =>
      this.quoteIdent(c.databaseName),
    )

    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.quoteIdent(meta.tableName)} (
        ${columns.join(',\n        ')},
        PRIMARY KEY (${primaryCols.join(', ')})
      )
    `.trim()

    await this.client
      .exec(sql, undefined, EQLITE_DATABASE_ID)
      .catch((err: Error) => {
        console.warn(
          `[EQLiteSync] Table creation for ${meta.tableName} warning: ${err.message}`,
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
      }>('SELECT * FROM _eqlite_sync_states', undefined, EQLITE_DATABASE_ID)
      .catch((err: Error) => {
        console.log(
          `[EQLiteSync] Loading sync states: ${err.message} (will populate on first sync)`,
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
      INSERT INTO _eqlite_sync_states (entity, last_synced_id, last_synced_at, total_synced)
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

    await this.client
      .exec(sql, params.map(convertToQueryParam), EQLITE_DATABASE_ID)
      .catch((err: Error) => {
        console.log(
          `[EQLiteSync] Saving sync state for ${state.entity}: ${err.message}`,
        )
      })
  }

  async getEQLiteReadClient(): Promise<EQLiteClient> {
    return this.client
  }

  /**
   * Query from EQLite - for internal indexer use
   */
  async queryFromEQLite<T>(
    sql: string,
    params?: SqlParam[],
  ): Promise<QueryResult<T>> {
    // Basic SQL injection protection
    if (sql.includes(';') && sql.indexOf(';') !== sql.length - 1) {
      throw new Error('Multiple SQL statements not allowed')
    }
    const result = await this.client.query<T>(
      sql,
      params?.map(convertToQueryParam),
      EQLITE_DATABASE_ID,
    )
    return { rows: result.rows, rowCount: result.rowCount }
  }

  getStats(): {
    enabled: boolean
    running: boolean
    entities: number
    states: Record<string, SyncState>
  } {
    return {
      enabled: EQLITE_ENABLED,
      running: this.running,
      entities: syncStates.size,
      states: Object.fromEntries(syncStates),
    }
  }
}

let eqliteSyncService: EQLiteSyncService | null = null

export function getEQLiteSync(): EQLiteSyncService {
  if (!eqliteSyncService) {
    eqliteSyncService = new EQLiteSyncService()
  }
  return eqliteSyncService
}

export function resetEQLiteSync(): void {
  if (eqliteSyncService) {
    eqliteSyncService.stop().catch((err: Error) => {
      console.warn(`[EQLiteSync] Error during shutdown: ${err.message}`)
    })
    eqliteSyncService = null
  }
}

// For EQLiteClient type, import directly from @jejunetwork/db
