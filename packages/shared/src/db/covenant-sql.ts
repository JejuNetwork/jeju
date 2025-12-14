/**
 * CovenantSQL Driver - Decentralized database layer with strong/eventual consistency.
 * @see https://github.com/CovenantSQL/CovenantSQL
 */

import { EventEmitter } from 'events';

export type ConsistencyLevel = 'strong' | 'eventual';

export interface CovenantSQLConfig {
  /** Primary node endpoint */
  nodes: string[];
  /** Database ID (created by CovenantSQL) */
  databaseId: string;
  /** Private key for authentication */
  privateKey: string;
  /** Default consistency level */
  defaultConsistency: ConsistencyLevel;
  /** Connection pool size */
  poolSize: number;
  /** Query timeout in ms */
  queryTimeout: number;
  /** Retry attempts on failure */
  retryAttempts: number;
  /** Enable query logging */
  logging: boolean;
}

export interface QueryOptions {
  /** Override default consistency */
  consistency?: ConsistencyLevel;
  /** Query timeout override */
  timeout?: number;
  /** Transaction ID for multi-query transactions */
  transactionId?: string;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  affectedRows: number;
  lastInsertId?: string;
  duration: number;
  node: string;
}

export interface TransactionContext {
  id: string;
  startedAt: number;
  queries: string[];
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface TableSchema {
  name: string;
  columns: ColumnDefinition[];
  primaryKey: string[];
  indexes?: IndexDefinition[];
  consistency?: ConsistencyLevel;
}

export interface ColumnDefinition {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'BIGINT' | 'REAL' | 'BLOB' | 'BOOLEAN' | 'TIMESTAMP' | 'JSON';
  nullable?: boolean;
  default?: string | number | boolean | null;
  unique?: boolean;
  references?: { table: string; column: string };
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique?: boolean;
}

interface PooledConnection {
  id: string;
  node: string;
  inUse: boolean;
  lastUsed: number;
  createdAt: number;
}

export class CovenantSQLClient extends EventEmitter {
  private config: CovenantSQLConfig;
  private pool: PooledConnection[] = [];
  private nodeHealth: Map<string, { healthy: boolean; lastCheck: number; latency: number }> = new Map();
  private initialized = false;
  private schemas: Map<string, TableSchema> = new Map();

  constructor(config: Partial<CovenantSQLConfig> & Pick<CovenantSQLConfig, 'nodes' | 'databaseId' | 'privateKey'>) {
    super();
    this.config = {
      defaultConsistency: 'strong',
      poolSize: 10,
      queryTimeout: 30000,
      retryAttempts: 3,
      logging: process.env.NODE_ENV !== 'production',
      ...config,
    };
  }

  /**
   * Initialize connection pool and verify connectivity
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Check node health
    await this.checkAllNodes();

    // Initialize connection pool
    for (let i = 0; i < this.config.poolSize; i++) {
      const healthyNode = this.getHealthyNode();
      if (!healthyNode) {
        throw new Error('No healthy CovenantSQL nodes available');
      }
      this.pool.push({
        id: `conn-${i}`,
        node: healthyNode,
        inUse: false,
        lastUsed: 0,
        createdAt: Date.now(),
      });
    }

    this.initialized = true;
    this.emit('connected', { nodes: this.config.nodes.length, poolSize: this.config.poolSize });
  }

  /**
   * Execute a query with automatic retry and failover
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    if (!this.initialized) await this.initialize();

    const consistency = options.consistency ?? this.config.defaultConsistency;
    const timeout = options.timeout ?? this.config.queryTimeout;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      const conn = await this.acquireConnection();
      
      try {
        const result = await this.executeQuery<T>(conn, sql, params, consistency, timeout);
        this.releaseConnection(conn);

        if (this.config.logging) {
          console.log(`[CovenantSQL] ${sql.slice(0, 100)}... (${result.duration}ms, ${consistency})`);
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        this.releaseConnection(conn);
        
        // Mark node as unhealthy
        this.nodeHealth.set(conn.node, { healthy: false, lastCheck: Date.now(), latency: 0 });
        
        // Reassign connection to healthy node
        const healthyNode = this.getHealthyNode();
        if (healthyNode) {
          conn.node = healthyNode;
        }

        if (this.config.logging) {
          console.warn(`[CovenantSQL] Query failed on ${conn.node}, attempt ${attempt + 1}/${this.config.retryAttempts}`);
        }
      }
    }

    throw new Error(`CovenantSQL query failed after ${this.config.retryAttempts} attempts: ${lastError?.message}`);
  }

  /**
   * Execute query with strong consistency (waits for consensus)
   */
  async queryStrong<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    return this.query<T>(sql, params, { consistency: 'strong' });
  }

  /**
   * Execute query with eventual consistency (faster reads)
   */
  async queryEventual<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    return this.query<T>(sql, params, { consistency: 'eventual' });
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(consistency: ConsistencyLevel = 'strong'): Promise<TransactionContext> {
    if (!this.initialized) {
      await this.initialize();
    }

    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const queries: string[] = [];

    await this.query('BEGIN TRANSACTION', [], { transactionId: txId, consistency });

    return {
      id: txId,
      startedAt: Date.now(),
      queries,
      commit: async () => {
        await this.query('COMMIT', [], { transactionId: txId, consistency });
        this.emit('transaction:commit', { id: txId, queries: queries.length });
      },
      rollback: async () => {
        await this.query('ROLLBACK', [], { transactionId: txId, consistency });
        this.emit('transaction:rollback', { id: txId, queries: queries.length });
      },
    };
  }

  /**
   * Create a table with schema
   */
  async createTable(schema: TableSchema): Promise<void> {
    const columns = schema.columns.map(col => {
      let def = `${col.name} ${col.type}`;
      if (!col.nullable) def += ' NOT NULL';
      if (col.unique) def += ' UNIQUE';
      if (col.default !== undefined) {
        def += ` DEFAULT ${typeof col.default === 'string' ? `'${col.default}'` : col.default}`;
      }
      return def;
    }).join(', ');

    const pk = schema.primaryKey.length > 0 ? `, PRIMARY KEY (${schema.primaryKey.join(', ')})` : '';
    
    const sql = `CREATE TABLE IF NOT EXISTS ${schema.name} (${columns}${pk})`;
    await this.query(sql, [], { consistency: 'strong' });

    // Create indexes
    if (schema.indexes) {
      for (const idx of schema.indexes) {
        const unique = idx.unique ? 'UNIQUE ' : '';
        await this.query(
          `CREATE ${unique}INDEX IF NOT EXISTS ${idx.name} ON ${schema.name} (${idx.columns.join(', ')})`,
          [],
          { consistency: 'strong' }
        );
      }
    }

    this.schemas.set(schema.name, schema);
    this.emit('table:created', schema.name);
  }

  /**
   * Drop a table
   */
  async dropTable(name: string): Promise<void> {
    await this.query(`DROP TABLE IF EXISTS ${name}`, [], { consistency: 'strong' });
    this.schemas.delete(name);
    this.emit('table:dropped', name);
  }

  /**
   * Insert row(s)
   */
  async insert<T extends Record<string, unknown>>(
    table: string,
    data: T | T[],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) {
      return { rows: [], rowCount: 0, affectedRows: 0, duration: 0, node: '' };
    }

    const columns = Object.keys(rows[0]);
    const placeholders = rows.map((_, i) => 
      `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`
    ).join(', ');
    
    const values = rows.flatMap(row => columns.map(col => row[col]));
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`;

    return this.query<T>(sql, values, { consistency: 'strong', ...options });
  }

  /**
   * Update row(s)
   */
  async update<T extends Record<string, unknown>>(
    table: string,
    data: Partial<T>,
    where: string,
    whereParams: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const columns = Object.keys(data);
    const sets = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');
    const values = [...columns.map(col => data[col]), ...whereParams];
    
    const sql = `UPDATE ${table} SET ${sets} WHERE ${where}`;
    return this.query<T>(sql, values, { consistency: 'strong', ...options });
  }

  /**
   * Delete row(s)
   */
  async delete(
    table: string,
    where: string,
    whereParams: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    const sql = `DELETE FROM ${table} WHERE ${where}`;
    return this.query(sql, whereParams, { consistency: 'strong', ...options });
  }

  /**
   * Select rows
   */
  async select<T = Record<string, unknown>>(
    table: string,
    options: {
      columns?: string[];
      where?: string;
      whereParams?: unknown[];
      orderBy?: string;
      limit?: number;
      offset?: number;
      consistency?: ConsistencyLevel;
    } = {}
  ): Promise<T[]> {
    const cols = options.columns?.join(', ') ?? '*';
    let sql = `SELECT ${cols} FROM ${table}`;
    
    const params: unknown[] = [];
    if (options.where) {
      sql += ` WHERE ${options.where}`;
      params.push(...(options.whereParams ?? []));
    }
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
    }
    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
    }
    if (options.offset) {
      sql += ` OFFSET ${options.offset}`;
    }

    const result = await this.query<T>(sql, params, { consistency: options.consistency });
    return result.rows;
  }

  /**
   * Get single row
   */
  async selectOne<T = Record<string, unknown>>(
    table: string,
    where: string,
    whereParams: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<T | null> {
    const result = await this.query<T>(
      `SELECT * FROM ${table} WHERE ${where} LIMIT 1`,
      whereParams,
      options
    );
    return result.rows[0] ?? null;
  }

  /**
   * Count rows
   */
  async count(
    table: string,
    where?: string,
    whereParams?: unknown[],
    options: QueryOptions = {}
  ): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM ${table}`;
    if (where) {
      sql += ` WHERE ${where}`;
    }
    const result = await this.query<{ count: number }>(sql, whereParams ?? [], options);
    return result.rows[0]?.count ?? 0;
  }

  /**
   * Check if row exists
   */
  async exists(
    table: string,
    where: string,
    whereParams: unknown[] = []
  ): Promise<boolean> {
    const count = await this.count(table, where, whereParams, { consistency: 'eventual' });
    return count > 0;
  }

  /**
   * Get node health status
   */
  getHealth(): { healthy: boolean; nodes: Array<{ node: string; healthy: boolean; latency: number }> } {
    const nodes = Array.from(this.nodeHealth.entries()).map(([node, status]) => ({
      node,
      healthy: status.healthy,
      latency: status.latency,
    }));
    const healthy = nodes.some(n => n.healthy);
    return { healthy, nodes };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    this.pool = [];
    this.initialized = false;
    this.emit('disconnected');
  }

  private async checkAllNodes(): Promise<void> {
    for (const node of this.config.nodes) {
      const start = Date.now();
      const response = await fetch(`${node}/v1/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      }).catch((e: Error) => {
        if (this.config.logging) {
          console.warn(`[CovenantSQL] Node ${node} health check failed:`, e.message);
        }
        return null;
      });
      
      const latency = Date.now() - start;
      this.nodeHealth.set(node, {
        healthy: response?.ok ?? false,
        lastCheck: Date.now(),
        latency: response?.ok ? latency : 0,
      });
    }
  }

  private getHealthyNode(): string | null {
    const healthy = Array.from(this.nodeHealth.entries())
      .filter(([, status]) => status.healthy)
      .sort((a, b) => a[1].latency - b[1].latency);
    
    if (healthy.length > 0) {
      return healthy[0][0];
    }
    
    // Fall back to first node if none healthy
    return this.config.nodes[0] ?? null;
  }

  private async acquireConnection(): Promise<PooledConnection> {
    // Find available connection
    const available = this.pool.find(c => !c.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available;
    }

    // Wait for connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection pool exhausted'));
      }, 10000);

      const check = setInterval(() => {
        const conn = this.pool.find(c => !c.inUse);
        if (conn) {
          clearInterval(check);
          clearTimeout(timeout);
          conn.inUse = true;
          conn.lastUsed = Date.now();
          resolve(conn);
        }
      }, 100);
    });
  }

  private releaseConnection(conn: PooledConnection): void {
    conn.inUse = false;
  }

  private async executeQuery<T>(
    conn: PooledConnection,
    sql: string,
    params: unknown[],
    consistency: ConsistencyLevel,
    timeout: number
  ): Promise<QueryResult<T>> {
    const startTime = Date.now();

    const response = await fetch(`${conn.node}/v1/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Database-ID': this.config.databaseId,
        'X-Consistency': consistency,
        'X-Private-Key': this.config.privateKey,
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Query failed: ${error}`);
    }

    const data = await response.json() as {
      rows: T[];
      rowCount: number;
      affectedRows: number;
      lastInsertId?: string;
    };

    return {
      rows: data.rows,
      rowCount: data.rowCount,
      affectedRows: data.affectedRows,
      lastInsertId: data.lastInsertId,
      duration: Date.now() - startTime,
      node: conn.node,
    };
  }
}

let globalClient: CovenantSQLClient | null = null;

/**
 * Create a new CovenantSQL client
 */
export function createCovenantSQLClient(
  config: Partial<CovenantSQLConfig> & Pick<CovenantSQLConfig, 'nodes' | 'databaseId' | 'privateKey'>
): CovenantSQLClient {
  return new CovenantSQLClient(config);
}

/**
 * Get or create the global CovenantSQL client from environment
 */
export function getCovenantSQLClient(): CovenantSQLClient {
  if (globalClient) {
    return globalClient;
  }

  const nodes = process.env.COVENANTSQL_NODES?.split(',') ?? ['http://localhost:4661'];
  const databaseId = process.env.COVENANTSQL_DATABASE_ID;
  const privateKey = process.env.COVENANTSQL_PRIVATE_KEY;

  if (!databaseId || !privateKey) {
    throw new Error('COVENANTSQL_DATABASE_ID and COVENANTSQL_PRIVATE_KEY environment variables required');
  }

  globalClient = new CovenantSQLClient({
    nodes,
    databaseId,
    privateKey,
    defaultConsistency: (process.env.COVENANTSQL_CONSISTENCY as ConsistencyLevel) ?? 'strong',
    poolSize: parseInt(process.env.COVENANTSQL_POOL_SIZE ?? '10', 10),
    queryTimeout: parseInt(process.env.COVENANTSQL_TIMEOUT ?? '30000', 10),
    retryAttempts: parseInt(process.env.COVENANTSQL_RETRIES ?? '3', 10),
    logging: process.env.COVENANTSQL_LOGGING === 'true',
  });

  return globalClient;
}

/**
 * Reset the global client (for testing)
 */
export function resetCovenantSQLClient(): void {
  globalClient = null;
}

