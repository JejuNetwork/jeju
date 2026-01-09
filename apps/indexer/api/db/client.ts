/**
 * SQLit Client for Indexer
 *
 * Provides database access using SQLit with Drizzle-compatible interface
 */

import { getSQLit, type QueryResult, type SQLitClient } from '@jejunetwork/db'
import { type DrizzleSQLit, drizzle, sql } from '@jejunetwork/db/adapters'
import { config } from '../config'
import { INDEX_DDL, SCHEMA_DDL, TABLE_NAMES, type TableName } from './schema'

// Database configuration
const DATABASE_ID = config.sqlitDatabaseId

let client: SQLitClient | null = null
let db: DrizzleSQLit | null = null
let initialized = false

/**
 * Get the SQLit client
 */
export function getClient(): SQLitClient {
  if (!client) {
    client = getSQLit()
  }
  return client
}

/**
 * Get the Drizzle-compatible database interface
 */
export function getDB(): DrizzleSQLit {
  if (!db) {
    db = drizzle(getClient(), DATABASE_ID, { logger: false })
  }
  return db
}

/**
 * Get the database ID
 */
export function getDatabaseId(): string {
  return DATABASE_ID
}

/**
 * Initialize the database schema
 */
export async function initializeSchema(): Promise<void> {
  if (initialized) return

  const sqlit = getClient()
  console.log(`[SQLit] Initializing schema for database: ${DATABASE_ID}`)

  // Create tables
  for (const ddl of SCHEMA_DDL) {
    try {
      await sqlit.exec(ddl, [], DATABASE_ID)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Ignore "table already exists" errors
      if (!message.includes('already exists')) {
        console.error(`[SQLit] Schema error: ${message}`)
        throw err
      }
    }
  }

  // Create indexes (silently skip errors for missing columns - tables may have fewer columns)
  for (const idx of INDEX_DDL) {
    try {
      await sqlit.exec(idx, [], DATABASE_ID)
    } catch {
      // Indexes are optional - silently skip errors for missing columns or already exists
    }
  }

  initialized = true
  console.log('[SQLit] Schema initialized successfully')
}

/**
 * Execute a raw SQL query
 */
export async function query<T>(
  sqlStr: string,
  params: (string | number | boolean | null | bigint)[] = [],
): Promise<QueryResult<T>> {
  return getClient().query<T>(sqlStr, params, DATABASE_ID)
}

/**
 * Execute a raw SQL statement
 */
export async function exec(
  sqlStr: string,
  params: (string | number | boolean | null | bigint)[] = [],
): Promise<void> {
  await getClient().exec(sqlStr, params, DATABASE_ID)
}

/**
 * Get table name from entity class name
 */
export function getTableName(entityName: string): TableName {
  const name = TABLE_NAMES[entityName as keyof typeof TABLE_NAMES]
  if (!name) {
    // Convert PascalCase to snake_case
    return entityName
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase() as TableName
  }
  return name
}

// Query builder helpers

interface FindOptions {
  where?: Record<string, string | number | boolean | null>
  order?: Record<string, 'ASC' | 'DESC'>
  take?: number
  skip?: number
}

/**
 * Find records in a table
 */
export async function find<T>(
  table: string,
  options: FindOptions = {},
): Promise<T[]> {
  const tableName = getTableName(table)
  let sqlStr = `SELECT * FROM "${tableName}"`
  const params: (string | number | boolean | null)[] = []

  if (options.where) {
    const conditions: string[] = []
    for (const [key, value] of Object.entries(options.where)) {
      const snakeKey = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
      if (value === null) {
        conditions.push(`"${snakeKey}" IS NULL`)
      } else {
        conditions.push(`"${snakeKey}" = ?`)
        params.push(value)
      }
    }
    if (conditions.length > 0) {
      sqlStr += ` WHERE ${conditions.join(' AND ')}`
    }
  }

  if (options.order) {
    const orderClauses: string[] = []
    for (const [key, direction] of Object.entries(options.order)) {
      const snakeKey = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
      orderClauses.push(`"${snakeKey}" ${direction}`)
    }
    if (orderClauses.length > 0) {
      sqlStr += ` ORDER BY ${orderClauses.join(', ')}`
    }
  }

  if (options.take !== undefined) {
    sqlStr += ` LIMIT ${options.take}`
  }

  if (options.skip !== undefined) {
    sqlStr += ` OFFSET ${options.skip}`
  }

  const result = await query<T>(sqlStr, params)
  return result.rows.map((row) => toCamelCase(row) as T)
}

/**
 * Find one record by ID
 */
export async function findOne<T>(table: string, id: string): Promise<T | null> {
  const tableName = getTableName(table)
  const result = await query<T>(
    `SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`,
    [id],
  )
  return result.rows.length > 0 ? (toCamelCase(result.rows[0]) as T) : null
}

/**
 * Count records in a table
 */
export async function count(
  table: string,
  where?: Record<string, string | number | boolean | null>,
): Promise<number> {
  const tableName = getTableName(table)
  let sqlStr = `SELECT COUNT(*) as count FROM "${tableName}"`
  const params: (string | number | boolean | null)[] = []

  if (where) {
    const conditions: string[] = []
    for (const [key, value] of Object.entries(where)) {
      const snakeKey = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
      if (value === null) {
        conditions.push(`"${snakeKey}" IS NULL`)
      } else {
        conditions.push(`"${snakeKey}" = ?`)
        params.push(value)
      }
    }
    if (conditions.length > 0) {
      sqlStr += ` WHERE ${conditions.join(' AND ')}`
    }
  }

  const result = await query<{ count: number }>(sqlStr, params)
  return Number(result.rows[0]?.count ?? 0)
}

/**
 * Check if database is available
 */
export async function isAvailable(): Promise<boolean> {
  try {
    await query('SELECT 1 as test')
    return true
  } catch {
    return false
  }
}

/**
 * Get processor status (last indexed block)
 */
export async function getProcessorStatus(): Promise<{
  height: number
  timestamp: string
} | null> {
  try {
    const result = await query<{ height: number; timestamp: string }>(
      'SELECT height, timestamp FROM _squid_processor_status WHERE id = 1',
    )
    return result.rows[0] ?? null
  } catch {
    return null
  }
}

// Helper to convert snake_case keys to camelCase
function toCamelCase<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(toCamelCase) as T
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    )
    result[camelKey] = value
  }
  return result as T
}

export { sql }
