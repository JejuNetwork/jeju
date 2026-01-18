/**
 * Database utilities for Indexer
 *
 * Uses SQLit (distributed SQLite) with Drizzle adapter
 * PostgreSQL is no longer required - all data is stored in SQLit
 */

import {
  getDatabaseId,
  initializeSchema,
  isAvailable,
  count as sqlitCount,
  find as sqlitFind,
  findOne as sqlitFindOne,
  query as sqlitQuery,
} from '../db'

let schemaReady = false

/**
 * Get the database mode - always SQLit
 */
export function getIndexerMode(): 'sqlit' {
  return 'sqlit'
}

/**
 * Check if SQLit is available (replaces isPostgresAvailable)
 */
export function isPostgresAvailable(): boolean {
  // For backwards compatibility, return true when SQLit is available
  return schemaReady
}

/**
 * Check if database schema has been verified as ready
 */
export function isSchemaReady(): boolean {
  return schemaReady
}

/**
 * Mark schema as verified
 */
export function setSchemaVerified(verified: boolean): void {
  schemaReady = verified
}

/**
 * Initialize SQLit database
 * This replaces getDataSource() for PostgreSQL
 */
export async function initializeSQLit(): Promise<boolean> {
  console.log(`[DB] Initializing SQLit database: ${getDatabaseId()}`)

  try {
    // Initialize schema (creates tables if needed)
    await initializeSchema()

    // Verify connection
    const available = await isAvailable()
    if (!available) {
      console.error('[DB] SQLit connection failed')
      return false
    }

    schemaReady = true
    console.log('[DB] SQLit database ready')
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[DB] SQLit initialization failed: ${message}`)
    return false
  }
}

/**
 * Initialize SQLit with retry logic
 */
export async function initializeSQLitWithRetry(
  maxRetries = 3,
  retryDelayMs = 2000,
): Promise<boolean> {
  if (process.env.SKIP_SQLIT === 'true') {
    console.log('[DB] SKIP_SQLIT=true, skipping SQLit initialization')
    return true
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const success = await initializeSQLit()
    if (success) return true

    if (attempt < maxRetries) {
      console.log(`[DB] Retry ${attempt}/${maxRetries} in ${retryDelayMs}ms...`)
      await new Promise((r) => setTimeout(r, retryDelayMs))
    }
  }

  console.error('[DB] All SQLit connection attempts failed')
  return false
}

/**
 * Close database connection (no-op for SQLit, kept for API compatibility)
 */
export async function closeDataSource(): Promise<void> {
  // SQLit connections are managed by the pool
  schemaReady = false
}

/**
 * Verify the database schema exists by checking for required tables.
 */
export async function verifySQLitSchema(): Promise<boolean> {
  const requiredTables = ['block', 'transaction', 'registered_agent', 'account']

  try {
    for (const table of requiredTables) {
      // Try to query the table - if it doesn't exist, this will fail
      // Use a simple SELECT 1 to check table existence without sqlite_master
      try {
        await sqlitQuery<{ ok: number }>(
          `SELECT 1 as ok FROM "${table}" LIMIT 1`,
          [],
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // If error mentions table doesn't exist, schema is incomplete
        if (
          message.includes('no such table') ||
          message.includes('does not exist') ||
          message.includes('syntax error')
        ) {
          console.warn(`[DB] Required table missing or invalid: ${table}`)
          return false
        }
        // Other errors might be OK (e.g., empty table)
      }
    }
    console.log('[DB] Database schema verified')
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[DB] Schema verification failed: ${message}`)
    return false
  }
}

// Re-export query utilities for direct use
export {
  sqlitCount as count,
  sqlitFind as find,
  sqlitFindOne as findOne,
  sqlitQuery as query,
}

// Legacy compatibility - SQLitDataSource wrapper
// This provides a similar interface to TypeORM DataSource for gradual migration

interface Repository<T> {
  find(options?: {
    where?: Record<string, unknown>
    order?: Record<string, 'ASC' | 'DESC'>
    take?: number
    skip?: number
  }): Promise<T[]>
  findOne(options: { where: Record<string, unknown> }): Promise<T | null>
  count(options?: { where?: Record<string, unknown> }): Promise<number>
}

export class SQLitDataSource {
  private _isInitialized = false

  get isInitialized(): boolean {
    return this._isInitialized
  }

  async initialize(): Promise<void> {
    await initializeSQLit()
    this._isInitialized = true
  }

  async destroy(): Promise<void> {
    await closeDataSource()
    this._isInitialized = false
  }

  getRepository<T>(entityClass: {
    new (...args: unknown[]): T
    name: string
  }): Repository<T> {
    const tableName = entityClass.name

    return {
      async find(options = {}) {
        return sqlitFind<T>(tableName, {
          where: options.where as Record<
            string,
            string | number | boolean | null
          >,
          order: options.order,
          take: options.take,
          skip: options.skip,
        })
      },

      async findOne(options) {
        const results = await sqlitFind<T>(tableName, {
          where: options.where as Record<
            string,
            string | number | boolean | null
          >,
          take: 1,
        })
        return results[0] ?? null
      },

      async count(options = {}) {
        return sqlitCount(
          tableName,
          options.where as Record<string, string | number | boolean | null>,
        )
      },
    }
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await sqlitQuery<T>(
      sql,
      params as (string | number | boolean | null | bigint)[],
    )
    return result.rows
  }
}

// Singleton instance for compatibility
let sqlitDataSource: SQLitDataSource | null = null

/**
 * Get SQLit data source (replaces getDataSource for PostgreSQL)
 */
export async function getDataSource(): Promise<SQLitDataSource | null> {
  if (!sqlitDataSource) {
    sqlitDataSource = new SQLitDataSource()
    await sqlitDataSource.initialize()
  }
  return sqlitDataSource
}

/**
 * Get data source with retry (replaces getDataSourceWithRetry)
 */
export async function getDataSourceWithRetry(
  maxRetries = 3,
  retryDelayMs = 2000,
): Promise<SQLitDataSource | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const ds = await getDataSource()
      if (ds?.isInitialized) return ds
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[DB] Attempt ${attempt}/${maxRetries} failed: ${message}`)
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelayMs))
    }
  }

  console.error('[DB] All connection attempts failed')
  return null
}

/**
 * Verify database schema (legacy compatibility)
 */
export async function verifyDatabaseSchema(
  _ds: SQLitDataSource,
): Promise<boolean> {
  return verifySQLitSchema()
}

// Export DataSource type alias for compatibility
export type DataSource = SQLitDataSource
