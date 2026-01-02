/**
 * SQLit Database adapter for Subsquid processor
 *
 * Implements the Database interface from @subsquid/util-internal-processor-tools
 * to work with processor.run() while storing data in SQLit instead of PostgreSQL
 */

import { getSQLit, type QueryParam, type SQLitClient } from '@jejunetwork/db'

// Interface matching subsquid's FinalTxInfo
interface FinalTxInfo {
  prevHead: HashAndHeight
  nextHead: HashAndHeight
  isOnTop: boolean
}

interface HashAndHeight {
  height: number
  hash: string
}

interface DatabaseState {
  height: number
  hash: string
  top: HashAndHeight[]
}

// Entity class type
type EntityClass<E> = { new (...args: unknown[]): E; name?: string }

// Minimal Store interface for our use case
export interface SQLitStoreInterface {
  save<E>(entity: E | E[]): Promise<void>
  insert<E>(entity: E | E[]): Promise<void>
  upsert<E>(entity: E | E[]): Promise<void>
  remove<E>(entity: E | E[]): Promise<void>
  find<E>(entityClass: EntityClass<E>, options?: FindOptions): Promise<E[]>
  get<E>(entityClass: EntityClass<E>, id: string): Promise<E | undefined>
  count<E>(entityClass: EntityClass<E>, options?: FindOptions): Promise<number>
  flush(): Promise<void>
}

interface FindOptions {
  where?: Record<string, QueryParam>
  order?: Record<string, 'ASC' | 'DESC'>
  take?: number
}

// Status table for tracking processor progress
const STATUS_TABLE = '_squid_processor_status'

/**
 * SQLit Database adapter for Subsquid processor
 */
export class SQLitDatabase {
  private client: SQLitClient
  private databaseId: string
  readonly supportsHotBlocks = false

  constructor(options: { databaseId: string }) {
    this.client = getSQLit()
    this.databaseId = options.databaseId
  }

  /**
   * Connect to SQLit and return current state
   */
  async connect(): Promise<DatabaseState> {
    console.log(
      '[SQLitDatabase] Connecting to SQLit database:',
      this.databaseId,
    )

    // Ensure status table exists
    await this.ensureStatusTable()

    // Get current height
    const state = await this.getState()

    console.log('[SQLitDatabase] Connected, current height:', state.height)

    return state
  }

  /**
   * Process a batch of blocks in a transaction
   */
  async transact(
    info: FinalTxInfo,
    cb: (store: SQLitStoreInterface) => Promise<void>,
  ): Promise<void> {
    const store = new SQLitStore(this.client, this.databaseId)

    try {
      await cb(store)

      // Flush all pending writes
      await store.flush()

      // Update processor status
      await this.updateStatus(info.nextHead.height, info.nextHead.hash)

      console.log(`[SQLitDatabase] Processed to block ${info.nextHead.height}`)
    } catch (error) {
      console.error('[SQLitDatabase] Transaction failed:', error)
      throw error
    }
  }

  /**
   * Ensure status table exists
   */
  private async ensureStatusTable(): Promise<void> {
    try {
      await this.client.exec(
        `
        CREATE TABLE IF NOT EXISTS "${STATUS_TABLE}" (
          id INTEGER PRIMARY KEY,
          height INTEGER NOT NULL,
          hash TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        `,
        [],
        this.databaseId,
      )
    } catch (error) {
      console.warn('[SQLitDatabase] Failed to create status table:', error)
    }
  }

  /**
   * Get current processor state
   */
  private async getState(): Promise<DatabaseState> {
    try {
      const result = await this.client.query<{ height: number; hash: string }>(
        `SELECT height, hash FROM "${STATUS_TABLE}" WHERE id = 1 LIMIT 1`,
        [],
        this.databaseId,
      )

      if (result.rows.length > 0) {
        const { height, hash } = result.rows[0]
        return {
          height,
          hash,
          top: [{ height, hash }],
        }
      }
    } catch {
      // Table might not exist or be empty
    }

    // Return initial state
    return {
      height: -1,
      hash: '',
      top: [],
    }
  }

  /**
   * Update processor status
   */
  private async updateStatus(height: number, hash: string): Promise<void> {
    await this.client.exec(
      `
      INSERT INTO "${STATUS_TABLE}" (id, height, hash, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        height = excluded.height,
        hash = excluded.hash,
        updated_at = excluded.updated_at
      `,
      [height, hash, new Date().toISOString()],
      this.databaseId,
    )
  }
}

/**
 * SQLit Store implementation
 */
class SQLitStore implements SQLitStoreInterface {
  private client: SQLitClient
  private databaseId: string
  private pendingWrites: Map<string, Record<string, unknown>[]> = new Map()

  constructor(client: SQLitClient, databaseId: string) {
    this.client = client
    this.databaseId = databaseId
  }

  async save<E>(entity: E | E[]): Promise<void> {
    const entities = Array.isArray(entity) ? entity : [entity]
    if (entities.length === 0) return

    for (const e of entities) {
      const entityObj = e as Record<string, unknown>
      const entityCtor = entityObj.constructor as EntityClass<E>
      const tableName = this.getTableName(entityCtor)

      if (!this.pendingWrites.has(tableName)) {
        this.pendingWrites.set(tableName, [])
      }
      const pending = this.pendingWrites.get(tableName)
      if (pending) {
        pending.push(entityObj)
      }
    }
  }

  async insert<E>(entity: E | E[]): Promise<void> {
    return this.save(entity)
  }

  async upsert<E>(entity: E | E[]): Promise<void> {
    return this.save(entity)
  }

  async remove<E>(entity: E | E[]): Promise<void> {
    const entities = Array.isArray(entity) ? entity : [entity]
    if (entities.length === 0) return

    for (const e of entities) {
      const entityObj = e as Record<string, unknown>
      const entityCtor = entityObj.constructor as EntityClass<E>
      const tableName = this.getTableName(entityCtor)
      const id = entityObj.id as QueryParam

      await this.client.exec(
        `DELETE FROM "${tableName}" WHERE id = ?`,
        [id],
        this.databaseId,
      )
    }
  }

  async find<E>(
    entityClass: EntityClass<E>,
    options?: FindOptions,
  ): Promise<E[]> {
    const tableName = this.getTableName(entityClass)
    let sql = `SELECT * FROM "${tableName}"`
    const params: QueryParam[] = []

    if (options?.where) {
      const conditions: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`"${key}" = ?`)
        params.push(value)
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
    }

    if (options?.order) {
      const orderClauses: string[] = []
      for (const [key, direction] of Object.entries(options.order)) {
        orderClauses.push(`"${key}" ${direction}`)
      }
      if (orderClauses.length > 0) {
        sql += ` ORDER BY ${orderClauses.join(', ')}`
      }
    }

    if (options?.take) {
      sql += ` LIMIT ${options.take}`
    }

    const result = await this.client.query(sql, params, this.databaseId)
    return result.rows as E[]
  }

  async get<E>(
    entityClass: EntityClass<E>,
    id: string,
  ): Promise<E | undefined> {
    const tableName = this.getTableName(entityClass)
    const result = await this.client.query(
      `SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`,
      [id],
      this.databaseId,
    )
    return result.rows[0] as E | undefined
  }

  async count<E>(
    entityClass: EntityClass<E>,
    options?: FindOptions,
  ): Promise<number> {
    const tableName = this.getTableName(entityClass)
    let sql = `SELECT COUNT(*) as count FROM "${tableName}"`
    const params: QueryParam[] = []

    if (options?.where) {
      const conditions: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`"${key}" = ?`)
        params.push(value)
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
    }

    const result = await this.client.query<{ count: number }>(
      sql,
      params,
      this.databaseId,
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async flush(): Promise<void> {
    for (const [tableName, entities] of this.pendingWrites.entries()) {
      if (entities.length === 0) continue
      await this.batchUpsert(tableName, entities)
    }
    this.pendingWrites.clear()
  }

  private async batchUpsert(
    tableName: string,
    entities: Record<string, unknown>[],
  ): Promise<void> {
    if (entities.length === 0) return

    const sample = entities[0]
    const columns = Object.keys(sample).filter(
      (k) => k !== 'constructor' && !k.startsWith('_'),
    )

    if (columns.length === 0) {
      console.warn(`[SQLitStore] No columns found for ${tableName}`)
      return
    }

    const quotedCols = columns.map((c) => `"${c}"`)
    const placeholders = columns.map(() => '?').join(', ')
    const values: QueryParam[] = []
    const valuesClauses: string[] = []

    for (const entity of entities) {
      valuesClauses.push(`(${placeholders})`)
      for (const col of columns) {
        const val = entity[col]
        if (val === null || val === undefined) {
          values.push(null)
        } else if (val instanceof Date) {
          values.push(val.toISOString())
        } else if (typeof val === 'bigint') {
          values.push(val.toString())
        } else if (
          typeof val === 'object' &&
          !Buffer.isBuffer(val) &&
          !(val instanceof Uint8Array)
        ) {
          values.push(JSON.stringify(val))
        } else if (
          typeof val === 'string' ||
          typeof val === 'number' ||
          typeof val === 'boolean'
        ) {
          values.push(val)
        } else if (val instanceof Uint8Array) {
          values.push(val)
        } else {
          // Fallback - stringify unknown types
          values.push(String(val))
        }
      }
    }

    const updateCols = columns.filter((c) => c !== 'id')
    const updateSet =
      updateCols.length > 0
        ? updateCols.map((c) => `"${c}" = excluded."${c}"`).join(', ')
        : '"id" = excluded."id"' // Fallback if only id column

    const sql = `
      INSERT INTO "${tableName}" (${quotedCols.join(', ')})
      VALUES ${valuesClauses.join(', ')}
      ON CONFLICT (id) DO UPDATE SET ${updateSet}
    `.trim()

    try {
      await this.client.exec(sql, values, this.databaseId)
      console.log(`[SQLitStore] Saved ${entities.length} ${tableName} records`)
    } catch (error) {
      console.error(`[SQLitStore] Failed to save ${tableName}:`, error)
    }
  }

  private getTableName<E>(entityClass: EntityClass<E>): string {
    const name = entityClass.name ?? 'unknown'
    return name
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase()
  }
}
