/**
 * Drizzle ORM Adapter for SQLit
 *
 * Provides a Drizzle-compatible interface for SQLit databases.
 * Allows using standard Drizzle schemas and queries with SQLit.
 *
 * @example
 * ```typescript
 * import { drizzle } from '@jejunetwork/db/adapters';
 * import { users, posts } from './schema';
 *
 * const db = drizzle(sqlitClient, databaseId);
 *
 * // Use standard Drizzle queries
 * const allUsers = await db.select().from(users);
 * ```
 */

import type { SQLitClient } from '../client.js'
import type { ExecResult, QueryParam, QueryResult } from '../types.js'
import { validateSQLIdentifier, validateSQLIdentifiers } from '../utils.js'

// ============================================================================
// Types
// ============================================================================

/** A table object compatible with Drizzle schema tables */
interface DrizzleTable {
  _: {
    name: string
    columns: Record<string, unknown>
  }
}

/** SQL query object with toQuery method */
interface SQLQuery {
  toQuery(): { sql: string; params: QueryParam[] }
}

/** Logger interface for DrizzleSQLit */
interface DrizzleLogger {
  logQuery(query: string, params: QueryParam[]): void
}

/** Configuration options for DrizzleSQLit */
export interface DrizzleSQLitConfig {
  /** Enable query logging (true for console, or custom logger) */
  logger?: boolean | DrizzleLogger
}

/** The main Drizzle-compatible SQLit database interface */
export interface DrizzleSQLit {
  /** Start a SELECT query */
  select(): SelectBuilder
  /** Start an INSERT query */
  insert<T extends DrizzleTable>(table: T): InsertBuilder<T>
  /** Start an UPDATE query */
  update<T extends DrizzleTable>(table: T): UpdateBuilder<T>
  /** Start a DELETE query */
  delete<T extends DrizzleTable>(table: T): DeleteBuilder<T>
  /** Execute a raw SQL query */
  execute<T>(sql: SQLQuery): Promise<QueryResult<T>>
  /** Execute a raw SQL statement */
  run(sql: SQLQuery): Promise<ExecResult>
  /** Execute within a transaction */
  transaction<T>(fn: (tx: DrizzleSQLit) => Promise<T>): Promise<T>
}

// ============================================================================
// Query Builders
// ============================================================================

class SelectBuilder {
  private client: SQLitClient
  private databaseId: string
  private tableName: string | null = null
  private columns: string[] = ['*']
  private whereClause: string | null = null
  private whereParams: QueryParam[] = []
  private orderByClause: string | null = null
  private limitValue: number | null = null
  private offsetValue: number | null = null

  constructor(client: SQLitClient, databaseId: string) {
    this.client = client
    this.databaseId = databaseId
  }

  from(table: string | DrizzleTable): this {
    const rawName = typeof table === 'string' ? table : table._.name
    // Validate table name to prevent SQL injection
    this.tableName = validateSQLIdentifier(rawName, 'table')
    return this
  }

  where(condition: string | SQLQuery, ...params: QueryParam[]): this {
    if (typeof condition === 'string') {
      this.whereClause = condition
      this.whereParams = params
    } else {
      const q = condition.toQuery()
      this.whereClause = q.sql
      this.whereParams = q.params
    }
    return this
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    // Validate column name to prevent SQL injection
    const safeColumn = validateSQLIdentifier(column, 'column')
    this.orderByClause = `${safeColumn} ${direction.toUpperCase()}`
    return this
  }

  limit(count: number): this {
    this.limitValue = count
    return this
  }

  offset(count: number): this {
    this.offsetValue = count
    return this
  }

  async execute<T>(): Promise<T[]> {
    if (!this.tableName) {
      throw new Error('Table not specified. Call .from() first.')
    }

    let sql = `SELECT ${this.columns.join(', ')} FROM ${this.tableName}`

    if (this.whereClause) {
      sql += ` WHERE ${this.whereClause}`
    }
    if (this.orderByClause) {
      sql += ` ORDER BY ${this.orderByClause}`
    }
    if (this.limitValue !== null) {
      sql += ` LIMIT ${this.limitValue}`
    }
    if (this.offsetValue !== null) {
      sql += ` OFFSET ${this.offsetValue}`
    }

    const result = await this.client.query<T>(
      sql,
      this.whereParams,
      this.databaseId,
    )
    return result.rows
  }

  prepare(): { execute: () => Promise<unknown[]>; values: QueryParam[] } {
    return {
      execute: () => this.execute(),
      values: this.whereParams,
    }
  }
}

class InsertBuilder<T extends DrizzleTable> {
  private client: SQLitClient
  private databaseId: string
  private tableName: string
  private data: Record<string, QueryParam>[] = []

  constructor(client: SQLitClient, databaseId: string, table: T) {
    this.client = client
    this.databaseId = databaseId
    // Validate table name to prevent SQL injection
    this.tableName = validateSQLIdentifier(table._.name, 'table')
  }

  values(...rows: Record<string, QueryParam>[]): this {
    this.data.push(...rows)
    return this
  }

  async execute(): Promise<ExecResult> {
    if (this.data.length === 0) {
      throw new Error('No values to insert')
    }

    const columns = Object.keys(this.data[0])
    // Validate column names to prevent SQL injection
    const safeColumns = validateSQLIdentifiers(columns, 'column')
    const placeholders = safeColumns.map(() => '?').join(', ')
    const allParams: QueryParam[] = []

    const valuesClauses = this.data.map((row) => {
      columns.forEach((col) => {
        const val = row[col]
        allParams.push(val)
      })
      return `(${placeholders})`
    })

    const sql = `INSERT INTO ${this.tableName} (${safeColumns.join(', ')}) VALUES ${valuesClauses.join(', ')}`
    return this.client.exec(sql, allParams, this.databaseId)
  }

  returning(): this {
    // SQLit doesn't support RETURNING, but we keep API compatibility
    return this
  }
}

class UpdateBuilder<T extends DrizzleTable> {
  private client: SQLitClient
  private databaseId: string
  private tableName: string
  private setData: Record<string, QueryParam> = {}
  private whereClause: string | null = null
  private whereParams: QueryParam[] = []

  constructor(client: SQLitClient, databaseId: string, table: T) {
    this.client = client
    this.databaseId = databaseId
    // Validate table name to prevent SQL injection
    this.tableName = validateSQLIdentifier(table._.name, 'table')
  }

  set(data: Record<string, QueryParam>): this {
    this.setData = data
    return this
  }

  where(condition: string | SQLQuery, ...params: QueryParam[]): this {
    if (typeof condition === 'string') {
      this.whereClause = condition
      this.whereParams = params
    } else {
      const q = condition.toQuery()
      this.whereClause = q.sql
      this.whereParams = q.params
    }
    return this
  }

  async execute(): Promise<ExecResult> {
    const columns = Object.keys(this.setData)
    if (columns.length === 0) {
      throw new Error('No values to update')
    }

    // Validate column names to prevent SQL injection
    const safeColumns = validateSQLIdentifiers(columns, 'column')
    const setClause = safeColumns.map((col) => `${col} = ?`).join(', ')
    const params: QueryParam[] = columns.map((col) => this.setData[col])
    params.push(...this.whereParams)

    let sql = `UPDATE ${this.tableName} SET ${setClause}`
    if (this.whereClause) {
      sql += ` WHERE ${this.whereClause}`
    }

    return this.client.exec(sql, params, this.databaseId)
  }
}

class DeleteBuilder<T extends DrizzleTable> {
  private client: SQLitClient
  private databaseId: string
  private tableName: string
  private whereClause: string | null = null
  private whereParams: QueryParam[] = []

  constructor(client: SQLitClient, databaseId: string, table: T) {
    this.client = client
    this.databaseId = databaseId
    // Validate table name to prevent SQL injection
    this.tableName = validateSQLIdentifier(table._.name, 'table')
  }

  where(condition: string | SQLQuery, ...params: QueryParam[]): this {
    if (typeof condition === 'string') {
      this.whereClause = condition
      this.whereParams = params
    } else {
      const q = condition.toQuery()
      this.whereClause = q.sql
      this.whereParams = q.params
    }
    return this
  }

  async execute(): Promise<ExecResult> {
    let sql = `DELETE FROM ${this.tableName}`
    if (this.whereClause) {
      sql += ` WHERE ${this.whereClause}`
    }
    return this.client.exec(sql, this.whereParams, this.databaseId)
  }
}

// ============================================================================
// Drizzle Adapter
// ============================================================================

function createDrizzleSQLit(
  client: SQLitClient,
  databaseId: string,
  config?: DrizzleSQLitConfig,
): DrizzleSQLit {
  function logQuery(query: string, params: QueryParam[]): void {
    if (config?.logger === true) {
      // Log query structure without exposing potentially sensitive parameter values
      // Extract just the SQL statement type (SELECT, INSERT, UPDATE, DELETE)
      const statementType =
        query.trim().split(/\s+/)[0].toUpperCase() ?? 'QUERY'
      console.log(
        `[SQLit Drizzle] ${statementType} (params: ${params.length})`,
      )
    } else if (typeof config?.logger === 'object') {
      // Custom loggers receive full data - they're responsible for their own filtering
      config.logger.logQuery(query, params)
    }
  }

  const db: DrizzleSQLit = {
    select() {
      return new SelectBuilder(client, databaseId)
    },

    insert<T extends DrizzleTable>(table: T) {
      return new InsertBuilder(client, databaseId, table)
    },

    update<T extends DrizzleTable>(table: T) {
      return new UpdateBuilder(client, databaseId, table)
    },

    delete<T extends DrizzleTable>(table: T) {
      return new DeleteBuilder(client, databaseId, table)
    },

    async execute<T>(sql: SQLQuery): Promise<QueryResult<T>> {
      const q = sql.toQuery()
      logQuery(q.sql, q.params)
      return client.query<T>(q.sql, q.params, databaseId)
    },

    async run(sql: SQLQuery): Promise<ExecResult> {
      const q = sql.toQuery()
      logQuery(q.sql, q.params)
      return client.exec(q.sql, q.params, databaseId)
    },

    async transaction<T>(fn: (tx: DrizzleSQLit) => Promise<T>): Promise<T> {
      const conn = await client.connect(databaseId)
      const tx = await conn.beginTransaction()

      try {
        // Create a transaction-scoped DB wrapper
        const txDb: DrizzleSQLit = {
          ...db,
          async execute<R>(sql: SQLQuery): Promise<QueryResult<R>> {
            const q = sql.toQuery()
            logQuery(q.sql, q.params)
            return tx.query<R>(q.sql, q.params)
          },
          async run(sql: SQLQuery): Promise<ExecResult> {
            const q = sql.toQuery()
            logQuery(q.sql, q.params)
            return tx.exec(q.sql, q.params)
          },
        }

        const result = await fn(txDb)
        await tx.commit()
        return result
      } catch (error) {
        await tx.rollback()
        throw error
      } finally {
        client.getPool(databaseId).release(conn)
      }
    },
  }

  return db
}

// ============================================================================
// SQL Helper
// ============================================================================

/**
 * Tagged template literal for SQL queries
 *
 * @example
 * ```typescript
 * const id = 123
 * const result = await db.execute(sql`SELECT * FROM users WHERE id = ${id}`)
 * ```
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: QueryParam[]
): SQLQuery {
  return {
    toQuery() {
      let sqlStr = ''
      const params: QueryParam[] = []

      strings.forEach((str, i) => {
        sqlStr += str
        if (i < values.length) {
          sqlStr += '?'
          params.push(values[i])
        }
      })

      return { sql: sqlStr, params }
    },
  }
}

// ============================================================================
// Exports
// ============================================================================

export { createDrizzleSQLit as drizzle }
export type { DrizzleTable, SQLQuery, DrizzleLogger }
