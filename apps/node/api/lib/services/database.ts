/**
 * CQL Database Service - Participate in CovenantSQL mining and storage
 *
 * This service allows nodes to:
 * - Run as CQL miner nodes for data storage and replication
 * - Host database backups and serve queries
 * - Earn rewards for storage and query serving
 * - Participate in BFT-Raft consensus
 */

import {
  CQLClient,
  getCQL,
  type CQLConfig,
  type DatabaseInfo,
  type QueryResult,
  type ExecResult,
} from '@jejunetwork/db'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { DATABASE_PROVIDER_ABI } from '../abis'
import { getChain, type NodeClient } from '../contracts'

// Configuration schema
const DatabaseServiceConfigSchema = z.object({
  /** CQL block producer endpoint */
  blockProducerEndpoint: z.string().url(),
  /** CQL miner endpoint (this node's endpoint) */
  minerEndpoint: z.string().url(),
  /** Private key for signing database operations */
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
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
 * CQL Database Service for node operators
 */
export class DatabaseService {
  private nodeClient: NodeClient
  private cqlClient: CQLClient | null = null
  private config: DatabaseServiceConfig | null = null
  private isRunning = false
  private queryCount = 0
  private queryLatencies: number[] = []
  private startTime = 0

  constructor(nodeClient: NodeClient) {
    this.nodeClient = nodeClient
  }

  /**
   * Initialize the CQL client connection
   */
  async initialize(config: DatabaseServiceConfig): Promise<void> {
    this.config = validateDatabaseServiceConfig(config)

    const cqlConfig: CQLConfig = {
      blockProducerEndpoint: this.config.blockProducerEndpoint,
      minerEndpoint: this.config.minerEndpoint,
      privateKey: this.config.privateKey as Hex,
      timeout: this.config.queryTimeoutMs,
    }

    this.cqlClient = getCQL(cqlConfig)
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
   */
  async register(config: DatabaseServiceConfig): Promise<string> {
    const validatedConfig = validateDatabaseServiceConfig(config)

    if (!this.nodeClient.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const capacityBytes =
      BigInt(validatedConfig.capacityGB) * 1024n * 1024n * 1024n

    const hash = await this.nodeClient.walletClient.writeContract({
      chain: getChain(this.nodeClient.chainId),
      account: this.nodeClient.walletClient.account,
      address: this.nodeClient.addresses.databaseProvider,
      abi: DATABASE_PROVIDER_ABI,
      functionName: 'registerProvider',
      args: [
        validatedConfig.minerEndpoint,
        capacityBytes,
        validatedConfig.pricePerGBMonth,
      ],
      value: validatedConfig.stakeAmount,
    })

    return hash
  }

  /**
   * Start the database miner service
   */
  async start(): Promise<void> {
    if (this.isRunning) return
    if (!this.cqlClient || !this.config) {
      throw new Error('Database service not initialized. Call initialize() first.')
    }

    // Verify CQL connection
    const healthy = await this.cqlClient.isHealthy()
    if (!healthy) {
      throw new Error('Cannot connect to CQL block producer')
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

    // Close CQL client connections
    if (this.cqlClient) {
      await this.cqlClient.close()
    }
  }

  /**
   * Host a database (participate in replication)
   */
  async hostDatabase(databaseId: string): Promise<void> {
    if (!this.cqlClient) {
      throw new Error('Database service not initialized')
    }

    // Get database info to verify it exists
    const info = await this.cqlClient.getDatabase(databaseId)
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
    params: unknown[],
    databaseId: string,
  ): Promise<QueryResult<T>> {
    if (!this.cqlClient) {
      throw new Error('Database service not initialized')
    }

    const startTime = performance.now()
    const result = await this.cqlClient.query<T>(sql, params, databaseId)
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
    params: unknown[],
    databaseId: string,
  ): Promise<ExecResult> {
    if (!this.cqlClient) {
      throw new Error('Database service not initialized')
    }

    return this.cqlClient.exec(sql, params, databaseId)
  }

  /**
   * Create a backup of a database
   */
  async createBackup(databaseId: string): Promise<BackupInfo> {
    if (!this.cqlClient) {
      throw new Error('Database service not initialized')
    }

    // Get current database state
    const info = await this.cqlClient.getDatabase(databaseId)
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
  async listBackups(databaseId: string): Promise<BackupInfo[]> {
    // TODO: Implement backup listing from storage
    return []
  }

  /**
   * Restore a database from backup
   */
  async restoreBackup(backupId: string, targetDatabaseId: string): Promise<void> {
    if (!this.cqlClient) {
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
    if (!this.cqlClient || !this.config) {
      return []
    }

    const databases: DatabaseInfo[] = []
    for (const dbId of this.config.hostedDatabases) {
      const info = await this.cqlClient.getDatabase(dbId)
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
    if (!this.cqlClient) {
      return []
    }
    return this.cqlClient.listPlans()
  }

  /**
   * Claim pending rewards from database operations
   */
  async claimRewards(): Promise<string> {
    if (!this.nodeClient.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await this.nodeClient.walletClient.writeContract({
      chain: getChain(this.nodeClient.chainId),
      account: this.nodeClient.walletClient.account,
      address: this.nodeClient.addresses.databaseProvider,
      abi: DATABASE_PROVIDER_ABI,
      functionName: 'claimRewards',
      args: [],
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
   * Get the CQL client for direct operations
   */
  getCQLClient(): CQLClient | null {
    return this.cqlClient
  }
}

function validateBackupInfo(data: unknown): BackupInfo {
  return BackupInfoSchema.parse(data)
}

export function createDatabaseService(nodeClient: NodeClient): DatabaseService {
  return new DatabaseService(nodeClient)
}

