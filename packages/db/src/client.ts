/**
 * CovenantSQL Client with circuit breaker pattern
 * 
 * Automatically uses network-aware configuration from @jejunetwork/config.
 * No env vars required - just set JEJU_NETWORK=localnet|testnet|mainnet.
 */

import { toHex } from 'viem';
import type { Address, Hex } from 'viem';
import { z } from 'zod';
import { getCQLUrl, getCQLMinerUrl } from '@jejunetwork/config';
import { parseTimeout } from './utils.js';
import type {
  CQLConfig, CQLConnection, CQLConnectionPool, CQLTransaction,
  DatabaseConfig, DatabaseInfo, ExecResult, QueryParam, QueryResult,
  RentalInfo, RentalPlan, CreateRentalRequest, ACLRule, GrantRequest, RevokeRequest, BlockProducerInfo,
} from './types.js';

// Zod schemas for API response validation
const QueryResponseSchema = z.object({
  rows: z.array(z.object({}).passthrough()),
  rowCount: z.number(),
  columns: z.array(z.string()),
  blockHeight: z.number(),
});

const ExecResponseSchema = z.object({
  rowsAffected: z.number(),
  lastInsertId: z.string().optional(),
  txHash: z.string(),
  blockHeight: z.number(),
  gasUsed: z.string(),
});

// Zod schema for CQL config validation
const HexSchema = z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid hex string');
const CQLConfigSchema = z.object({
  blockProducerEndpoint: z.string().url(),
  minerEndpoint: z.string().url().optional(),
  privateKey: HexSchema.optional(),
  databaseId: z.string().min(1).optional(),
  timeout: z.number().int().positive().optional(),
  debug: z.boolean().optional(),
});

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const DEFAULT_LOG_LEVEL: LogLevel = 'info';

function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  return DEFAULT_LOG_LEVEL;
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  const minLevel = getLogLevel();
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
  const entry = { timestamp: new Date().toISOString(), level, service: 'cql', message: msg, ...data };
  const out = process.env.NODE_ENV === 'production' ? JSON.stringify(entry) : `[${entry.timestamp}] [${level.toUpperCase()}] [cql] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  console[level === 'debug' ? 'debug' : level === 'info' ? 'info' : level === 'warn' ? 'warn' : 'error'](out);
}

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(private threshold = 5, private resetTimeMs = 30000) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeMs) {
        this.state = 'half-open';
        log('info', 'Circuit breaker half-open, attempting recovery');
      } else {
        throw new Error('Circuit breaker is open - service unavailable');
      }
    }
    
    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
        log('info', 'Circuit breaker closed, service recovered');
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.threshold) {
        this.state = 'open';
        log('warn', 'Circuit breaker opened', { failures: this.failures, threshold: this.threshold });
      }
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

    const rawResult = await response.json();
    const executionTime = Date.now() - startTime;
    if (this.debug) console.log(`[CQL] ${type}: ${sql.slice(0, 100)}... (${executionTime}ms)`);

    if (type === 'query') {
      const result = QueryResponseSchema.parse(rawResult);
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        columns: result.columns.map(name => ({ name, type: 'TEXT' as const, nullable: true, primaryKey: false, autoIncrement: false })),
        executionTime,
        blockHeight: result.blockHeight,
      };
    } else {
      const result = ExecResponseSchema.parse(rawResult);
      return { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId ? BigInt(result.lastInsertId) : undefined, txHash: result.txHash as Hex, blockHeight: result.blockHeight, gasUsed: BigInt(result.gasUsed) };
    }
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

const DEFAULT_TIMEOUT = 30000;

/**
 * Get a CQL client with automatic network-aware configuration.
 * Configuration is resolved in this order:
 * 1. Explicit config parameter
 * 2. Environment variable override
 * 3. Network-based config from services.json (based on JEJU_NETWORK)
 */
export function getCQL(config?: Partial<CQLConfig>): CQLClient {
  if (!cqlClient) {
    const blockProducerEndpoint = config?.blockProducerEndpoint ?? getCQLUrl();
    const minerEndpoint = config?.minerEndpoint ?? getCQLMinerUrl();
    
    if (!blockProducerEndpoint) {
      throw new Error('CQL blockProducerEndpoint is required. Set via config, CQL_BLOCK_PRODUCER_ENDPOINT env var, or JEJU_NETWORK.');
    }
    
    const resolvedConfig = {
      blockProducerEndpoint,
      minerEndpoint,
      privateKey: config?.privateKey ?? (process.env.CQL_PRIVATE_KEY as Hex | undefined),
      databaseId: config?.databaseId ?? process.env.CQL_DATABASE_ID,
      timeout: config?.timeout ?? parseTimeout(process.env.CQL_TIMEOUT, DEFAULT_TIMEOUT),
      debug: config?.debug ?? process.env.CQL_DEBUG === 'true',
    };
    
    // Validate the resolved config
    const validated = CQLConfigSchema.parse(resolvedConfig);
    
    cqlClient = new CQLClient(validated as CQLConfig);
  }
  return cqlClient;
}

export async function resetCQL(): Promise<void> {
  if (cqlClient) {
    await cqlClient.close();
    cqlClient = null;
  }
}

export { CQLClient as CovenantSQLClient };
