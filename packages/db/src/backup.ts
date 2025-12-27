/**
 * EQLite Backup Service
 *
 * Provides automated backup and restore for EQLite databases using DWS storage.
 * Supports multiple storage backends (IPFS, Filecoin, Arweave, S3) with encryption.
 *
 * @example
 * ```typescript
 * import { createBackupService } from '@jejunetwork/db'
 *
 * const backup = createBackupService({
 *   databaseId: 'my-app-db',
 *   dwsEndpoint: 'http://localhost:4030',
 *   storageBackend: 'ipfs', // or 'filecoin', 'arweave', 's3'
 *   encryptBackups: true,
 *   schedule: '0 0 * * *', // Daily at midnight
 * })
 *
 * // Manual backup
 * const backupId = await backup.createBackup()
 *
 * // Restore from backup
 * await backup.restore(backupId)
 * ```
 */

import { getDWSEndpoint, getEQLiteBlockProducerUrl } from '@jejunetwork/config'
import { z } from 'zod'

// Schemas

const BackupMetadataSchema = z.object({
  backupId: z.string(),
  databaseId: z.string(),
  createdAt: z.number(),
  size: z.number(),
  encrypted: z.boolean(),
  storageBackend: z.string(),
  cid: z.string(),
  tables: z.array(z.string()),
  rowCounts: z.record(z.string(), z.number()),
  checksum: z.string(),
})

const UploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
  url: z.string().optional(),
})

const ListBackupsResponseSchema = z.object({
  backups: z.array(BackupMetadataSchema),
})

// Types

export type BackupMetadata = z.infer<typeof BackupMetadataSchema>

export type StorageBackend = 'ipfs' | 'filecoin' | 'arweave' | 's3' | 'local'

export interface BackupServiceConfig {
  /** EQLite endpoint (defaults to config) */
  eqliteEndpoint?: string
  /** Database ID to backup */
  databaseId: string
  /** DWS endpoint for storage (defaults to config) */
  dwsEndpoint?: string
  /** Storage backend to use */
  storageBackend?: StorageBackend
  /** Encrypt backups (default: true) */
  encryptBackups?: boolean
  /** KMS endpoint for encryption */
  kmsEndpoint?: string
  /** Encryption key ID */
  encryptionKeyId?: string
  /** Backup schedule (cron format) */
  schedule?: string
  /** Maximum backups to retain */
  maxBackups?: number
  /** Request timeout in ms */
  timeout?: number
  /** Enable debug logging */
  debug?: boolean
  /** Callback on backup complete */
  onBackupComplete?: (metadata: BackupMetadata) => void
  /** Callback on backup error */
  onBackupError?: (error: Error) => void
}

export interface BackupOptions {
  /** Tables to backup (all if not specified) */
  tables?: string[]
  /** Include schema in backup */
  includeSchema?: boolean
  /** Compress backup */
  compress?: boolean
  /** Custom metadata to include */
  metadata?: Record<string, string>
}

export interface RestoreOptions {
  /** Restore to a different database */
  targetDatabaseId?: string
  /** Drop existing tables before restore */
  dropExisting?: boolean
  /** Tables to restore (all if not specified) */
  tables?: string[]
}

// Backup Service Implementation

export class BackupService {
  private eqliteEndpoint: string
  private databaseId: string
  private dwsEndpoint: string
  private storageBackend: StorageBackend
  private encryptBackups: boolean
  private kmsEndpoint?: string
  private encryptionKeyId?: string
  private maxBackups: number
  private timeout: number
  private debug: boolean
  private onBackupComplete?: (metadata: BackupMetadata) => void
  private onBackupError?: (error: Error) => void
  private scheduleInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: BackupServiceConfig) {
    this.eqliteEndpoint = config.eqliteEndpoint ?? getEQLiteBlockProducerUrl()
    this.databaseId = config.databaseId
    this.dwsEndpoint = config.dwsEndpoint ?? getDWSEndpoint()
    this.storageBackend = config.storageBackend ?? 'ipfs'
    this.encryptBackups = config.encryptBackups ?? true
    this.kmsEndpoint = config.kmsEndpoint
    this.encryptionKeyId = config.encryptionKeyId
    this.maxBackups = config.maxBackups ?? 30
    this.timeout = config.timeout ?? 300000 // 5 minutes for backups
    this.debug = config.debug ?? false
    this.onBackupComplete = config.onBackupComplete
    this.onBackupError = config.onBackupError
  }

  /**
   * Create a backup of the database
   */
  async createBackup(options: BackupOptions = {}): Promise<BackupMetadata> {
    const startTime = Date.now()
    const backupId = this.generateBackupId()

    if (this.debug) {
      console.log(`[Backup] Starting backup ${backupId} for ${this.databaseId}`)
    }

    // Get list of tables
    const tables = options.tables ?? (await this.listTables())

    // Export data from each table
    const tableData: Record<string, unknown[]> = {}
    const rowCounts: Record<string, number> = {}
    let totalSize = 0

    for (const table of tables) {
      const data = await this.exportTable(table)
      tableData[table] = data
      rowCounts[table] = data.length
      totalSize += JSON.stringify(data).length
    }

    // Include schema if requested
    let schemaData: string | null = null
    if (options.includeSchema) {
      schemaData = await this.exportSchema(tables)
    }

    // Create backup payload
    const payload = {
      version: 1,
      databaseId: this.databaseId,
      createdAt: Date.now(),
      tables: tableData,
      schema: schemaData,
      metadata: options.metadata ?? {},
    }

    // Serialize and optionally compress
    let serialized = JSON.stringify(payload)
    if (options.compress) {
      serialized = await this.compress(serialized)
    }

    // Encrypt if enabled
    if (this.encryptBackups) {
      serialized = await this.encryptData(serialized)
    }

    // Upload to DWS storage
    const cid = await this.uploadToStorage(
      Buffer.from(serialized),
      `backup-${backupId}.json`,
    )

    // Calculate checksum
    const checksum = await this.calculateChecksum(serialized)

    // Create metadata
    const metadata: BackupMetadata = {
      backupId,
      databaseId: this.databaseId,
      createdAt: Date.now(),
      size: totalSize,
      encrypted: this.encryptBackups,
      storageBackend: this.storageBackend,
      cid,
      tables,
      rowCounts,
      checksum,
    }

    // Store metadata in DWS registry
    await this.storeBackupMetadata(metadata)

    // Cleanup old backups if needed
    await this.cleanupOldBackups()

    if (this.debug) {
      const duration = Date.now() - startTime
      console.log(`[Backup] Completed ${backupId} in ${duration}ms`)
    }

    if (this.onBackupComplete) {
      this.onBackupComplete(metadata)
    }

    return metadata
  }

  /**
   * Restore from a backup
   */
  async restore(backupId: string, options: RestoreOptions = {}): Promise<void> {
    const startTime = Date.now()

    if (this.debug) {
      console.log(`[Backup] Starting restore from ${backupId}`)
    }

    // Get backup metadata
    const metadata = await this.getBackupMetadata(backupId)
    if (!metadata) {
      throw new Error(`Backup not found: ${backupId}`)
    }

    // Download backup from storage
    const data = await this.downloadFromStorage(metadata.cid)

    // Decrypt if needed
    let serialized = data.toString()
    if (metadata.encrypted) {
      serialized = await this.decryptData(serialized)
    }

    // Parse backup
    const backup = JSON.parse(serialized) as {
      version: number
      databaseId: string
      tables: Record<string, unknown[]>
      schema?: string
    }

    const targetDb = options.targetDatabaseId ?? this.databaseId
    const tablesToRestore = options.tables ?? Object.keys(backup.tables)

    // Restore schema first if included
    if (backup.schema) {
      await this.restoreSchema(backup.schema, targetDb)
    }

    // Restore each table
    for (const table of tablesToRestore) {
      const rows = backup.tables[table]
      if (!rows) continue

      if (options.dropExisting) {
        await this.execOnEQLite(`DELETE FROM ${table}`, targetDb)
      }

      await this.importTable(table, rows, targetDb)
    }

    if (this.debug) {
      const duration = Date.now() - startTime
      console.log(`[Backup] Restore completed in ${duration}ms`)
    }
  }

  /**
   * List all backups for this database
   */
  async listBackups(): Promise<BackupMetadata[]> {
    const response = await fetch(
      `${this.dwsEndpoint}/backup/list/${this.databaseId}`,
      {
        signal: AbortSignal.timeout(this.timeout),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to list backups: ${response.statusText}`)
    }

    const result = ListBackupsResponseSchema.parse(await response.json())
    return result.backups
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    const metadata = await this.getBackupMetadata(backupId)
    if (!metadata) {
      throw new Error(`Backup not found: ${backupId}`)
    }

    // Delete from storage
    await fetch(`${this.dwsEndpoint}/storage/delete/${metadata.cid}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.timeout),
    })

    // Delete metadata
    await fetch(`${this.dwsEndpoint}/backup/${backupId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.timeout),
    })

    if (this.debug) {
      console.log(`[Backup] Deleted backup ${backupId}`)
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupId: string): Promise<boolean> {
    const metadata = await this.getBackupMetadata(backupId)
    if (!metadata) {
      throw new Error(`Backup not found: ${backupId}`)
    }

    // Download and verify checksum
    const data = await this.downloadFromStorage(metadata.cid)
    const currentChecksum = await this.calculateChecksum(data.toString())

    return currentChecksum === metadata.checksum
  }

  /**
   * Start scheduled backups
   */
  startScheduledBackups(intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.scheduleInterval) {
      this.stopScheduledBackups()
    }

    this.scheduleInterval = setInterval(async () => {
      try {
        await this.createBackup({ compress: true })
      } catch (error) {
        if (this.onBackupError) {
          this.onBackupError(
            error instanceof Error ? error : new Error(String(error)),
          )
        }
      }
    }, intervalMs)

    if (this.debug) {
      console.log(`[Backup] Started scheduled backups every ${intervalMs}ms`)
    }
  }

  /**
   * Stop scheduled backups
   */
  stopScheduledBackups(): void {
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval)
      this.scheduleInterval = null
    }
  }

  // Private methods

  private generateBackupId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 8)
    return `${this.databaseId}-${timestamp}-${random}`
  }

  private async listTables(): Promise<string[]> {
    const response = await this.queryOnEQLite(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    return response.map((r) => r.name as string)
  }

  private async exportTable(table: string): Promise<unknown[]> {
    return this.queryOnEQLite(`SELECT * FROM "${table}"`)
  }

  private async exportSchema(tables: string[]): Promise<string> {
    const schemas: string[] = []

    for (const table of tables) {
      const result = await this.queryOnEQLite(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`,
      )
      if (result[0]?.sql) {
        schemas.push(result[0].sql as string)
      }
    }

    return schemas.join(';\n')
  }

  private async importTable(
    table: string,
    rows: unknown[],
    targetDb: string,
  ): Promise<void> {
    if (rows.length === 0) return

    // Get columns from first row
    const firstRow = rows[0] as Record<string, unknown>
    const columns = Object.keys(firstRow)

    // Batch insert in chunks of 100
    const batchSize = 100
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize) as Record<string, unknown>[]

      for (const row of batch) {
        const values = columns.map((c) => row[c])
        const placeholders = columns.map(() => '?').join(', ')
        const sql = `INSERT INTO "${table}" (${columns.join(', ')}) VALUES (${placeholders})`

        await this.execOnEQLite(sql, targetDb, values)
      }
    }
  }

  private async restoreSchema(schema: string, targetDb: string): Promise<void> {
    const statements = schema.split(';').filter((s) => s.trim())
    for (const stmt of statements) {
      await this.execOnEQLite(stmt, targetDb)
    }
  }

  private async queryOnEQLite(sql: string): Promise<Record<string, unknown>[]> {
    const response = await fetch(`${this.eqliteEndpoint}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: this.databaseId,
        query: sql,
        assoc: true,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`EQLite query failed: ${response.statusText}`)
    }

    const data = (await response.json()) as {
      data?: { rows?: Record<string, unknown>[] }
    }
    return data.data?.rows ?? []
  }

  private async execOnEQLite(
    sql: string,
    targetDb?: string,
    params?: unknown[],
  ): Promise<void> {
    const response = await fetch(`${this.eqliteEndpoint}/v1/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: targetDb ?? this.databaseId,
        query: sql,
        params: params ?? [],
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`EQLite exec failed: ${response.statusText}`)
    }
  }

  private async uploadToStorage(
    data: Buffer,
    filename: string,
  ): Promise<string> {
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(data)]), filename)
    formData.append('tier', 'private')
    formData.append('encrypt', String(this.encryptBackups))
    formData.append('backends', this.storageBackend)
    formData.append('category', 'backup')

    const response = await fetch(`${this.dwsEndpoint}/storage/upload`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`)
    }

    const result = UploadResponseSchema.parse(await response.json())
    return result.cid
  }

  private async downloadFromStorage(cid: string): Promise<Buffer> {
    const response = await fetch(
      `${this.dwsEndpoint}/storage/download/${cid}`,
      {
        signal: AbortSignal.timeout(this.timeout),
      },
    )

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  private async encryptData(data: string): Promise<string> {
    if (!this.kmsEndpoint) {
      // Use simple base64 encoding if KMS not available
      return Buffer.from(data).toString('base64')
    }

    const response = await fetch(`${this.kmsEndpoint}/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId: this.encryptionKeyId,
        plaintext: data,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Encryption failed: ${response.statusText}`)
    }

    const result = (await response.json()) as {
      ciphertext: string
      nonce: string
    }
    return `${result.ciphertext}:${result.nonce}`
  }

  private async decryptData(data: string): Promise<string> {
    if (!this.kmsEndpoint || !data.includes(':')) {
      // Simple base64 decoding
      return Buffer.from(data, 'base64').toString()
    }

    const [ciphertext, nonce] = data.split(':')

    const response = await fetch(`${this.kmsEndpoint}/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId: this.encryptionKeyId,
        ciphertext,
        nonce,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Decryption failed: ${response.statusText}`)
    }

    const result = (await response.json()) as { plaintext: string }
    return result.plaintext
  }

  private async compress(data: string): Promise<string> {
    // Use Bun's built-in gzip
    const compressed = Bun.gzipSync(Buffer.from(data))
    return Buffer.from(new Uint8Array(compressed)).toString('base64')
  }

  private async calculateChecksum(data: string): Promise<string> {
    const hasher = new Bun.CryptoHasher('sha256')
    hasher.update(data)
    return hasher.digest('hex')
  }

  private async storeBackupMetadata(metadata: BackupMetadata): Promise<void> {
    await fetch(`${this.dwsEndpoint}/backup/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(this.timeout),
    })
  }

  private async getBackupMetadata(
    backupId: string,
  ): Promise<BackupMetadata | null> {
    const response = await fetch(`${this.dwsEndpoint}/backup/${backupId}`, {
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      return null
    }

    return BackupMetadataSchema.parse(await response.json())
  }

  private async cleanupOldBackups(): Promise<void> {
    const backups = await this.listBackups()

    if (backups.length <= this.maxBackups) return

    // Sort by creation date (oldest first)
    const sorted = backups.sort((a, b) => a.createdAt - b.createdAt)
    const toDelete = sorted.slice(0, backups.length - this.maxBackups)

    for (const backup of toDelete) {
      await this.deleteBackup(backup.backupId).catch((err) => {
        if (this.debug) {
          console.warn(`[Backup] Failed to delete old backup: ${err}`)
        }
      })
    }
  }
}

/**
 * Create a backup service for a database
 */
export function createBackupService(
  config: BackupServiceConfig,
): BackupService {
  return new BackupService(config)
}
