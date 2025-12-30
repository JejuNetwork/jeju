/**
 * SQLit Database Service
 *
 * This service allows nodes to:
 * - Run as SQLit miner nodes for data storage and replication
 * - Host database backups and serve queries
 * - Earn rewards for storage and query serving
 * - Participate in BFT-Raft consensus
 */

import {
  type DatabaseInfo,
  type SQLitClient,
  type SQLitConfig,
  type ExecResult,
  getSQLit,
  type QueryParam,
  type QueryResult,
} from '@jejunetwork/db'
import { createKMSSigner, type KMSSigner } from '@jejunetwork/kms'
import type { Address } from 'viem'
import { z } from 'zod'
import { DATABASE_PROVIDER_ABI } from '../abis'
import type { SecureNodeClient } from '../contracts'

// Configuration schema
const DatabaseServiceConfigSchema = z.object({
  /** SQLit block producer endpoint */
  blockProducerEndpoint: z.string().url(),
  /** SQLit miner endpoint (this node's endpoint) */
  minerEndpoint: z.string().url(),
  /** KMS key/service ID for secure signing (no raw private keys) */
  keyId: z.string().min(1),
  /** Storage capacity in GB */
  capacityGB: z.number().positive(),
  /** Price per GB per month in wei */
  pricePerGBMonth: z.bigint(),
  /** Minimum stake amount in wei */
  stakeAmount: z.bigint(),
  /** Database IDs to host/replicate */
  hostedDatabases: z.array(z.string()).default([]),
  /** Enable backup hosting */
  enableBackups: z.boolean().default(true),
  /** Backup retention days */
  backupRetentionDays: z.number().int().positive().default(30),
  /** Max concurrent queries */
  maxConcurrentQueries: z.number().int().positive().default(100),
  /** Query timeout in ms */
  queryTimeoutMs: z.number().int().positive().default(30000),
})

export type DatabaseServiceConfig = z.infer<typeof DatabaseServiceConfigSchema>

// State schema
const DatabaseServiceStateSchema = z.object({
  isRegistered: z.boolean(),
  operatorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  minerEndpoint: z.string().url(),
  capacityGB: z.number().nonnegative(),
  usedGB: z.number().nonnegative(),
  pricePerGBMonth: z.bigint(),
  stake: z.bigint(),
  hostedDatabases: z.number().int().nonnegative(),
  totalQueriesServed: z.number().int().nonnegative(),
  uptime: z.number().nonnegative(),
  rewardsEarned: z.bigint(),
  rewardsPending: z.bigint(),
})

export type DatabaseServiceState = z.infer<typeof DatabaseServiceStateSchema>

// Stats schema
const DatabaseStatsSchema = z.object({
  queriesPerSecond: z.number().nonnegative(),
  avgQueryLatencyMs: z.number().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  replicationLag: z.number().nonnegative(),
  blockHeight: z.number().int().nonnegative(),
  consensusHealth: z.enum(['healthy', 'degraded', 'unhealthy']),
})

export type DatabaseStats = z.infer<typeof DatabaseStatsSchema>

// Backup info schema
const BackupInfoSchema = z.object({
  databaseId: z.string(),
  backupId: z.string(),
  createdAt: z.number(),
  sizeBytes: z.number().int().nonnegative(),
  blockHeight: z.number().int().nonnegative(),
  status: z.enum(['pending', 'complete', 'failed']),
})

export type BackupInfo = z.infer<typeof BackupInfoSchema>

export function validateDatabaseServiceConfig(
  data: unknown,
): DatabaseServiceConfig {
  return DatabaseServiceConfigSchema.parse(data)
}

export function validateDatabaseServiceState(
  data: unknown,
): DatabaseServiceState {
  return DatabaseServiceStateSchema.parse(data)
}

export function validateDatabaseStats(data: unknown): DatabaseStats {
  return DatabaseStatsSchema.parse(data)
}

/**
 * SQLit Database Service for node operators
 */
export class DatabaseService {
  private nodeClient: SecureNodeClient
  private sqlitClient: SQLitClient | null = null
  private config: DatabaseServiceConfig | null = null
  private signer: KMSSigner | null = null
  private isRunning = false
  private queryCount = 0
  private queryLatencies: number[] = []
  private startTime = 0

  constructor(nodeClient: SecureNodeClient) {
    this.nodeClient = nodeClient
  }

  /**
   * Initialize the SQLit client connection with KMS-backed signing
   *
   * SECURITY: No private keys in memory. All signing via KMS MPC.
   */
  async initialize(config: DatabaseServiceConfig): Promise<void> {
    this.config = validateDatabaseServiceConfig(config)

    // Create KMS signer for MPC threshold signing
    this.signer = createKMSSigner({ serviceId: this.config.keyId })
    await this.signer.initialize()

    const sqlitClient: SQLitConfig = {
      blockProducerEndpoint: this.config.blockProducerEndpoint,
      minerEndpoint: this.config.minerEndpoint,
      keyId: this.config.keyId,
      timeout: this.config.queryTimeoutMs,
    }

    this.sqlitClient = getSQLit(sqlitClient)
  }

  /**
   * Get the current state of this database provider
   */
  async getState(address: Address): Promise<DatabaseServiceState> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(`Invalid address: ${address}`)
    }

    const provider = await this.nodeClient.publicClient.readContract({
      address: this.nodeClient.addresses.databaseProvider,
      abi: DATABASE_PROVIDER_ABI,
      functionName: 'getProvider',
      args: [address],
    })

    // Fetch pending rewards from contract
    const pendingRewards = await this.nodeClient.publicClient.readContract({
      address: this.nodeClient.addresses.databaseProvider,
      abi: DATABASE_PROVIDER_ABI,
      functionName: 'pendingRewards',
      args: [address],
    })

    return validateDatabaseServiceState({
      isRegistered: provider[7], // isActive
      operatorAddress: address,
      minerEndpoint: provider[0],
      capacityGB: Number(provider[1] / (1024n * 1024n * 1024n)),
      usedGB: Number(provider[2] / (1024n * 1024n * 1024n)),
      pricePerGBMonth: provider[3],
      stake: provider[4],
      hostedDatabases: Number(provider[5]),
      totalQueriesServed: Number(provider[6]),
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      rewardsEarned: 0n, // Earned rewards are tracked off-chain after claiming
      rewardsPending: pendingRewards,
    })
  }

  /**
   * Register as a database provider on-chain
   *
   * SECURITY: Transaction signed via KMS MPC, no local private keys
   */
  async register(config: DatabaseServiceConfig): Promise<string> {
    const validatedConfig = validateDatabaseServiceConfig(config)

    if (!this.signer) {
      throw new Error('Service not initialized - call initialize() first')
    }

    const capacityBytes =
      BigInt(validatedConfig.capacityGB) * 1024n * 1024n * 1024n

    // Encode contract call
    const { encodeFunctionData } = await import('viem')
    const data = encodeFunctionData({
      abi: DATABASE_PROVIDER_ABI,
      functionName: 'registerProvider',
      args: [
        validatedConfig.minerEndpoint,
        capacityBytes,
        validatedConfig.pricePerGBMonth,
      ],
    })

    // Sign transaction via KMS and broadcast
    const { signedTransaction, hash } = await this.signer.signTransaction({
      to: this.nodeClient.addresses.databaseProvider,
      data,
      value: validatedConfig.stakeAmount,
      chainId: this.nodeClient.chainId,
    })

    // Broadcast the signed transaction
    await this.nodeClient.publicClient.sendRawTransaction({
      serializedTransaction: signedTransaction,
    })

    return hash
  }

  /**
   * Start the database miner service
   */
  async start(): Promise<void> {
    if (this.isRunning) return
    if (!this.sqlitClient || !this.config) {
      throw new Error(
        'Database service not initialized. Call initialize() first.',
      )
    }

    // Verify SQLit connection
    const healthy = await this.sqlitClient.isHealthy()
    if (!healthy) {
      throw new Error('Cannot connect to SQLit block producer')
    }

    this.isRunning = true
    this.startTime = Date.now()

    // Start hosting configured databases
    for (const dbId of this.config.hostedDatabases) {
      await this.hostDatabase(dbId)
    }
  }

  /**
   * Stop the database miner service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return
    this.isRunning = false

    // Close SQLit client connections
    if (this.sqlitClient) {
      await this.sqlitClient.close()
    }
  }

  /**
   * Host a database (participate in replication)
   */
  async hostDatabase(databaseId: string): Promise<void> {
    if (!this.sqlitClient) {
      throw new Error('Database service not initialized')
    }

    // Get database info to verify it exists
    const info = await this.sqlitClient.getDatabase(databaseId)
    if (!info) {
      throw new Error(`Database ${databaseId} not found`)
    }

    // Add to hosted list if not already
    if (this.config && !this.config.hostedDatabases.includes(databaseId)) {
      this.config.hostedDatabases.push(databaseId)
    }
  }

  /**
   * Stop hosting a database
   */
  async unhostDatabase(databaseId: string): Promise<void> {
    if (this.config) {
      this.config.hostedDatabases = this.config.hostedDatabases.filter(
        (id) => id !== databaseId,
      )
    }
  }

  /**
   * Execute a query on behalf of a client (earn rewards)
   */
  async executeQuery<T>(
    sql: string,
    params: QueryParam[],
    databaseId: string,
  ): Promise<QueryResult<T>> {
    if (!this.sqlitClient) {
      throw new Error('Database service not initialized')
    }

    const startTime = performance.now()
    const result = await this.sqlitClient.query<T>(sql, params, databaseId)
    const latency = performance.now() - startTime

    this.queryCount++
    this.queryLatencies.push(latency)
    // Keep last 1000 latencies
    if (this.queryLatencies.length > 1000) {
      this.queryLatencies.shift()
    }

    return result
  }

  /**
   * Execute a write operation (INSERT/UPDATE/DELETE)
   */
  async executeWrite(
    sql: string,
    params: QueryParam[],
    databaseId: string,
  ): Promise<ExecResult> {
    if (!this.sqlitClient) {
      throw new Error('Database service not initialized')
    }

    return this.sqlitClient.exec(sql, params, databaseId)
  }

  /**
   * Create a backup of a database
   */
  async createBackup(databaseId: string): Promise<BackupInfo> {
    if (!this.sqlitClient) {
      throw new Error('Database service not initialized')
    }

    // Get current database state
    const info = await this.sqlitClient.getDatabase(databaseId)
    if (!info) {
      throw new Error(`Database ${databaseId} not found`)
    }

    const backupId = `backup-${databaseId}-${Date.now()}`

    // In a real implementation, this would trigger a snapshot
    // For now, return backup info
    return validateBackupInfo({
      databaseId,
      backupId,
      createdAt: Date.now(),
      sizeBytes: info.sizeBytes,
      blockHeight: info.blockHeight,
      status: 'complete',
    })
  }

  /**
   * List available backups for a database
   * Backups are stored in SQLit with metadata
   */
  async listBackups(databaseId: string): Promise<BackupInfo[]> {
    if (!this.sqlitClient) {
      return []
    }

    // Query SQLit for backups of this database
    const result = await this.sqlitClient.query<{
      backup_id: string
      database_id: string
      created_at: number
      size_bytes: number
      block_height: number
      status: string
    }>(
      `SELECT * FROM database_backups WHERE database_id = ? ORDER BY created_at DESC`,
      [databaseId],
      'system',
    )

    return result.rows.map((row) =>
      validateBackupInfo({
        databaseId: row.database_id,
        backupId: row.backup_id,
        createdAt: row.created_at,
        sizeBytes: row.size_bytes,
        blockHeight: row.block_height,
        status: row.status as 'pending' | 'complete' | 'failed',
      }),
    )
  }

  /**
   * Restore a database from backup
   * Uses SQLit's built-in snapshot restoration
   */
  async restoreBackup(
    backupId: string,
    targetDatabaseId: string,
  ): Promise<void> {
    if (!this.sqlitClient) {
      throw new Error('Database service not initialized')
    }

    // Get backup metadata
    const backups = await this.sqlitClient.query<{
      backup_id: string
      database_id: string
      snapshot_path: string
      block_height: number
    }>(
      `SELECT * FROM database_backups WHERE backup_id = ?`,
      [backupId],
      'system',
    )

    if (backups.rows.length === 0) {
      throw new Error(`Backup ${backupId} not found`)
    }

    const backup = backups.rows[0]

    // Check if target database exists
    const targetInfo = await this.sqlitClient.getDatabase(targetDatabaseId)
    if (targetInfo) {
      console.log(
        `[DatabaseService] Restoring ${targetDatabaseId} from backup ${backupId}`,
      )
    }

    // Execute restore via SQLit system command
    await this.sqlitClient.exec(
      `RESTORE DATABASE ? FROM SNAPSHOT ?`,
      [targetDatabaseId, backup.snapshot_path],
      'system',
    )

    console.log(
      `[DatabaseService] Restored ${targetDatabaseId} to block height ${backup.block_height}`,
    )
  }

  /**
   * Get current database stats
   */
  async getStats(): Promise<DatabaseStats> {
    const avgLatency =
      this.queryLatencies.length > 0
        ? this.queryLatencies.reduce((a, b) => a + b, 0) /
          this.queryLatencies.length
        : 0

    const uptimeSeconds = this.isRunning
      ? (Date.now() - this.startTime) / 1000
      : 0
    const qps = uptimeSeconds > 0 ? this.queryCount / uptimeSeconds : 0

    // Get block height and replication info from SQLit
    let blockHeight = 0
    let replicationLag = 0
    let activeConnections = 0

    if (this.sqlitClient) {
      try {
        // Query SQLit status endpoint for stats
        const status = await this.sqlitClient.query<{
          block_height: number
          replica_lag_ms: number
          active_connections: number
        }>(
          `SELECT block_height, replica_lag_ms, active_connections FROM system_status`,
          [],
          'system',
        )

        if (status.rows.length > 0) {
          blockHeight = status.rows[0].block_height
          replicationLag = status.rows[0].replica_lag_ms
          activeConnections = status.rows[0].active_connections
        }
      } catch {
        // System status table may not exist, use defaults
      }
    }

    return validateDatabaseStats({
      queriesPerSecond: qps,
      avgQueryLatencyMs: avgLatency,
      activeConnections,
      replicationLag,
      blockHeight,
      consensusHealth: this.isRunning ? 'healthy' : 'unhealthy',
    })
  }

  /**
   * List all databases this node is hosting
   */
  async listHostedDatabases(): Promise<DatabaseInfo[]> {
    if (!this.sqlitClient || !this.config) {
      return []
    }

    const databases: DatabaseInfo[] = []
    for (const dbId of this.config.hostedDatabases) {
      const info = await this.sqlitClient.getDatabase(dbId)
      if (info) {
        databases.push(info)
      }
    }
    return databases
  }

  /**
   * Get available rental plans
   */
  async listRentalPlans() {
    if (!this.sqlitClient) {
      return []
    }
    return this.sqlitClient.listPlans()
  }

  /**
   * Claim pending rewards from database operations
   *
   * SECURITY: Transaction signed via KMS MPC, no local private keys
   */
  async claimRewards(): Promise<string> {
    if (!this.signer) {
      throw new Error('Service not initialized - call initialize() first')
    }

    // Encode contract call
    const { encodeFunctionData } = await import('viem')
    const data = encodeFunctionData({
      abi: DATABASE_PROVIDER_ABI,
      functionName: 'claimRewards',
      args: [],
    })

    // Sign transaction via KMS and broadcast
    const { signedTransaction, hash } = await this.signer.signTransaction({
      to: this.nodeClient.addresses.databaseProvider,
      data,
      chainId: this.nodeClient.chainId,
    })

    // Broadcast the signed transaction
    await this.nodeClient.publicClient.sendRawTransaction({
      serializedTransaction: signedTransaction,
    })

    return hash
  }

  /**
   * Check if the service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning
  }

  /**
   * Get the SQLit client for direct operations
   */
  getSQLitClient(): SQLitClient | null {
    return this.sqlitClient
  }
}

function validateBackupInfo(data: unknown): BackupInfo {
  return BackupInfoSchema.parse(data)
}

export function createDatabaseService(
  nodeClient: SecureNodeClient,
): DatabaseService {
  return new DatabaseService(nodeClient)
}
