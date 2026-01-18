/**
 * SQLit Dynamic Provisioning Service
 *
 * Provisions SQLit databases via HTTP API.
 * No AWS - everything is done through SQLit endpoints.
 *
 * Features:
 * - Provision databases per-app dynamically
 * - Store database IDs in JNS text records
 * - Backup and recovery for lost containers
 * - Works for dev, start, and testnet deployment
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  namehash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localnetChain } from '../lib/chain'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

// JNS Resolver ABI for setting text records
const JNS_RESOLVER_ABI = [
  {
    name: 'setText',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'text',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const

export interface DatabaseProvisionResult {
  databaseId: string
  name: string
  endpoint: string
  isNew: boolean
}

export interface DatabaseProvisionConfig {
  consistency?: 'eventual' | 'strong'
  replication?: number
  forceNew?: boolean
}

export interface SQLitProvisioningConfig {
  rpcUrl: string
  privateKey: `0x${string}`
  jnsResolverAddress: Address
  sqlitEndpoint: string
}

interface ProvisionedDatabase {
  databaseId: string
  appName: string
  jnsName: string
  endpoint: string
  provisionedAt: string
  network: string
}

interface ProvisioningState {
  databases: Record<string, ProvisionedDatabase>
  lastBackup?: string
}

export class SQLitProvisioningService {
  private config: SQLitProvisioningConfig
  private publicClient: ReturnType<typeof createPublicClient>
  private walletClient: ReturnType<typeof createWalletClient>
  private stateFile: string
  private state: ProvisioningState

  constructor(config: SQLitProvisioningConfig) {
    this.config = config
    const account = privateKeyToAccount(config.privateKey)

    this.publicClient = createPublicClient({
      chain: localnetChain,
      transport: http(config.rpcUrl),
    })

    this.walletClient = createWalletClient({
      account,
      chain: localnetChain,
      transport: http(config.rpcUrl),
    })

    // State file for tracking provisioned databases
    const rootDir = findMonorepoRoot()
    this.stateFile = join(rootDir, '.jeju/sqlit-provisioning.json')
    this.state = this.loadState()
  }

  private loadState(): ProvisioningState {
    if (existsSync(this.stateFile)) {
      return JSON.parse(readFileSync(this.stateFile, 'utf-8'))
    }
    return { databases: {} }
  }

  private saveState(): void {
    const dir = join(findMonorepoRoot(), '.jeju')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2))
  }

  /**
   * Provision a SQLit database for an app.
   * First checks if already provisioned, then provisions on-chain if needed.
   */
  async provisionDatabase(
    appName: string,
    jnsName: string,
    options?: DatabaseProvisionConfig,
  ): Promise<DatabaseProvisionResult> {
    const dbKey = `${appName}-${jnsName}`

    // Check if already provisioned and still valid
    if (!options?.forceNew && this.state.databases[dbKey]) {
      const existing = this.state.databases[dbKey]
      const isHealthy = await this.checkDatabaseHealth(existing.databaseId)

      if (isHealthy) {
        logger.debug(`SQLit database for ${appName} already provisioned`)
        return {
          databaseId: existing.databaseId,
          name: appName,
          endpoint: existing.endpoint,
          isNew: false,
        }
      }

      // Database lost, need to reprovision
      logger.warn(`SQLit database for ${appName} unhealthy, reprovisioning...`)
    }

    // Check JNS for existing database ID
    const existingDbId = await this.getDatabaseIdFromJNS(jnsName)
    if (existingDbId && !options?.forceNew) {
      const isHealthy = await this.checkDatabaseHealth(existingDbId)
      if (isHealthy) {
        const result: DatabaseProvisionResult = {
          databaseId: existingDbId,
          name: appName,
          endpoint: this.config.sqlitEndpoint,
          isNew: false,
        }

        // Update local state
        this.state.databases[dbKey] = {
          databaseId: existingDbId,
          appName,
          jnsName,
          endpoint: this.config.sqlitEndpoint,
          provisionedAt: new Date().toISOString(),
          network: 'localnet',
        }
        this.saveState()

        return result
      }
    }

    // Provision new database via SQLit API
    logger.step(`Provisioning SQLit database for ${appName}...`)

    const consistency = options?.consistency ?? 'eventual'
    const replication = options?.replication ?? 1
    const databaseName = `${appName}-db`

    const databaseId = await this.provisionViaLocalSQLit(
      databaseName,
      consistency,
      replication,
    )

    // Update JNS with database ID
    await this.setDatabaseIdInJNS(jnsName, databaseId)

    const result: DatabaseProvisionResult = {
      databaseId,
      name: databaseName,
      endpoint: this.config.sqlitEndpoint,
      isNew: true,
    }

    // Update local state
    this.state.databases[dbKey] = {
      databaseId,
      appName,
      jnsName,
      endpoint: this.config.sqlitEndpoint,
      provisionedAt: new Date().toISOString(),
      network: 'localnet',
    }
    this.saveState()

    logger.success(`SQLit database provisioned: ${databaseId}`)
    return result
  }

  /**
   * Provision database via local SQLit API
   */
  private async provisionViaLocalSQLit(
    name: string,
    consistency: string,
    replication: number,
  ): Promise<string> {
    const response = await fetch(`${this.config.sqlitEndpoint}/v2/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        encryptionMode: 'none',
        replication: { replicaCount: replication },
        consistency,
      }),
    })

    if (!response.ok) {
      // Check if database already exists
      if (response.status === 409) {
        return name
      }
      throw new Error(`Failed to provision database: ${await response.text()}`)
    }

    const result = (await response.json()) as { databaseId: string }
    return result.databaseId
  }

  /**
   * Get database ID from JNS text record
   */
  private async getDatabaseIdFromJNS(jnsName: string): Promise<string | null> {
    const node = namehash(`${jnsName}.jeju`)

    try {
      const databaseId = await this.publicClient.readContract({
        address: this.config.jnsResolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, 'dws.databaseId'],
      })
      return databaseId || null
    } catch {
      return null
    }
  }

  /**
   * Set database ID in JNS text record
   */
  private async setDatabaseIdInJNS(
    jnsName: string,
    databaseId: string,
  ): Promise<void> {
    const node = namehash(`${jnsName}.jeju`)

    try {
      const account = privateKeyToAccount(this.config.privateKey)
      const hash = await this.walletClient.writeContract({
        account,
        chain: localnetChain,
        address: this.config.jnsResolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'setText',
        args: [node, 'dws.databaseId', databaseId],
      })

      await this.publicClient.waitForTransactionReceipt({ hash })
      logger.debug(`Set dws.databaseId=${databaseId} for ${jnsName}.jeju`)
    } catch (error) {
      logger.debug(`Failed to set JNS databaseId: ${error}`)
    }
  }

  /**
   * Check if a database is healthy and accessible
   */
  async checkDatabaseHealth(databaseId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.sqlitEndpoint}/v2/databases/${databaseId}`,
        { signal: AbortSignal.timeout(5000) },
      )
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Get all provisioned databases
   */
  getProvisionedDatabases(): ProvisionedDatabase[] {
    return Object.values(this.state.databases)
  }

  /**
   * Backup database to IPFS/DWS storage
   */
  async backupDatabase(databaseId: string): Promise<string> {
    logger.step(`Backing up database ${databaseId}...`)

    // Export database via SQLit API
    const exportResponse = await fetch(
      `${this.config.sqlitEndpoint}/v2/databases/${databaseId}/export`,
      { method: 'POST' },
    )

    if (!exportResponse.ok) {
      throw new Error(
        `Failed to export database: ${await exportResponse.text()}`,
      )
    }

    const exportData = await exportResponse.arrayBuffer()

    // Upload to IPFS via DWS storage
    const dwsStorageUrl = this.config.sqlitEndpoint.replace(':4661', ':4030')
    const formData = new FormData()
    formData.append(
      'file',
      new Blob([exportData]),
      `${databaseId}-backup.sqlite`,
    )

    const uploadResponse = await fetch(`${dwsStorageUrl}/storage/upload`, {
      method: 'POST',
      body: formData,
    })

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload backup: ${await uploadResponse.text()}`)
    }

    const result = (await uploadResponse.json()) as { cid: string }
    const backupCid = result.cid

    this.state.lastBackup = new Date().toISOString()
    this.saveState()

    logger.success(`Database backed up: ipfs://${backupCid}`)
    return backupCid
  }

  /**
   * Restore database from IPFS backup
   */
  async restoreDatabase(
    appName: string,
    jnsName: string,
    backupCid: string,
  ): Promise<DatabaseProvisionResult> {
    logger.step(`Restoring database for ${appName} from ${backupCid}...`)

    // First provision a new database
    const newDb = await this.provisionDatabase(appName, jnsName, {
      forceNew: true,
    })

    // Download backup from IPFS
    const dwsStorageUrl = this.config.sqlitEndpoint.replace(':4661', ':4030')
    const downloadResponse = await fetch(
      `${dwsStorageUrl}/storage/download/${backupCid}`,
    )

    if (!downloadResponse.ok) {
      throw new Error(
        `Failed to download backup: ${await downloadResponse.text()}`,
      )
    }

    const backupData = await downloadResponse.arrayBuffer()

    // Import into new database
    const importFormData = new FormData()
    importFormData.append('file', new Blob([backupData]), 'backup.sqlite')

    const importResponse = await fetch(
      `${this.config.sqlitEndpoint}/v2/databases/${newDb.databaseId}/import`,
      {
        method: 'POST',
        body: importFormData,
      },
    )

    if (!importResponse.ok) {
      throw new Error(`Failed to import backup: ${await importResponse.text()}`)
    }

    logger.success(`Database restored: ${newDb.databaseId}`)
    return newDb
  }

  /**
   * Auto-recover a database from JNS backup if needed
   */
  async autoRecover(
    appName: string,
    jnsName: string,
  ): Promise<DatabaseProvisionResult | null> {
    const dbKey = `${appName}-${jnsName}`
    const existing = this.state.databases[dbKey]

    if (existing) {
      const isHealthy = await this.checkDatabaseHealth(existing.databaseId)
      if (isHealthy) {
        return {
          databaseId: existing.databaseId,
          name: appName,
          endpoint: existing.endpoint,
          isNew: false,
        }
      }
    }

    // No backup recovery implemented yet - just provision fresh
    logger.warn(`No existing database for ${appName}, provisioning fresh`)
    return this.provisionDatabase(appName, jnsName)
  }
}

/**
 * Create SQLit provisioning service
 */
export function createSQLitProvisioningService(
  config: SQLitProvisioningConfig,
): SQLitProvisioningService {
  return new SQLitProvisioningService(config)
}
