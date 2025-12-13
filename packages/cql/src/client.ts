/**
 * CovenantSQL Client with circuit breaker pattern
 */

import { toHex } from 'viem';
import type { Address, Hex } from 'viem';
import type {
  CQLConfig, CQLConnection, CQLConnectionPool, CQLTransaction,
  DatabaseConfig, DatabaseInfo, ExecResult, QueryParam, QueryResult,
  RentalInfo, RentalPlan, CreateRentalRequest, ACLRule, GrantRequest, RevokeRequest, BlockProducerInfo,
} from './types.js';

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(private threshold = 5, private resetTimeMs = 30000) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeMs) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open - service unavailable');
      }
    }
    
    try {
      const result = await fn();
      if (this.state === 'half-open') { this.state = 'closed'; this.failures = 0; }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.threshold) this.state = 'open';
      throw error;
    }
  }

  getState() { return { state: this.state, failures: this.failures }; }
}

const circuitBreaker = new CircuitBreaker();

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  return circuitBreaker.execute(async () => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json() as Promise<T>;
  });
}

async function requestVoid(url: string, options?: RequestInit): Promise<void> {
  return circuitBreaker.execute(async () => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  });
}

class CQLConnectionImpl implements CQLConnection {
  id: string;
  databaseId: string;
  active = true;
  private endpoint: string;
  private timeout: number;
  private debug: boolean;

  constructor(id: string, databaseId: string, config: CQLConfig) {
    this.id = id;
    this.databaseId = databaseId;
    this.endpoint = config.minerEndpoint ?? config.blockProducerEndpoint;
    this.timeout = config.timeout ?? 30000;
    this.debug = config.debug ?? false;
  }

  async query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>> {
    return this.execute('query', sql, params) as Promise<QueryResult<T>>;
  }

  async exec(sql: string, params?: QueryParam[]): Promise<ExecResult> {
    return this.execute('exec', sql, params) as Promise<ExecResult>;
  }

  async beginTransaction(): Promise<CQLTransaction> {
    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.exec('BEGIN TRANSACTION');
    return new CQLTransactionImpl(txId, this);
  }

  async close(): Promise<void> {
    this.active = false;
  }

  private async execute(type: 'query' | 'exec', sql: string, params?: QueryParam[]): Promise<QueryResult<unknown> | ExecResult> {
    const startTime = Date.now();
    const payload = {
      database: this.databaseId,
      type,
      sql,
      params: params?.map(p => p === null || p === undefined ? null : typeof p === 'bigint' ? p.toString() : p instanceof Uint8Array ? toHex(p) : p),
      timestamp: Date.now(),
    };

    const response = await fetch(`${this.endpoint}/api/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) throw new Error(`CQL ${type} failed: ${response.status} - ${await response.text()}`);

    const result = await response.json();
    const executionTime = Date.now() - startTime;
    if (this.debug) console.log(`[CQL] ${type}: ${sql.slice(0, 100)}... (${executionTime}ms)`);

    return type === 'query'
      ? { rows: result.rows ?? [], rowCount: result.rowCount ?? 0, columns: result.columns ?? [], executionTime, blockHeight: result.blockHeight ?? 0 }
      : { rowsAffected: result.rowsAffected ?? 0, lastInsertId: result.lastInsertId ? BigInt(result.lastInsertId) : undefined, txHash: result.txHash as Hex, blockHeight: result.blockHeight ?? 0, gasUsed: BigInt(result.gasUsed ?? '0') };
  }
}

class CQLTransactionImpl implements CQLTransaction {
  id: string;
  private conn: CQLConnectionImpl;
  private done = false;

  constructor(id: string, conn: CQLConnectionImpl) {
    this.id = id;
    this.conn = conn;
  }

  async query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>> {
    if (this.done) throw new Error('Transaction completed');
    return this.conn.query<T>(sql, params);
  }

  async exec(sql: string, params?: QueryParam[]): Promise<ExecResult> {
    if (this.done) throw new Error('Transaction completed');
    return this.conn.exec(sql, params);
  }

  async commit(): Promise<void> {
    if (this.done) throw new Error('Transaction completed');
    await this.conn.exec('COMMIT');
    this.done = true;
  }

  async rollback(): Promise<void> {
    if (this.done) return;
    await this.conn.exec('ROLLBACK');
    this.done = true;
  }
}

class CQLConnectionPoolImpl implements CQLConnectionPool {
  private config: CQLConfig;
  private dbId: string;
  private all: CQLConnectionImpl[] = [];
  private idle: CQLConnectionImpl[] = [];
  private maxSize: number;

  constructor(config: CQLConfig, dbId: string, maxSize = 10) {
    this.config = config;
    this.dbId = dbId;
    this.maxSize = maxSize;
  }

  async acquire(): Promise<CQLConnection> {
    const conn = this.idle.pop();
    if (conn) { conn.active = true; return conn; }
    
    if (this.all.length < this.maxSize) {
      const newConn = new CQLConnectionImpl(`conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, this.dbId, this.config);
      this.all.push(newConn);
      return newConn;
    }

    // Wait for available connection
    return new Promise(resolve => {
      const check = setInterval(() => {
        const c = this.idle.pop();
        if (c) { clearInterval(check); c.active = true; resolve(c); }
      }, 50);
    });
  }

  release(conn: CQLConnection): void {
    (conn as CQLConnectionImpl).active = false;
    this.idle.push(conn as CQLConnectionImpl);
  }

  async close(): Promise<void> {
    await Promise.all(this.all.map(c => c.close()));
    this.all = [];
    this.idle = [];
  }

  stats() {
    return { active: this.all.filter(c => c.active).length, idle: this.idle.length, total: this.all.length };
  }
}

export class CQLClient {
  private config: CQLConfig;
  private pools = new Map<string, CQLConnectionPool>();
  private get endpoint() { return this.config.blockProducerEndpoint; }

  constructor(config: CQLConfig) {
    this.config = config;
  }

  getPool(dbId: string): CQLConnectionPool {
    let pool = this.pools.get(dbId);
    if (!pool) { pool = new CQLConnectionPoolImpl(this.config, dbId); this.pools.set(dbId, pool); }
    return pool;
  }

  async connect(dbId?: string): Promise<CQLConnection> {
    const id = dbId ?? this.config.databaseId;
    if (!id) throw new Error('Database ID required');
    return this.getPool(id).acquire();
  }

  async query<T>(sql: string, params?: QueryParam[], dbId?: string): Promise<QueryResult<T>> {
    const conn = await this.connect(dbId);
    try { return await conn.query<T>(sql, params); }
    finally { this.getPool(conn.databaseId).release(conn); }
  }

  async exec(sql: string, params?: QueryParam[], dbId?: string): Promise<ExecResult> {
    const conn = await this.connect(dbId);
    try { return await conn.exec(sql, params); }
    finally { this.getPool(conn.databaseId).release(conn); }
  }

  // Database Management
  async createDatabase(config: DatabaseConfig): Promise<DatabaseInfo> {
    return request<DatabaseInfo>(`${this.endpoint}/api/v1/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeCount: config.nodeCount, useEventualConsistency: config.useEventualConsistency ?? false, regions: config.regions, schema: config.schema, owner: config.owner, paymentToken: config.paymentToken }),
    });
  }

  async getDatabase(id: string): Promise<DatabaseInfo> {
    return request<DatabaseInfo>(`${this.endpoint}/api/v1/databases/${id}`);
  }

  async listDatabases(owner: Address): Promise<DatabaseInfo[]> {
    return (await request<{ databases: DatabaseInfo[] }>(`${this.endpoint}/api/v1/databases?owner=${owner}`)).databases;
  }

  async deleteDatabase(id: string): Promise<void> {
    return requestVoid(`${this.endpoint}/api/v1/databases/${id}`, { method: 'DELETE' });
  }

  // Access Control
  async grant(dbId: string, req: GrantRequest): Promise<void> {
    return requestVoid(`${this.endpoint}/api/v1/databases/${dbId}/acl/grant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  }

  async revoke(dbId: string, req: RevokeRequest): Promise<void> {
    return requestVoid(`${this.endpoint}/api/v1/databases/${dbId}/acl/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  }

  async listACL(dbId: string): Promise<ACLRule[]> {
    return (await request<{ rules: ACLRule[] }>(`${this.endpoint}/api/v1/databases/${dbId}/acl`)).rules;
  }

  // Rental Management
  async listPlans(): Promise<RentalPlan[]> {
    return (await request<{ plans: RentalPlan[] }>(`${this.endpoint}/api/v1/plans`)).plans;
  }

  async createRental(req: CreateRentalRequest): Promise<RentalInfo> {
    return request<RentalInfo>(`${this.endpoint}/api/v1/rentals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  }

  async getRental(id: string): Promise<RentalInfo> {
    return request<RentalInfo>(`${this.endpoint}/api/v1/rentals/${id}`);
  }

  async extendRental(id: string, months: number): Promise<RentalInfo> {
    return request<RentalInfo>(`${this.endpoint}/api/v1/rentals/${id}/extend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months }) });
  }

  async cancelRental(id: string): Promise<void> {
    return requestVoid(`${this.endpoint}/api/v1/rentals/${id}`, { method: 'DELETE' });
  }

  // Status
  async getBlockProducerInfo(): Promise<BlockProducerInfo> {
    return request<BlockProducerInfo>(`${this.endpoint}/api/v1/status`);
  }

  async isHealthy(): Promise<boolean> {
    return circuitBreaker.execute(async () => {
      const res = await fetch(`${this.endpoint}/health`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    }).catch(() => false);
  }

  getCircuitState() { return circuitBreaker.getState(); }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.pools.values()).map(p => p.close()));
    this.pools.clear();
  }
}

let cqlClient: CQLClient | null = null;

export function getCQL(config?: Partial<CQLConfig>): CQLClient {
  if (!cqlClient) {
    cqlClient = new CQLClient({
      blockProducerEndpoint: config?.blockProducerEndpoint ?? process.env.CQL_BLOCK_PRODUCER_ENDPOINT ?? 'http://localhost:4300',
      minerEndpoint: config?.minerEndpoint ?? process.env.CQL_MINER_ENDPOINT,
      privateKey: config?.privateKey ?? (process.env.CQL_PRIVATE_KEY as Hex),
      databaseId: config?.databaseId ?? process.env.CQL_DATABASE_ID,
      timeout: config?.timeout ?? parseInt(process.env.CQL_TIMEOUT ?? '30000'),
      debug: config?.debug ?? process.env.CQL_DEBUG === 'true',
    });
  }
  return cqlClient;
}

export function resetCQL(): void {
  cqlClient?.close().catch(console.error);
  cqlClient = null;
}

export { CQLClient as CovenantSQLClient };
