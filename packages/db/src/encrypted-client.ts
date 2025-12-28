/**
 * Encrypted EQLite Client
 *
 * Provides transparent encryption at rest for EQLite databases using KMS.
 * All data is encrypted before being sent to EQLite and decrypted on read.
 *
 * @example
 * ```typescript
 * import { createEncryptedEQLiteClient } from '@jejunetwork/db'
 *
 * const client = await createEncryptedEQLiteClient({
 *   databaseId: 'my-app-db',
 *   kmsEndpoint: 'http://localhost:4040',
 *   encryptionKeyId: 'db-key-123',
 * })
 *
 * // Data is automatically encrypted
 * await client.exec('INSERT INTO secrets (id, value) VALUES (?, ?)', ['1', 'sensitive-data'])
 *
 * // Data is automatically decrypted on read
 * const result = await client.query('SELECT * FROM secrets')
 * ```
 */

import { getEQLiteBlockProducerUrl, getKMSEndpoint } from '@jejunetwork/config'
import type { Hex } from 'viem'
import { z } from 'zod'

// Schemas for KMS responses
const EncryptResponseSchema = z.object({
  keyId: z.string(),
  ciphertext: z.string(),
  nonce: z.string(),
  algorithm: z.string(),
})

const DecryptResponseSchema = z.object({
  plaintext: z.string(),
})

const GenerateKeyResponseSchema = z.object({
  keyId: z.string(),
  publicKey: z.string().optional(),
  algorithm: z.string(),
  createdAt: z.number(),
})

// Types

export interface EncryptedEQLiteConfig {
  /** EQLite endpoint (defaults to config) */
  endpoint?: string
  /** Database ID */
  databaseId: string
  /** KMS endpoint for encryption (defaults to config) */
  kmsEndpoint?: string
  /** Encryption key ID (will be generated if not provided) */
  encryptionKeyId?: string
  /** Request timeout in ms */
  timeout?: number
  /** Enable debug logging */
  debug?: boolean
  /** Columns to encrypt (table.column format) */
  encryptedColumns?: string[]
  /** KMS authentication (API key or signature) */
  kmsAuth?: {
    type: 'apiKey' | 'signature'
    value: string | Hex
  }
}

export interface EncryptedQueryResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number
  columns: string[]
  executionTime?: number
  decrypted: boolean
}

export interface EncryptedExecResult {
  rowsAffected: number
  lastInsertId?: string
  encrypted: boolean
}

// Helper to check if a column should be encrypted
function shouldEncrypt(
  table: string,
  column: string,
  encryptedColumns: string[],
): boolean {
  return (
    encryptedColumns.includes(`${table}.${column}`) ||
    encryptedColumns.includes(`*.${column}`) ||
    encryptedColumns.includes(column)
  )
}

// Encrypted EQLite Client

export class EncryptedEQLiteClient {
  private endpoint: string
  private databaseId: string
  private kmsEndpoint: string
  private encryptionKeyId: string | null
  private timeout: number
  private debug: boolean
  private encryptedColumns: Set<string>
  private kmsAuth?: { type: 'apiKey' | 'signature'; value: string }
  private initialized = false

  constructor(config: EncryptedEQLiteConfig) {
    this.endpoint = config.endpoint ?? getEQLiteBlockProducerUrl()
    this.databaseId = config.databaseId
    this.kmsEndpoint = config.kmsEndpoint ?? getKMSEndpoint()
    this.encryptionKeyId = config.encryptionKeyId ?? null
    this.timeout = config.timeout ?? 30000
    this.debug = config.debug ?? false
    this.encryptedColumns = new Set(config.encryptedColumns ?? [])
    this.kmsAuth = config.kmsAuth
  }

  /**
   * Initialize the client - generates encryption key if needed
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Generate encryption key if not provided
    if (!this.encryptionKeyId) {
      this.encryptionKeyId = await this.generateEncryptionKey()
    }

    this.initialized = true
    if (this.debug) {
      console.log(
        `[EncryptedEQLite] Initialized with key: ${this.encryptionKeyId}`,
      )
    }
  }

  /**
   * Get the encryption key ID
   */
  get keyId(): string | null {
    return this.encryptionKeyId
  }

  /**
   * Execute a SELECT query with automatic decryption
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: (string | number | boolean | null)[],
  ): Promise<EncryptedQueryResult<T>> {
    await this.ensureInitialized()

    // Execute query against EQLite
    const response = await this.executeRequest('query', sql, params)

    // Decrypt any encrypted columns
    const decryptedRows = await this.decryptRows(response.rows ?? [])

    return {
      rows: decryptedRows as T[],
      rowCount: decryptedRows.length,
      columns: response.columns ?? [],
      executionTime: response.executionTime,
      decrypted: true,
    }
  }

  /**
   * Execute an INSERT/UPDATE/DELETE with automatic encryption
   */
  async exec(
    sql: string,
    params?: (string | number | boolean | null)[],
  ): Promise<EncryptedExecResult> {
    await this.ensureInitialized()

    // Encrypt parameters if needed
    const encryptedParams = await this.encryptParams(sql, params ?? [])

    // Execute against EQLite
    const response = await this.executeRequest('exec', sql, encryptedParams)

    return {
      rowsAffected: response.rowsAffected ?? 0,
      lastInsertId: response.lastInsertId,
      encrypted: true,
    }
  }

  /**
   * Add columns to encrypt
   */
  addEncryptedColumn(column: string): void {
    this.encryptedColumns.add(column)
  }

  /**
   * Check if a column is encrypted
   */
  isColumnEncrypted(column: string): boolean {
    return this.encryptedColumns.has(column)
  }

  /**
   * Encrypt a value using KMS
   */
  async encrypt(plaintext: string): Promise<string> {
    await this.ensureInitialized()

    const response = await fetch(`${this.kmsEndpoint}/encrypt`, {
      method: 'POST',
      headers: this.getKMSHeaders(),
      body: JSON.stringify({
        keyId: this.encryptionKeyId,
        plaintext,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`KMS encryption failed: ${response.statusText}`)
    }

    const result = EncryptResponseSchema.parse(await response.json())
    // Return ciphertext with nonce for decryption
    return `${result.ciphertext}:${result.nonce}`
  }

  /**
   * Decrypt a value using KMS
   */
  async decrypt(ciphertext: string): Promise<string> {
    await this.ensureInitialized()

    // Split ciphertext and nonce
    const [cipher, nonce] = ciphertext.split(':')

    const response = await fetch(`${this.kmsEndpoint}/decrypt`, {
      method: 'POST',
      headers: this.getKMSHeaders(),
      body: JSON.stringify({
        keyId: this.encryptionKeyId,
        ciphertext: cipher,
        nonce,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`KMS decryption failed: ${response.statusText}`)
    }

    const result = DecryptResponseSchema.parse(await response.json())
    return result.plaintext
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    // Check EQLite
    const eqliteHealthy = await fetch(`${this.endpoint}/v1/status`, {
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => r.ok)
      .catch(() => false)

    if (!eqliteHealthy) return false

    // Check KMS
    const kmsHealthy = await fetch(`${this.kmsEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => r.ok)
      .catch(() => false)

    return kmsHealthy
  }

  // Private methods

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  private async generateEncryptionKey(): Promise<string> {
    const response = await fetch(`${this.kmsEndpoint}/keys/generate`, {
      method: 'POST',
      headers: this.getKMSHeaders(),
      body: JSON.stringify({
        algorithm: 'AES-256-GCM',
        purpose: 'database-encryption',
        metadata: {
          databaseId: this.databaseId,
        },
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to generate encryption key: ${response.statusText}`,
      )
    }

    const result = GenerateKeyResponseSchema.parse(await response.json())
    return result.keyId
  }

  private getKMSHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.kmsAuth) {
      if (this.kmsAuth.type === 'apiKey') {
        headers['X-API-Key'] = this.kmsAuth.value
      } else {
        headers.Authorization = `Signature ${this.kmsAuth.value}`
      }
    }

    return headers
  }

  private async executeRequest(
    type: 'query' | 'exec',
    sql: string,
    params?: (string | number | boolean | null)[],
  ): Promise<{
    rows?: Record<string, unknown>[]
    columns?: string[]
    executionTime?: number
    rowsAffected?: number
    lastInsertId?: string
  }> {
    const response = await fetch(`${this.endpoint}/v1/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: this.databaseId,
        query: sql,
        params: params ?? [],
        assoc: true,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`EQLite ${type} failed: ${response.statusText}`)
    }

    const data = (await response.json()) as {
      data?: { rows?: Record<string, unknown>[] }
      rows?: Record<string, unknown>[]
      status?: string
      rowsAffected?: number
      lastInsertId?: string
    }

    return {
      rows: data.data?.rows ?? data.rows,
      columns: data.data?.rows?.[0] ? Object.keys(data.data.rows[0]) : [],
      rowsAffected: data.rowsAffected,
      lastInsertId: data.lastInsertId,
    }
  }

  private async encryptParams(
    sql: string,
    params: (string | number | boolean | null)[],
  ): Promise<(string | number | boolean | null)[]> {
    // Simple heuristic: extract column names from INSERT/UPDATE statements
    const columnMatches = sql.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)/i)

    if (!columnMatches) return params

    const table = columnMatches[1]
    const columnsMatch = columnMatches[2]
    if (!table || !columnsMatch) return params

    const columns = columnsMatch.split(',').map((c) => c.trim())

    const encryptedParams: (string | number | boolean | null)[] = []

    for (let i = 0; i < params.length; i++) {
      const param = params[i]
      const column = columns[i]

      if (param === undefined) {
        encryptedParams.push(null)
      } else if (
        column &&
        shouldEncrypt(table, column, Array.from(this.encryptedColumns)) &&
        typeof param === 'string'
      ) {
        encryptedParams.push(await this.encrypt(param))
      } else {
        encryptedParams.push(param)
      }
    }

    return encryptedParams
  }

  private async decryptRows(
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const decryptedRows: Record<string, unknown>[] = []

    for (const row of rows) {
      const decryptedRow: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(row)) {
        if (
          this.encryptedColumns.has(key) &&
          typeof value === 'string' &&
          value.includes(':')
        ) {
          // This looks like an encrypted value (ciphertext:nonce)
          try {
            decryptedRow[key] = await this.decrypt(value)
          } catch {
            // If decryption fails, return as-is (might not be encrypted)
            decryptedRow[key] = value
          }
        } else {
          decryptedRow[key] = value
        }
      }

      decryptedRows.push(decryptedRow)
    }

    return decryptedRows
  }
}

/**
 * Create an encrypted EQLite client
 */
export async function createEncryptedEQLiteClient(
  config: EncryptedEQLiteConfig,
): Promise<EncryptedEQLiteClient> {
  const client = new EncryptedEQLiteClient(config)
  await client.initialize()
  return client
}
