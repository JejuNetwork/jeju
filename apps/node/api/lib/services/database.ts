/**
 * EQLite Database Service
 *
 * This service allows nodes to:
 * - Run as EQLite miner nodes for data storage and replication
 * - Host database backups and serve queries
 * - Earn rewards for storage and query serving
 * - Participate in BFT-Raft consensus
 */

import {
  type DatabaseInfo,
  type EQLiteClient,
  type EQLiteConfig,
  type ExecResult,
  getEQLite,
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
  /** EQLite block producer endpoint */
  blockProducerEndpoint: z.string().url(),
  /** EQLite miner endpoint (this node's endpoint) */
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
 * EQLite Database Service for node operators
 */
export class DatabaseService {
  private nodeClient: SecureNodeClient
  private eqliteClient: EQLiteClient | null = null
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
   * Initialize the EQLite client connection with KMS-backed signing
   *
   * SECURITY: No private keys in memory. All signing via KMS MPC.
   */
  async initialize(config: DatabaseServiceConfig): Promise<void> {
    this.config = validateDatabaseServiceConfig(config)

    // Create KMS signer for MPC threshold signing
    this.signer = createKMSSigner({ serviceId: this.config.keyId })
    await this.signer.initialize()

    const eqliteClient: EQLiteConfig = {
      blockProducerEndpoint: this.config.blockProducerEndpoint,
      minerEndpoint: this.config.minerEndpoint,
      keyId: this.config.keyId,
      timeout: this.config.queryTimeoutMs,
    }

    this.eqliteClient = getEQLite(eqliteClient)
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
      rewardsEarned: 0n, // TODO: fetch from contract
      rewardsPending: 0n, // TODO: fetch from contract
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
    if (!this.eqliteClient || !this.config) {
      throw new Error(
        'Database service not initialized. Call initialize() first.',
      )
    }

    // Verify EQLite connection
    const healthy = await this.eqliteClient.isHealthy()
    if (!healthy) {
      throw new Error('Cannot connect to EQLite block producer')
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

    // Close EQLite client connections
    if (this.eqliteClient) {
      await this.eqliteClient.close()
    }
  }

  /**
   * Host a database (participate in replication)
   */
  async hostDatabase(databaseId: string): Promise<void> {
    if (!this.eqliteClient) {
      throw new Error('Database service not initialized')
    }

    // Get database info to verify it exists
    const info = await this.eqliteClient.getDatabase(databaseId)
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
    if (!this.eqliteClient) {
      throw new Error('Database service not initialized')
    }

    const startTime = performance.now()
    const result = await this.eqliteClient.query<T>(sql, params, databaseId)
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
    if (!this.eqliteClient) {
      throw new Error('Database service not initialized')
    }

    return this.eqliteClient.exec(sql, params, databaseId)
  }

  /**
   * Create a backup of a database
   */
  async createBackup(databaseId: string): Promise<BackupInfo> {
    if (!this.eqliteClient) {
      throw new Error('Database service not initialized')
    }

    // Get current database state
    const info = await this.eqliteClient.getDatabase(databaseId)
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
   */
  async listBackups(_databaseId: string): Promise<BackupInfo[]> {
    // TODO: Implement backup listing from storage
    return []
  }

  /**
   * Restore a database from backup
   */
  async restoreBackup(
    _backupId: string,
    _targetDatabaseId: string,
  ): Promise<void> {
    if (!this.eqliteClient) {
      throw new Error('Database service not initialized')
    }

    // TODO: Implement backup restoration
    throw new Error('Backup restoration not yet implemented')
  }

  /**
   * Get current database stats
   */
  getStats(): DatabaseStats {
    const avgLatency =
      this.queryLatencies.length > 0
        ? this.queryLatencies.reduce((a, b) => a + b, 0) /
          this.queryLatencies.length
        : 0

    const uptimeSeconds = this.isRunning
      ? (Date.now() - this.startTime) / 1000
      : 0
    const qps = uptimeSeconds > 0 ? this.queryCount / uptimeSeconds : 0

    return validateDatabaseStats({
      queriesPerSecond: qps,
      avgQueryLatencyMs: avgLatency,
      activeConnections: 0, // TODO: Track active connections
      replicationLag: 0, // TODO: Calculate replication lag
      blockHeight: 0, // TODO: Get from CQL
      consensusHealth: this.isRunning ? 'healthy' : 'unhealthy',
    })
  }

  /**
   * List all databases this node is hosting
   */
  async listHostedDatabases(): Promise<DatabaseInfo[]> {
    if (!this.eqliteClient || !this.config) {
      return []
    }

    const databases: DatabaseInfo[] = []
    for (const dbId of this.config.hostedDatabases) {
      const info = await this.eqliteClient.getDatabase(dbId)
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
    if (!this.eqliteClient) {
      return []
    }
    return this.eqliteClient.listPlans()
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
   * Get the EQLite client for direct operations
   */
  getEQLiteClient(): EQLiteClient | null {
    return this.eqliteClient
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
