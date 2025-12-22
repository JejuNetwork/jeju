/**
 * Database Service - CQL Integration
 *
 * Provides decentralized SQL database access via CovenantSQL.
 */

import { type CQLClient, getCQL } from '@jejunetwork/db'
import type { Hex } from 'viem'
import { z } from 'zod'

const DatabaseConfigSchema = z.object({
  databaseId: z.string().min(1),
  endpoint: z.string().url(),
  timeout: z.number().positive().default(30000),
  debug: z.boolean().default(false),
})

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>

export interface DatabaseService {
  query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>
  isHealthy(): Promise<boolean>
  close(): Promise<void>
}

export type QueryParam = string | number | boolean | null | Uint8Array | bigint

export interface QueryResult<T> {
  rows: T[]
  rowCount: number
  executionTime: number
}

export interface ExecResult {
  rowsAffected: number
  lastInsertId?: bigint
  txHash?: Hex
}

export interface TransactionClient {
  query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>
}

class DatabaseServiceImpl implements DatabaseService {
  private client: CQLClient
  private config: DatabaseConfig

  constructor(config: DatabaseConfig) {
    const validated = DatabaseConfigSchema.parse(config)
    this.config = validated
    this.client = getCQL({
      blockProducerEndpoint: validated.endpoint,
      databaseId: validated.databaseId,
      timeout: validated.timeout,
      debug: validated.debug,
    })
  }

  async query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>> {
    const result = await this.client.query<T>(sql, params)
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      executionTime: result.executionTime,
    }
  }

  async exec(sql: string, params?: QueryParam[]): Promise<ExecResult> {
    const result = await this.client.exec(sql, params)
    return {
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
      txHash: result.txHash,
    }
  }

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const conn = await this.client.connect(this.config.databaseId)
    const tx = await conn.beginTransaction()

    const txClient: TransactionClient = {
      query: async <R>(sql: string, params?: QueryParam[]) => {
        const result = await tx.query<R>(sql, params)
        return {
          rows: result.rows,
          rowCount: result.rowCount,
          executionTime: result.executionTime,
        }
      },
      exec: async (sql: string, params?: QueryParam[]) => {
        const result = await tx.exec(sql, params)
        return {
          rowsAffected: result.rowsAffected,
          lastInsertId: result.lastInsertId,
          txHash: result.txHash,
        }
      },
    }

    try {
      const result = await fn(txClient)
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback()
      throw error
    } finally {
      this.client.getPool(this.config.databaseId).release(conn)
    }
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy()
  }

  async close(): Promise<void> {
    return this.client.close()
  }
}

const instances = new Map<string, DatabaseService>()

export function createDatabaseService(config: DatabaseConfig): DatabaseService {
  const key = config.databaseId

  if (!instances.has(key)) {
    instances.set(key, new DatabaseServiceImpl(config))
  }

  const instance = instances.get(key)
  if (!instance) throw new Error(`Database service for ${key} not initialized`)
  return instance
}

export function resetDatabaseService(databaseId: string): void {
  const instance = instances.get(databaseId)
  if (instance) {
    instance.close()
    instances.delete(databaseId)
  }
}
