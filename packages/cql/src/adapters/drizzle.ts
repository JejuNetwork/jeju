/**
 * Drizzle ORM Adapter for CovenantSQL
 *
 * Provides a Drizzle-compatible interface for CQL databases.
 * Allows using standard Drizzle schemas and queries with CQL.
 *
 * @example
 * ```typescript
 * import { drizzle } from '@jeju/cql/adapters';
 * import { users, posts } from './schema';
 *
 * const db = drizzle(cqlClient, databaseId);
 *
 * // Use standard Drizzle queries
 * const allUsers = await db.select().from(users);
 * ```
 */

import type { CQLClient } from '../client.js';
import type { ExecResult, QueryResult } from '../types.js';

// ============================================================================
// Types
// ============================================================================

interface DrizzleCQLConfig {
  logger?: boolean | DrizzleLogger;
}

interface DrizzleLogger {
  logQuery(query: string, params: unknown[]): void;
}

type SQLValue = string | number | boolean | null | bigint | Uint8Array;

interface PreparedQuery<T = unknown> {
  execute(): Promise<T[]>;
  values: SQLValue[];
}

interface DrizzleCQL {
  select: <T extends Record<string, unknown>>() => SelectBuilder<T>;
  insert: <T extends Record<string, unknown>>(table: TableRef<T>) => InsertBuilder<T>;
  update: <T extends Record<string, unknown>>(table: TableRef<T>) => UpdateBuilder<T>;
  delete: <T extends Record<string, unknown>>(table: TableRef<T>) => DeleteBuilder<T>;
  execute: <T>(sql: SQL) => Promise<QueryResult<T>>;
  run: (sql: SQL) => Promise<ExecResult>;
  transaction: <T>(fn: (tx: DrizzleCQL) => Promise<T>) => Promise<T>;
}

interface TableRef<_T = unknown> {
  _: { name: string; columns: Record<string, ColumnRef> };
}

interface ColumnRef {
  name: string;
  dataType: string;
}

interface SQL {
  toQuery(): { sql: string; params: SQLValue[] };
}

// ============================================================================
// Query Builders
// ============================================================================

class SelectBuilder<T extends Record<string, unknown>> {
  private client: CQLClient;
  private databaseId: string;
  private tableName: string | null = null;
  private columns: string[] = ['*'];
  private whereClause: string | null = null;
  private whereParams: SQLValue[] = [];
  private orderByClause: string | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;

  constructor(client: CQLClient, databaseId: string) {
    this.client = client;
    this.databaseId = databaseId;
  }

  from(table: TableRef<T> | string): this {
    this.tableName = typeof table === 'string' ? table : table._.name;
    return this;
  }

  where(condition: SQL | string, ...params: SQLValue[]): this {
    if (typeof condition === 'string') {
      this.whereClause = condition;
      this.whereParams = params;
    } else {
      const q = condition.toQuery();
      this.whereClause = q.sql;
      this.whereParams = q.params;
    }
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderByClause = `${column} ${direction.toUpperCase()}`;
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  offset(count: number): this {
    this.offsetValue = count;
    return this;
  }

  async execute(): Promise<T[]> {
    if (!this.tableName) {
      throw new Error('Table not specified. Call .from() first.');
    }

    let sql = `SELECT ${this.columns.join(', ')} FROM ${this.tableName}`;

    if (this.whereClause) {
      sql += ` WHERE ${this.whereClause}`;
    }
    if (this.orderByClause) {
      sql += ` ORDER BY ${this.orderByClause}`;
    }
    if (this.limitValue !== null) {
      sql += ` LIMIT ${this.limitValue}`;
    }
    if (this.offsetValue !== null) {
      sql += ` OFFSET ${this.offsetValue}`;
    }

    const result = await this.client.query<T>(sql, this.whereParams, this.databaseId);
    return result.rows;
  }

  prepare(): PreparedQuery<T> {
    return {
      execute: () => this.execute(),
      values: this.whereParams,
    };
  }
}

class InsertBuilder<T extends Record<string, unknown>> {
  private client: CQLClient;
  private databaseId: string;
  private tableName: string;
  private data: Partial<T>[] = [];

  constructor(client: CQLClient, databaseId: string, table: TableRef<T>) {
    this.client = client;
    this.databaseId = databaseId;
    this.tableName = table._.name;
  }

  values(...rows: Partial<T>[]): this {
    this.data.push(...rows);
    return this;
  }

  async execute(): Promise<ExecResult> {
    if (this.data.length === 0) {
      throw new Error('No values to insert');
    }

    const columns = Object.keys(this.data[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const allParams: SQLValue[] = [];

    const valuesClauses = this.data.map((row) => {
      columns.forEach((col) => {
        const val = row[col as keyof T];
        allParams.push(val as SQLValue);
      });
      return `(${placeholders})`;
    });

    const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES ${valuesClauses.join(', ')}`;

    return this.client.exec(sql, allParams, this.databaseId);
  }

  returning(): this {
    // CQL doesn't support RETURNING, but we keep API compatibility
    return this;
  }
}

class UpdateBuilder<T extends Record<string, unknown>> {
  private client: CQLClient;
  private databaseId: string;
  private tableName: string;
  private setData: Partial<T> = {} as Partial<T>;
  private whereClause: string | null = null;
  private whereParams: SQLValue[] = [];

  constructor(client: CQLClient, databaseId: string, table: TableRef<T>) {
    this.client = client;
    this.databaseId = databaseId;
    this.tableName = table._.name;
  }

  set(data: Partial<T>): this {
    this.setData = data;
    return this;
  }

  where(condition: SQL | string, ...params: SQLValue[]): this {
    if (typeof condition === 'string') {
      this.whereClause = condition;
      this.whereParams = params;
    } else {
      const q = condition.toQuery();
      this.whereClause = q.sql;
      this.whereParams = q.params;
    }
    return this;
  }

  async execute(): Promise<ExecResult> {
    const columns = Object.keys(this.setData);
    if (columns.length === 0) {
      throw new Error('No values to update');
    }

    const setClause = columns.map((col) => `${col} = ?`).join(', ');
    const params: SQLValue[] = columns.map((col) => this.setData[col as keyof T] as SQLValue);
    params.push(...this.whereParams);

    let sql = `UPDATE ${this.tableName} SET ${setClause}`;
    if (this.whereClause) {
      sql += ` WHERE ${this.whereClause}`;
    }

    return this.client.exec(sql, params, this.databaseId);
  }
}

class DeleteBuilder<T extends Record<string, unknown>> {
  private client: CQLClient;
  private databaseId: string;
  private tableName: string;
  private whereClause: string | null = null;
  private whereParams: SQLValue[] = [];

  constructor(client: CQLClient, databaseId: string, table: TableRef<T>) {
    this.client = client;
    this.databaseId = databaseId;
    this.tableName = table._.name;
  }

  where(condition: SQL | string, ...params: SQLValue[]): this {
    if (typeof condition === 'string') {
      this.whereClause = condition;
      this.whereParams = params;
    } else {
      const q = condition.toQuery();
      this.whereClause = q.sql;
      this.whereParams = q.params;
    }
    return this;
  }

  async execute(): Promise<ExecResult> {
    let sql = `DELETE FROM ${this.tableName}`;
    if (this.whereClause) {
      sql += ` WHERE ${this.whereClause}`;
    }

    return this.client.exec(sql, this.whereParams, this.databaseId);
  }
}

// ============================================================================
// Drizzle Adapter
// ============================================================================

function createDrizzleCQL(
  client: CQLClient,
  databaseId: string,
  config?: DrizzleCQLConfig
): DrizzleCQL {
  const logger = config?.logger;

  function logQuery(sql: string, params: unknown[]): void {
    if (logger === true) {
      console.log('[CQL Drizzle]', sql, params);
    } else if (typeof logger === 'object' && logger.logQuery) {
      logger.logQuery(sql, params);
    }
  }

  const db: DrizzleCQL = {
    select<T extends Record<string, unknown>>(): SelectBuilder<T> {
      return new SelectBuilder<T>(client, databaseId);
    },

    insert<T extends Record<string, unknown>>(table: TableRef<T>): InsertBuilder<T> {
      return new InsertBuilder<T>(client, databaseId, table);
    },

    update<T extends Record<string, unknown>>(table: TableRef<T>): UpdateBuilder<T> {
      return new UpdateBuilder<T>(client, databaseId, table);
    },

    delete<T extends Record<string, unknown>>(table: TableRef<T>): DeleteBuilder<T> {
      return new DeleteBuilder<T>(client, databaseId, table);
    },

    async execute<T>(sql: SQL): Promise<QueryResult<T>> {
      const q = sql.toQuery();
      logQuery(q.sql, q.params);
      return client.query<T>(q.sql, q.params, databaseId);
    },

    async run(sql: SQL): Promise<ExecResult> {
      const q = sql.toQuery();
      logQuery(q.sql, q.params);
      return client.exec(q.sql, q.params, databaseId);
    },

    async transaction<T>(fn: (tx: DrizzleCQL) => Promise<T>): Promise<T> {
      const conn = await client.connect(databaseId);
      const tx = await conn.beginTransaction();

      try {
        // Create a transaction-scoped DB wrapper
        const txDb: DrizzleCQL = {
          ...db,
          async execute<U>(sql: SQL): Promise<QueryResult<U>> {
            const q = sql.toQuery();
            logQuery(q.sql, q.params);
            return tx.query<U>(q.sql, q.params);
          },
          async run(sql: SQL): Promise<ExecResult> {
            const q = sql.toQuery();
            logQuery(q.sql, q.params);
            return tx.exec(q.sql, q.params);
          },
        };

        const result = await fn(txDb);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        client.getPool(databaseId).release(conn);
      }
    },
  };

  return db;
}

// ============================================================================
// SQL Helper
// ============================================================================

export function sql(strings: TemplateStringsArray, ...values: SQLValue[]): SQL {
  return {
    toQuery() {
      let sqlStr = '';
      const params: SQLValue[] = [];

      strings.forEach((str, i) => {
        sqlStr += str;
        if (i < values.length) {
          sqlStr += '?';
          params.push(values[i]);
        }
      });

      return { sql: sqlStr, params };
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

export { createDrizzleCQL as drizzle };
export type { DrizzleCQL, DrizzleCQLConfig, TableRef, SQL, PreparedQuery };

