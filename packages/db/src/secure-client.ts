/**
 * Secure CQL Client
 *
 * Client for apps to provision and access their own isolated databases
 * through DWS with cryptographic authentication.
 *
 * @example
 * ```typescript
 * import { createSecureCQLClient } from '@jejunetwork/db'
 *
 * const client = createSecureCQLClient({
 *   dwsEndpoint: 'http://localhost:4030',
 *   privateKey: '0x...',
 *   appName: 'my-app',
 * })
 *
 * // Provision a new database
 * const db = await client.provision()
 *
 * // Execute queries
 * const users = await client.query('SELECT * FROM users')
 * await client.exec('INSERT INTO users (id, name) VALUES (?, ?)', ['1', 'Alice'])
 * ```
 */

import { AddressSchema, expectValid, type JsonRecord } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount, signMessage } from 'viem/accounts'
import { z } from 'zod'

/** Error response schema for API calls */
const ErrorResponseSchema = z.object({
  error: z.string(),
})

// API response schemas
const ProvisionedDatabaseSchema = z.object({
  databaseId: z.string(),
  owner: AddressSchema,
  appName: z.string(),
  createdAt: z.number(),
  status: z.enum(['active', 'suspended', 'deleted']),
})

const ProvisionResponseSchema = z.object({
  success: z.boolean(),
  database: ProvisionedDatabaseSchema,
})

const ListDatabasesResponseSchema = z.object({
  databases: z.array(ProvisionedDatabaseSchema),
})

// Types

export interface SecureCQLConfig {
  /** DWS endpoint URL */
  dwsEndpoint: string
  /** Private key for signing requests */
  privateKey: Hex
  /** App name (used for database provisioning) */
  appName: string
  /** Database ID (if already provisioned) */
  databaseId?: string
  /** Request timeout in ms */
  timeout?: number
}

export interface ProvisionedDatabase {
  databaseId: string
  owner: Address
  appName: string
  createdAt: number
  status: 'active' | 'suspended' | 'deleted'
}

export interface QueryResult<T = JsonRecord> {
  rows: T[]
  rowCount: number
  columns: string[]
  executionTime?: number
  blockHeight: number
}

export interface ExecResult {
  rowsAffected: number
  lastInsertId?: string
  txHash: string
  blockHeight: number
  gasUsed: string
}

const _QueryResultSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number(),
  columns: z.array(z.string()),
  executionTime: z.number().optional(),
  blockHeight: z.number(),
})

const _ExecResultSchema = z.object({
  rowsAffected: z.number(),
  lastInsertId: z.string().optional(),
  txHash: z.string(),
  blockHeight: z.number(),
  gasUsed: z.string(),
})

// Client Implementation

export class SecureCQLClient {
  private config: SecureCQLConfig
  private account: ReturnType<typeof privateKeyToAccount>
  private databaseId: string | null

  constructor(config: SecureCQLConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    }
    this.account = privateKeyToAccount(config.privateKey)
    this.databaseId = config.databaseId ?? null
  }

  /**
   * Get the owner address
   */
  get address(): Address {
    return this.account.address
  }

  /**
   * Get the current database ID
   */
  get database(): string | null {
    return this.databaseId
  }

  /**
   * Provision a new database for this app
   */
  async provision(schema?: string): Promise<ProvisionedDatabase> {
    const timestamp = Date.now()
    const message = JSON.stringify({
      appName: this.config.appName,
      owner: this.account.address,
      timestamp,
    })

    const signature = await signMessage({
      message,
      privateKey: this.config.privateKey,
    })

    const response = await fetch(
      `${this.config.dwsEndpoint}/database/provision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: this.config.appName,
          owner: this.account.address,
          signature,
          timestamp,
          schema,
        }),
        signal: AbortSignal.timeout(this.config.timeout ?? 30000),
      },
    )

    if (!response.ok) {
      const errorResult = ErrorResponseSchema.safeParse(
        await response.json().catch(() => ({})),
      )
      const errorMsg = errorResult.success
        ? errorResult.data.error
        : 'Unknown error'
      throw new Error(`Failed to provision database: ${errorMsg}`)
    }

    const result = expectValid(
      ProvisionResponseSchema,
      await response.json(),
      'provision response',
    )
    this.databaseId = result.database.databaseId
    return result.database
  }

  /**
   * Execute a SELECT query
   */
  async query<T = JsonRecord>(
    sql: string,
    params: (string | number | boolean | null)[] = [],
  ): Promise<QueryResult<T>> {
    return this.executeRequest<QueryResult<T>>('query', sql, params)
  }

  /**
   * Execute an INSERT/UPDATE/DELETE statement
   */
  async exec(
    sql: string,
    params: (string | number | boolean | null)[] = [],
  ): Promise<ExecResult> {
    return this.executeRequest<ExecResult>('exec', sql, params)
  }

  /**
   * Grant access to another address
   */
  async grantAccess(params: {
    grantee: Address
    tables: string[] | '*'
    permissions: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL')[]
    condition?: string
  }): Promise<void> {
    if (!this.databaseId) {
      throw new Error('Database not provisioned')
    }

    const timestamp = Date.now()
    const message = JSON.stringify({
      databaseId: this.databaseId,
      grantee: params.grantee,
      tables: params.tables,
      permissions: params.permissions,
      condition: params.condition,
      timestamp,
    })

    const signature = await signMessage({
      message,
      privateKey: this.config.privateKey,
    })

    const response = await fetch(`${this.config.dwsEndpoint}/database/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        databaseId: this.databaseId,
        grantee: params.grantee,
        tables: params.tables,
        permissions: params.permissions,
        condition: params.condition,
        owner: this.account.address,
        signature,
        timestamp,
      }),
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
    })

    if (!response.ok) {
      const errorResult = ErrorResponseSchema.safeParse(
        await response.json().catch(() => ({})),
      )
      const errorMsg = errorResult.success
        ? errorResult.data.error
        : 'Unknown error'
      throw new Error(`Failed to grant access: ${errorMsg}`)
    }
  }

  /**
   * Revoke access from an address
   */
  async revokeAccess(grantee: Address): Promise<void> {
    if (!this.databaseId) {
      throw new Error('Database not provisioned')
    }

    const timestamp = Date.now()
    const message = JSON.stringify({
      databaseId: this.databaseId,
      grantee,
      timestamp,
    })

    const signature = await signMessage({
      message,
      privateKey: this.config.privateKey,
    })

    const response = await fetch(`${this.config.dwsEndpoint}/database/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        databaseId: this.databaseId,
        grantee,
        owner: this.account.address,
        signature,
        timestamp,
      }),
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
    })

    if (!response.ok) {
      const errorResult = ErrorResponseSchema.safeParse(
        await response.json().catch(() => ({})),
      )
      const errorMsg = errorResult.success
        ? errorResult.data.error
        : 'Unknown error'
      throw new Error(`Failed to revoke access: ${errorMsg}`)
    }
  }

  /**
   * List all databases owned by this address
   */
  async listDatabases(): Promise<ProvisionedDatabase[]> {
    const response = await fetch(
      `${this.config.dwsEndpoint}/database/list/${this.account.address}`,
      { signal: AbortSignal.timeout(this.config.timeout ?? 30000) },
    )

    if (!response.ok) {
      throw new Error('Failed to list databases')
    }

    const result = expectValid(
      ListDatabasesResponseSchema,
      await response.json(),
      'list databases response',
    )
    return result.databases
  }

  /**
   * Set the current database ID
   */
  setDatabase(databaseId: string): void {
    this.databaseId = databaseId
  }

  // Private Methods

  private async executeRequest<T>(
    type: 'query' | 'exec',
    sql: string,
    params: (string | number | boolean | null)[],
  ): Promise<T> {
    if (!this.databaseId) {
      throw new Error('Database not provisioned. Call provision() first.')
    }

    const timestamp = Date.now()
    const payload = {
      database: this.databaseId,
      type,
      sql,
      params,
      timestamp,
    }

    const message = JSON.stringify(payload)
    const signature = await signMessage({
      message,
      privateKey: this.config.privateKey,
    })

    const response = await fetch(`${this.config.dwsEndpoint}/cql/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        signature,
        signer: this.account.address,
      }),
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
    })

    if (!response.ok) {
      const errorResult = ErrorResponseSchema.safeParse(
        await response.json().catch(() => ({})),
      )
      const errorMsg = errorResult.success
        ? errorResult.data.error
        : 'Unknown error'
      throw new Error(`CQL ${type} failed: ${errorMsg}`)
    }

    const data = await response.json()
    if (type === 'query') {
      return expectValid(_QueryResultSchema, data, 'CQL query response') as T
    }
    return expectValid(_ExecResultSchema, data, 'CQL exec response') as T
  }
}

/**
 * Create a secure CQL client for an app
 */
export function createSecureCQLClient(
  config: SecureCQLConfig,
): SecureCQLClient {
  return new SecureCQLClient(config)
}
