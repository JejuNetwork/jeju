/**
 * Drizzle ORM Adapter for SQLIT
 *
 * Provides compatibility with drizzle-orm for seamless database migrations
 * from PostgreSQL/Neon to SQLIT.
 *
 * @example
 * ```typescript
 * import { drizzle } from '@jejunetwork/sqlit/drizzle'
 * import { users } from './schema'
 *
 * const db = await drizzle({
 *   endpoint: 'http://localhost:4661',
 *   dbid: 'my-database',
 * })
 *
 * const allUsers = await db.select().from(users)
 * ```
 */

import { Connection } from './Connection'
import type { ConnectionConfig } from './ConnectionConfig'
import { ConnectionPool, type PoolConfig } from './ConnectionPool'

// ============================================================================
// Types
// ============================================================================

export interface DrizzleConfig extends ConnectionConfig {
  pool?: boolean
  poolConfig?: Partial<PoolConfig>
}

export interface QueryResultRow {
  [column: string]: unknown
}

export interface QueryResult<T = QueryResultRow> {
  rows: T[]
  rowCount: number
  command?: string
}

// Removed unused type

// SQL template tag result
export interface SQLChunk {
  sql: string
  params: unknown[]
}

// ============================================================================
// SQL Template Tag
// ============================================================================

/**
 * SQL template tag for safe query building
 *
 * @example
 * ```typescript
 * const id = 1
 * const result = await db.execute(sql`SELECT * FROM users WHERE id = ${id}`)
 * ```
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SQLChunk {
  let sqlString = ''
  const params: unknown[] = []

  for (let i = 0; i < strings.length; i++) {
    sqlString += strings[i]
    if (i < values.length) {
      const value = values[i]
      // Handle nested SQL chunks
      if (isSQL(value)) {
        sqlString += value.sql
        params.push(...value.params)
      } else {
        sqlString += '?'
        params.push(value)
      }
    }
  }

  return { sql: sqlString, params }
}

function isSQL(value: unknown): value is SQLChunk {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sql' in value &&
    'params' in value
  )
}

// ============================================================================
// Drizzle-Compatible Query Builder
// ============================================================================

interface SelectBuilder<T> {
  from(table: TableLike): FromBuilder<T>
}

interface FromBuilder<T> {
  where(condition: SQLChunk): WhereBuilder<T>
  orderBy(...columns: SQLChunk[]): OrderByBuilder<T>
  limit(count: number): LimitBuilder<T>
  offset(offset: number): OffsetBuilder<T>
  then<TResult = T[]>(
    onfulfilled?: (value: T[]) => TResult | PromiseLike<TResult>,
  ): Promise<TResult>
}

interface WhereBuilder<T> extends FromBuilder<T> {}
interface OrderByBuilder<T> extends FromBuilder<T> {}
interface LimitBuilder<T> extends FromBuilder<T> {}
interface OffsetBuilder<T> extends FromBuilder<T> {}

interface InsertBuilder<T> {
  values(data: Partial<T> | Partial<T>[]): InsertValuesBuilder<T>
}

interface InsertValuesBuilder<T> {
  returning(): ReturningBuilder<T>
  onConflictDoNothing(): InsertValuesBuilder<T>
  onConflictDoUpdate(config: {
    target: SQLChunk
    set: Partial<T>
  }): InsertValuesBuilder<T>
  then<TResult = QueryResult>(
    onfulfilled?: (value: QueryResult) => TResult | PromiseLike<TResult>,
  ): Promise<TResult>
}

interface UpdateBuilder<T> {
  set(data: Partial<T>): UpdateSetBuilder<T>
}

interface UpdateSetBuilder<T> {
  where(condition: SQLChunk): UpdateWhereBuilder<T>
  returning(): ReturningBuilder<T>
  then<TResult = QueryResult>(
    onfulfilled?: (value: QueryResult) => TResult | PromiseLike<TResult>,
  ): Promise<TResult>
}

interface UpdateWhereBuilder<T> extends UpdateSetBuilder<T> {}

interface DeleteBuilder<T> {
  where(condition: SQLChunk): DeleteWhereBuilder<T>
  returning(): ReturningBuilder<T>
  then<TResult = QueryResult>(
    onfulfilled?: (value: QueryResult) => TResult | PromiseLike<TResult>,
  ): Promise<TResult>
}

interface DeleteWhereBuilder<T> extends DeleteBuilder<T> {}

interface ReturningBuilder<T> {
  then<TResult = T[]>(
    onfulfilled?: (value: T[]) => TResult | PromiseLike<TResult>,
  ): Promise<TResult>
}

interface TableLike {
  _: {
    name: string
    columns: Record<string, ColumnLike>
  }
}

interface ColumnLike {
  name: string
  dataType: string
}

// ============================================================================
// SQLIT Drizzle Database
// ============================================================================

export class SQLitDrizzle {
  private connection: Connection | null = null
  private pool: ConnectionPool | null = null
  private config: DrizzleConfig

  constructor(config: DrizzleConfig) {
    this.config = config
  }

  /**
   * Initialize the database connection
   */
  async connect(): Promise<this> {
    if (this.config.pool) {
      this.pool = new ConnectionPool({
        endpoint: this.config.endpoint,
        dbid: this.config.dbid,
        minConnections: this.config.poolConfig?.minConnections ?? 2,
        maxConnections: this.config.poolConfig?.maxConnections ?? 10,
        timeout: this.config.timeout,
        debug: this.config.debug,
      })
      await this.pool.initialize()
    } else {
      this.connection = new Connection(this.config)
      await this.connection.connect()
    }
    return this
  }

  /**
   * Execute a raw SQL query
   */
  async execute<T = QueryResultRow>(
    query: SQLChunk | string,
  ): Promise<QueryResult<T>> {
    const { sqlString, params } = this.parseQuery(query)
    const rows = await this.runQuery(sqlString, params)
    return {
      rows: (rows ?? []) as T[],
      rowCount: rows?.length ?? 0,
    }
  }

  /**
   * Select query builder
   */
  select<T = QueryResultRow>(
    columns?: Record<string, SQLChunk>,
  ): SelectBuilder<T> {
    const db = this
    const columnList = columns
      ? Object.entries(columns)
          .map(([alias, col]) => `${col.sql} AS ${alias}`)
          .join(', ')
      : '*'

    return {
      from(table: TableLike): FromBuilder<T> {
        const sqlParts = [`SELECT ${columnList} FROM ${table._.name}`]
        let whereClause: SQLChunk | null = null
        let orderByColumns: SQLChunk[] = []
        let limitValue: number | null = null
        let offsetValue: number | null = null

        const builder: FromBuilder<T> = {
          where(condition: SQLChunk) {
            whereClause = condition
            return builder
          },
          orderBy(...columns: SQLChunk[]) {
            orderByColumns = columns
            return builder
          },
          limit(count: number) {
            limitValue = count
            return builder
          },
          offset(offset: number) {
            offsetValue = offset
            return builder
          },
          // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
          async then<TResult = T[]>(
            onfulfilled?: (value: T[]) => TResult | PromiseLike<TResult>,
          ): Promise<TResult> {
            let query = sqlParts.join(' ')
            const params: unknown[] = []

            if (whereClause) {
              query += ` WHERE ${whereClause.sql}`
              params.push(...whereClause.params)
            }

            if (orderByColumns.length > 0) {
              query += ` ORDER BY ${orderByColumns.map((c) => c.sql).join(', ')}`
              for (const c of orderByColumns) {
                params.push(...c.params)
              }
            }

            if (limitValue !== null) {
              query += ` LIMIT ${limitValue}`
            }

            if (offsetValue !== null) {
              query += ` OFFSET ${offsetValue}`
            }

            const result = await db.execute({ sql: query, params })
            const value = result.rows as T[]
            return onfulfilled
              ? onfulfilled(value)
              : (value as unknown as TResult)
          },
        }

        return builder
      },
    }
  }

  /**
   * Insert query builder
   */
  insert<T>(table: TableLike): InsertBuilder<T> {
    const db = this
    const tableName = table._.name

    return {
      values(data: Partial<T> | Partial<T>[]): InsertValuesBuilder<T> {
        const dataArray = Array.isArray(data) ? data : [data]
        let onConflict = ''
        let returning = false

        const builder: InsertValuesBuilder<T> = {
          returning() {
            returning = true
            return {
              // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
              async then<TResult = T[]>(
                onfulfilled?: (value: T[]) => TResult | PromiseLike<TResult>,
              ): Promise<TResult> {
                const result = await executeInsert()
                const value = result.rows as T[]
                return onfulfilled
                  ? onfulfilled(value)
                  : (value as unknown as TResult)
              },
            }
          },
          onConflictDoNothing() {
            onConflict = ' ON CONFLICT DO NOTHING'
            return builder
          },
          onConflictDoUpdate(config) {
            const setClause = Object.entries(config.set)
              .map(([key]) => `${key} = excluded.${key}`)
              .join(', ')
            onConflict = ` ON CONFLICT (${config.target.sql}) DO UPDATE SET ${setClause}`
            return builder
          },
          // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
          async then<TResult = QueryResult>(
            onfulfilled?: (
              value: QueryResult,
            ) => TResult | PromiseLike<TResult>,
          ): Promise<TResult> {
            const result = await executeInsert()
            return onfulfilled
              ? onfulfilled(result)
              : (result as unknown as TResult)
          },
        }

        async function executeInsert(): Promise<QueryResult> {
          const columns = Object.keys(dataArray[0] as object)
          const placeholders = dataArray
            .map(() => `(${columns.map(() => '?').join(', ')})`)
            .join(', ')
          const values = dataArray.flatMap((row) =>
            columns.map((col) => (row as Record<string, unknown>)[col]),
          )

          let query = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${placeholders}${onConflict}`
          if (returning) {
            query += ' RETURNING *'
          }

          return db.execute({
            sql: query,
            params: values,
          }) as Promise<QueryResult>
        }

        return builder
      },
    }
  }

  /**
   * Update query builder
   */
  update<T>(table: TableLike): UpdateBuilder<T> {
    const db = this
    const tableName = table._.name

    return {
      set(data: Partial<T>): UpdateSetBuilder<T> {
        let whereClause: SQLChunk | null = null
        let returning = false

        const builder: UpdateSetBuilder<T> = {
          where(condition: SQLChunk) {
            whereClause = condition
            return builder
          },
          returning() {
            returning = true
            return {
              // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
              async then<TResult = T[]>(
                onfulfilled?: (value: T[]) => TResult | PromiseLike<TResult>,
              ): Promise<TResult> {
                const result = await executeUpdate()
                const value = result.rows as T[]
                return onfulfilled
                  ? onfulfilled(value)
                  : (value as unknown as TResult)
              },
            }
          },
          // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
          async then<TResult = QueryResult>(
            onfulfilled?: (
              value: QueryResult,
            ) => TResult | PromiseLike<TResult>,
          ): Promise<TResult> {
            const result = await executeUpdate()
            return onfulfilled
              ? onfulfilled(result)
              : (result as unknown as TResult)
          },
        }

        async function executeUpdate(): Promise<QueryResult> {
          const columns = Object.keys(data as object)
          const setClause = columns.map((col) => `${col} = ?`).join(', ')
          const values = columns.map(
            (col) => (data as Record<string, unknown>)[col],
          )

          let query = `UPDATE ${tableName} SET ${setClause}`
          const params = [...values]

          if (whereClause) {
            query += ` WHERE ${whereClause.sql}`
            params.push(...whereClause.params)
          }

          if (returning) {
            query += ' RETURNING *'
          }

          return db.execute({ sql: query, params }) as Promise<QueryResult>
        }

        return builder
      },
    }
  }

  /**
   * Delete query builder
   */
  delete<T>(table: TableLike): DeleteBuilder<T> {
    const db = this
    const tableName = table._.name

    return {
      where(condition: SQLChunk): DeleteWhereBuilder<T> {
        let returning = false

        const builder: DeleteWhereBuilder<T> = {
          where(newCondition: SQLChunk) {
            // Chain conditions with AND
            condition = {
              sql: `${condition.sql} AND ${newCondition.sql}`,
              params: [...condition.params, ...newCondition.params],
            }
            return builder
          },
          returning() {
            returning = true
            return {
              // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
              async then<TResult = T[]>(
                onfulfilled?: (value: T[]) => TResult | PromiseLike<TResult>,
              ): Promise<TResult> {
                const result = await executeDelete()
                const value = result.rows as T[]
                return onfulfilled
                  ? onfulfilled(value)
                  : (value as unknown as TResult)
              },
            }
          },
          // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
          async then<TResult = QueryResult>(
            onfulfilled?: (
              value: QueryResult,
            ) => TResult | PromiseLike<TResult>,
          ): Promise<TResult> {
            const result = await executeDelete()
            return onfulfilled
              ? onfulfilled(result)
              : (result as unknown as TResult)
          },
        }

        async function executeDelete(): Promise<QueryResult> {
          let query = `DELETE FROM ${tableName} WHERE ${condition.sql}`
          if (returning) {
            query += ' RETURNING *'
          }
          return db.execute({ sql: query, params: condition.params })
        }

        return builder
      },
      returning() {
        return {
          // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
          async then<TResult = T[]>(
            onfulfilled?: (value: T[]) => TResult | PromiseLike<TResult>,
          ): Promise<TResult> {
            const result = await db.execute<T>({
              sql: `DELETE FROM ${tableName} RETURNING *`,
              params: [],
            })
            const value = result.rows as T[]
            return onfulfilled
              ? onfulfilled(value)
              : (value as unknown as TResult)
          },
        }
      },
      // biome-ignore lint/suspicious/noThenProperty: Implementing PromiseLike interface for query builder
      async then<TResult = QueryResult>(
        onfulfilled?: (value: QueryResult) => TResult | PromiseLike<TResult>,
      ): Promise<TResult> {
        const result = await db.execute({
          sql: `DELETE FROM ${tableName}`,
          params: [],
        })
        return onfulfilled
          ? onfulfilled(result as QueryResult)
          : (result as unknown as TResult)
      },
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close()
    }
    if (this.connection) {
      await this.connection.close()
    }
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private parseQuery(query: SQLChunk | string): {
    sqlString: string
    params: unknown[]
  } {
    if (typeof query === 'string') {
      return { sqlString: query, params: [] }
    }
    return { sqlString: query.sql, params: query.params }
  }

  private async runQuery(
    sql: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[] | null> {
    // Determine if it's a read or write operation
    const isRead = sql.trim().toUpperCase().startsWith('SELECT')

    if (this.pool) {
      return isRead ? this.pool.query(sql, params) : this.pool.exec(sql, params)
    }
    if (this.connection) {
      return isRead
        ? this.connection.query(sql, params)
        : this.connection.exec(sql, params)
    }
    throw new Error('Database not connected')
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a Drizzle-compatible SQLIT database instance
 *
 * @example
 * ```typescript
 * const db = await drizzle({
 *   endpoint: 'http://localhost:4661',
 *   dbid: 'my-database',
 *   pool: true,
 * })
 *
 * const users = await db.select().from(usersTable)
 * ```
 */
export async function drizzle(config: DrizzleConfig): Promise<SQLitDrizzle> {
  const db = new SQLitDrizzle(config)
  await db.connect()
  return db
}

// ============================================================================
// Drizzle Schema Helpers
// ============================================================================

/**
 * Comparison operators for WHERE clauses
 */
export const eq = <T>(column: ColumnLike | string, value: T): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} = ?`, params: [value] }
}

export const ne = <T>(column: ColumnLike | string, value: T): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} != ?`, params: [value] }
}

export const gt = <T>(column: ColumnLike | string, value: T): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} > ?`, params: [value] }
}

export const gte = <T>(column: ColumnLike | string, value: T): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} >= ?`, params: [value] }
}

export const lt = <T>(column: ColumnLike | string, value: T): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} < ?`, params: [value] }
}

export const lte = <T>(column: ColumnLike | string, value: T): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} <= ?`, params: [value] }
}

export const isNull = (column: ColumnLike | string): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} IS NULL`, params: [] }
}

export const isNotNull = (column: ColumnLike | string): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} IS NOT NULL`, params: [] }
}

export const inArray = <T>(
  column: ColumnLike | string,
  values: T[],
): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  const placeholders = values.map(() => '?').join(', ')
  return { sql: `${colName} IN (${placeholders})`, params: values }
}

export const notInArray = <T>(
  column: ColumnLike | string,
  values: T[],
): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  const placeholders = values.map(() => '?').join(', ')
  return { sql: `${colName} NOT IN (${placeholders})`, params: values }
}

export const like = (
  column: ColumnLike | string,
  pattern: string,
): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} LIKE ?`, params: [pattern] }
}

export const ilike = (
  column: ColumnLike | string,
  pattern: string,
): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  // SQLit doesn't have ILIKE, use LOWER()
  return { sql: `LOWER(${colName}) LIKE LOWER(?)`, params: [pattern] }
}

export const between = <T>(
  column: ColumnLike | string,
  min: T,
  max: T,
): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} BETWEEN ? AND ?`, params: [min, max] }
}

/**
 * Logical operators
 */
export const and = (...conditions: SQLChunk[]): SQLChunk => {
  const sql = conditions.map((c) => `(${c.sql})`).join(' AND ')
  const params = conditions.flatMap((c) => c.params)
  return { sql, params }
}

export const or = (...conditions: SQLChunk[]): SQLChunk => {
  const sql = conditions.map((c) => `(${c.sql})`).join(' OR ')
  const params = conditions.flatMap((c) => c.params)
  return { sql, params }
}

export const not = (condition: SQLChunk): SQLChunk => {
  return { sql: `NOT (${condition.sql})`, params: condition.params }
}

/**
 * Order by helpers
 */
export const asc = (column: ColumnLike | string): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} ASC`, params: [] }
}

export const desc = (column: ColumnLike | string): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `${colName} DESC`, params: [] }
}

/**
 * Aggregate functions
 */
export const count = (column?: ColumnLike | string): SQLChunk => {
  const colName = column
    ? typeof column === 'string'
      ? column
      : column.name
    : '*'
  return { sql: `COUNT(${colName})`, params: [] }
}

export const sum = (column: ColumnLike | string): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `SUM(${colName})`, params: [] }
}

export const avg = (column: ColumnLike | string): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `AVG(${colName})`, params: [] }
}

export const min = (column: ColumnLike | string): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `MIN(${colName})`, params: [] }
}

export const max = (column: ColumnLike | string): SQLChunk => {
  const colName = typeof column === 'string' ? column : column.name
  return { sql: `MAX(${colName})`, params: [] }
}
