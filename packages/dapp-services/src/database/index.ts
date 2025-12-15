/**
 * Database Service - CQL Integration
 * 
 * Provides decentralized SQL database access via CovenantSQL.
 */

import { getCQL, type CQLClient } from '@jeju/cql';
import type { Address, Hex } from 'viem';

export interface DatabaseConfig {
  databaseId: string;
  endpoint?: string;
  timeout?: number;
  debug?: boolean;
}

export interface DatabaseService {
  query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>;
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>;
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}

export type QueryParam = string | number | boolean | null | Uint8Array | bigint;

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  executionTime: number;
}

export interface ExecResult {
  rowsAffected: number;
  lastInsertId?: bigint;
  txHash?: Hex;
}

export interface TransactionClient {
  query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>;
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>;
}

class DatabaseServiceImpl implements DatabaseService {
  private client: CQLClient;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.client = getCQL({
      blockProducerEndpoint: config.endpoint || process.env.CQL_BLOCK_PRODUCER_ENDPOINT || 'http://localhost:4300',
      databaseId: config.databaseId,
      timeout: config.timeout || 30000,
      debug: config.debug || process.env.NODE_ENV !== 'production',
    });
  }

  async query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>> {
    const result = await this.client.query<T>(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
    };
  }

  async exec(sql: string, params?: QueryParam[]): Promise<ExecResult> {
    const result = await this.client.exec(sql, params);
    return {
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
      txHash: result.txHash,
    };
  }

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const conn = await this.client.connect(this.config.databaseId);
    const tx = await conn.beginTransaction();
    
    const txClient: TransactionClient = {
      query: async <R>(sql: string, params?: QueryParam[]) => {
        const result = await tx.query<R>(sql, params);
        return {
          rows: result.rows,
          rowCount: result.rowCount,
          executionTime: result.executionTime,
        };
      },
      exec: async (sql: string, params?: QueryParam[]) => {
        const result = await tx.exec(sql, params);
        return {
          rowsAffected: result.rowsAffected,
          lastInsertId: result.lastInsertId,
          txHash: result.txHash,
        };
      },
    };

    try {
      const result = await fn(txClient);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      this.client.getPool(this.config.databaseId).release(conn);
    }
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  async close(): Promise<void> {
    return this.client.close();
  }
}

const instances = new Map<string, DatabaseService>();

export function createDatabaseService(config: DatabaseConfig): DatabaseService {
  const key = config.databaseId;
  
  if (!instances.has(key)) {
    instances.set(key, new DatabaseServiceImpl(config));
  }
  
  return instances.get(key)!;
}

export function resetDatabaseService(databaseId: string): void {
  const instance = instances.get(databaseId);
  if (instance) {
    instance.close();
    instances.delete(databaseId);
  }
}
