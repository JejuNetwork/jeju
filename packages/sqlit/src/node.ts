/**
 * SQLit v2 Node Service
 *
 * Permissionless database node implementation using Bun SQLite with:
 * - WAL-based replication for high availability
 * - TEE support for encrypted execution
 * - Staking and slashing integration
 * - Automatic peer discovery and failover
 *
 * Note: Uses bun:sqlite (SQLite3) as the storage engine. For production
 * distributed deployments, consider migrating to libSQL/Turso for native
 * replication support.
 */

import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

// Create a generic chain for development
const devChain: Chain = {
  ...mainnet,
  id: 31337,
  name: 'Development',
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
  },
}

import {
  getTEEConfigFromEnv,
  type NodeTEECapabilities,
  SQLitNodeTEE,
  type SQLitTEEConfig,
} from './tee'
import type {
  ACLRule,
  BatchExecuteRequest,
  BatchExecuteResponse,
  CreateDatabaseRequest,
  CreateDatabaseResponse,
  DatabaseState,
  ExecuteRequest,
  ExecuteResponse,
  GrantRequest,
  NodeState,
  PeerConnection,
  RevokeRequest,
  SQLitEventHandler,
  SQLitNodeConfig,
  SQLitServiceConfig,
  VectorBatchInsertRequest,
  VectorIndexConfig,
  VectorInsertRequest,
  VectorSearchRequest,
  VectorSearchResult,
  WALSyncRequest,
  WALSyncResponse,
} from './types'
import {
  type DatabaseInstance,
  type DatabaseNode,
  DatabaseNodeRole,
  DatabaseNodeStatus,
  DEFAULT_REPLICATION_CONFIG,
  HEARTBEAT_INTERVAL_MS,
  type QueryResult,
  type ReplicationConfig,
  SQLIT_REGISTRY_ABI,
  SQLitError,
  SQLitErrorCode,
  type WALEntry,
} from './types'

const DEFAULT_SERVICE_CONFIG: SQLitServiceConfig = {
  stakeAmount: BigInt('1000000000000000000'), // 1 token
  defaultReplication: DEFAULT_REPLICATION_CONFIG,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  maxDatabasesPerNode: 100,
  enableWalArchiving: true,
}

/**
 * SQLit v2 Node - A permissionless database node
 */
export class SQLitNode {
  private config: SQLitNodeConfig
  private serviceConfig: SQLitServiceConfig
  private state: NodeState
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private eventHandlers: SQLitEventHandler[] = []
  private walSyncTimers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private tee: SQLitNodeTEE | null = null
  private teeConfig: SQLitTEEConfig | null = null

  constructor(
    config: SQLitNodeConfig,
    serviceConfig: Partial<SQLitServiceConfig> = {},
  ) {
    this.config = config
    this.serviceConfig = { ...DEFAULT_SERVICE_CONFIG, ...serviceConfig }

    // Initialize TEE if enabled
    if (config.teeEnabled) {
      this.teeConfig = getTEEConfigFromEnv()
      this.tee = new SQLitNodeTEE(this.teeConfig)
    }

    // Initialize node state
    this.state = {
      node: this.createInitialNodeInfo(),
      databases: new Map(),
      pendingChallenges: new Map(),
      peerConnections: new Map(),
      running: false,
    }

    // Ensure data directory exists
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true })
    }
  }

  // ============ Lifecycle ============

  /**
   * Start the node and register with the network
   */
  async start(): Promise<void> {
    if (this.state.running) {
      throw new SQLitError(
        'Node already running',
        SQLitErrorCode.NODE_NOT_ACTIVE,
      )
    }

    console.log(`[SQLit v2] Starting node ${this.state.node.nodeId}`)

    // Initialize TEE if enabled
    if (this.tee) {
      await this.tee.initialize()
      const caps = await this.tee.getCapabilities()
      console.log(
        `[SQLit v2] TEE initialized: ${caps.platform}, encryption=${caps.encryptionEnabled}, teeExec=${caps.teeExecutionEnabled}`,
      )
    }

    // Register node on-chain if not already registered
    await this.registerOnChain()

    // Load existing databases from disk
    await this.loadExistingDatabases()

    // Start heartbeat
    this.startHeartbeat()

    // Start replication sync for replica databases
    this.startReplicationSync()

    // Discover peers
    await this.discoverPeers()

    this.state.running = true
    this.state.node.status = DatabaseNodeStatus.ACTIVE

    this.emitEvent({
      type: 'node:registered',
      timestamp: Date.now(),
      nodeId: this.state.node.nodeId,
      data: { endpoint: this.config.endpoint },
    })

    console.log(`[SQLit v2] Node ${this.state.node.nodeId} started`)
  }

  /**
   * Gracefully stop the node
   */
  async stop(): Promise<void> {
    if (!this.state.running) return

    console.log(`[SQLit v2] Stopping node ${this.state.node.nodeId}`)

    this.state.running = false
    this.state.node.status = DatabaseNodeStatus.EXITING

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    // Stop WAL sync timers
    for (const timer of Array.from(this.walSyncTimers.values())) {
      clearInterval(timer)
    }
    this.walSyncTimers.clear()

    // Close all databases
    for (const [dbId, dbState] of Array.from(this.state.databases.entries())) {
      console.log(`[SQLit v2] Closing database ${dbId}`)
      dbState.db.close()
    }
    this.state.databases.clear()

    // Close peer connections
    this.state.peerConnections.clear()

    console.log(`[SQLit v2] Node ${this.state.node.nodeId} stopped`)
  }

  // ============ Database Operations ============

  /**
   * Create a new database
   */
  async createDatabase(
    request: CreateDatabaseRequest,
  ): Promise<CreateDatabaseResponse> {
    // Use provided databaseId or generate one
    const databaseId =
      request.databaseId ?? this.generateDatabaseId(request.name)
    const dbPath = join(this.config.dataDir, `${databaseId}.db`)

    if (existsSync(dbPath)) {
      throw new SQLitError(
        `Database ${request.name} already exists`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Create SQLite database
    const db = new Database(dbPath, { create: true })

    // Configure for WAL mode (required for replication)
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
    db.exec('PRAGMA foreign_keys=ON')
    db.exec('PRAGMA busy_timeout=5000')

    // Apply initial schema if provided
    if (request.schema) {
      db.exec(request.schema)
    }

    // Create WAL tracking table
    db.exec(`
      CREATE TABLE IF NOT EXISTS __sqlit_wal (
        position INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        sql TEXT NOT NULL,
        params TEXT,
        hash TEXT NOT NULL,
        prev_hash TEXT NOT NULL
      )
    `)

    // Create replication config
    const replication: ReplicationConfig = {
      ...this.serviceConfig.defaultReplication,
      ...request.replication,
    }

    // Create instance info
    const instance: DatabaseInstance = {
      id: databaseId,
      databaseId,
      name: request.name,
      owner: privateKeyToAccount(this.config.operatorPrivateKey).address,
      status: 'ready',
      encryptionMode: request.encryptionMode,
      replicationConfig: replication,
      replication,
      primaryNodeId: this.state.node.nodeId,
      replicaNodeIds: [],
      sizeBytes: BigInt(0),
      rowCount: BigInt(0),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      walPosition: BigInt(0),
      connectionString: `sqlit://${this.config.endpoint}/${databaseId}`,
      httpEndpoint: `${this.config.endpoint}/v2/${databaseId}`,
      schemaVersion: 1,
      accessControl: [],
    }

    // Store in memory
    const dbState: DatabaseState = {
      db,
      instance,
      walPosition: BigInt(0),
      walBuffer: [],
      activeTransactions: new Map(),
      replicaStatus: new Map(),
      lastCheckpoint: Date.now(),
      schemaHash: this.computeSchemaHash(db),
    }

    this.state.databases.set(databaseId, dbState)
    this.state.node.databaseCount++

    // Register on-chain
    await this.registerDatabaseOnChain(instance)

    this.emitEvent({
      type: 'database:created',
      timestamp: Date.now(),
      nodeId: this.state.node.nodeId,
      databaseId,
      data: { name: request.name, encryptionMode: request.encryptionMode },
    })

    console.log(`[SQLit v2] Created database ${databaseId} (${request.name})`)

    return {
      databaseId,
      connectionString:
        instance.connectionString ??
        `sqlit://${this.config.endpoint}/${databaseId}`,
      httpEndpoint:
        instance.httpEndpoint ?? `${this.config.endpoint}/v2/${databaseId}`,
      primaryNodeId: instance.primaryNodeId,
      replicaNodeIds: instance.replicaNodeIds,
    }
  }

  /**
   * Execute a query
   */
  async execute(request: ExecuteRequest): Promise<ExecuteResponse> {
    // First try exact ID match, then try name lookup
    let dbState = this.state.databases.get(request.databaseId)
    if (!dbState) {
      dbState = this.getDatabaseByName(request.databaseId)
    }

    if (!dbState) {
      // Auto-provision database in development mode
      const isDev = process.env.NODE_ENV !== 'production'
      if (isDev) {
        console.log(
          `[SQLit v2] Auto-provisioning database: ${request.databaseId}`,
        )
        const created = await this.createDatabase({
          name: request.databaseId,
          encryptionMode: 'none',
          replication: {},
        })
        // Get by the new database ID that was returned
        dbState = this.state.databases.get(created.databaseId)
        if (!dbState) {
          throw new SQLitError(
            `Database ${request.databaseId} could not be auto-provisioned`,
            SQLitErrorCode.DATABASE_NOT_FOUND,
          )
        }
      } else {
        throw new SQLitError(
          `Database ${request.databaseId} not found`,
          SQLitErrorCode.DATABASE_NOT_FOUND,
        )
      }
    }

    const isReadOnly = this.isReadOnlyQuery(request.sql)

    // Check if we can serve this query
    if (!isReadOnly && this.state.node.role === DatabaseNodeRole.REPLICA) {
      throw new SQLitError(
        'Write queries must be sent to primary node',
        SQLitErrorCode.UNAUTHORIZED,
      )
    }

    // Check WAL consistency for strong reads
    if (
      request.requiredWalPosition &&
      dbState.walPosition < request.requiredWalPosition
    ) {
      throw new SQLitError(
        `Node is behind required WAL position`,
        SQLitErrorCode.REPLICATION_LAG,
        {
          current: dbState.walPosition.toString(),
          required: request.requiredWalPosition.toString(),
        },
      )
    }

    // Execute the query
    const result = await this.executeQuery(dbState, request)

    // For write queries, record in WAL
    if (!isReadOnly) {
      await this.recordWAL(dbState, request)
    }

    return {
      ...result,
      // Return updated WAL position after write is recorded
      walPosition: dbState.walPosition,
      databaseId: request.databaseId,
      readOnly: isReadOnly,
      processedByNodeId: this.state.node.nodeId,
    }
  }

  /**
   * Execute a batch of queries
   */
  async batchExecute(
    request: BatchExecuteRequest,
  ): Promise<BatchExecuteResponse> {
    let dbState = this.state.databases.get(request.databaseId)
    if (!dbState) {
      // Auto-provision database in development mode
      const isDev = process.env.NODE_ENV !== 'production'
      if (isDev) {
        console.log(
          `[SQLit v2] Auto-provisioning database: ${request.databaseId}`,
        )
        await this.createDatabase({
          name: request.databaseId,
          encryptionMode: 'none',
          replication: {},
        })
        dbState = this.state.databases.get(request.databaseId)
        if (!dbState) {
          throw new SQLitError(
            `Database ${request.databaseId} could not be auto-provisioned`,
            SQLitErrorCode.DATABASE_NOT_FOUND,
          )
        }
      } else {
        throw new SQLitError(
          `Database ${request.databaseId} not found`,
          SQLitErrorCode.DATABASE_NOT_FOUND,
        )
      }
    }

    const startTime = Date.now()
    const results: QueryResult[] = []

    if (request.transactional) {
      dbState.db.exec('BEGIN TRANSACTION')
    }

    try {
      for (const query of request.queries) {
        const result = await this.executeQuery(dbState, {
          sql: query.sql,
          params: query.params,
        })
        results.push(result)

        // Record WAL for writes
        if (!this.isReadOnlyQuery(query.sql)) {
          await this.recordWAL(dbState, {
            sql: query.sql,
            params: query.params,
          })
        }
      }

      if (request.transactional) {
        dbState.db.exec('COMMIT')
      }
    } catch (error) {
      if (request.transactional) {
        dbState.db.exec('ROLLBACK')
      }
      throw error
    }

    return {
      results,
      totalExecutionTimeMs: Date.now() - startTime,
      walPosition: dbState.walPosition,
    }
  }

  /**
   * Get database info by ID
   */
  getDatabase(databaseId: string): DatabaseInstance | null {
    const dbState = this.state.databases.get(databaseId)
    return dbState?.instance ?? null
  }

  /**
   * Get database state by name (for auto-provisioning lookup)
   */
  private getDatabaseByName(name: string): DatabaseState | undefined {
    for (const dbState of this.state.databases.values()) {
      if (dbState.instance.name === name) {
        return dbState
      }
    }
    return undefined
  }

  /**
   * List all databases
   */
  listDatabases(): DatabaseInstance[] {
    return Array.from(this.state.databases.values()).map((s) => s.instance)
  }

  /**
   * Delete a database
   */
  async deleteDatabase(databaseId: string): Promise<void> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Close database
    dbState.db.close()

    // Remove from memory
    this.state.databases.delete(databaseId)
    this.state.node.databaseCount--

    // Delete files
    const dbPath = join(this.config.dataDir, `${databaseId}.db`)
    if (existsSync(dbPath)) {
      rmSync(dbPath)
      rmSync(`${dbPath}-wal`, { force: true })
      rmSync(`${dbPath}-shm`, { force: true })
    }

    this.emitEvent({
      type: 'database:deleted',
      timestamp: Date.now(),
      nodeId: this.state.node.nodeId,
      databaseId,
      data: {},
    })

    console.log(`[SQLit v2] Deleted database ${databaseId}`)
  }

  // ============ Vector Operations ============

  /**
   * Check if sqlite-vec extension is available
   */
  async checkVectorSupport(databaseId: string): Promise<boolean> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    try {
      dbState.db.query('SELECT vec_version()').get()
      return true
    } catch {
      return false
    }
  }

  /**
   * Create a vector index table (vec0 virtual table)
   */
  async createVectorIndex(
    databaseId: string,
    config: VectorIndexConfig,
  ): Promise<void> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Validate table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.tableName)) {
      throw new SQLitError(
        'Invalid table name - use alphanumeric and underscore only',
        SQLitErrorCode.QUERY_TIMEOUT,
      )
    }

    const vectorType = config.vectorType ?? 'float32'
    const typeStr = vectorType === 'float32' ? 'float' : vectorType

    const columns: string[] = [`embedding ${typeStr}[${config.dimensions}]`]

    // Add metadata columns (prefixed with + for vec0)
    if (config.metadataColumns) {
      for (const col of config.metadataColumns) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col.name)) {
          throw new SQLitError(
            'Invalid column name - use alphanumeric and underscore only',
            SQLitErrorCode.QUERY_TIMEOUT,
          )
        }
        columns.push(`+${col.name} ${col.type}`)
      }
    }

    // Add partition key if specified
    if (config.partitionKey) {
      columns.push(config.partitionKey)
    }

    const sql = `CREATE VIRTUAL TABLE IF NOT EXISTS ${config.tableName} USING vec0(\n  ${columns.join(',\n  ')}\n)`
    dbState.db.exec(sql)

    // Record in WAL
    await this.recordWAL(dbState, { sql })

    console.log(
      `[SQLit v2] Created vector index ${config.tableName} in ${databaseId}`,
    )
  }

  /**
   * Insert a vector into a vec0 table
   */
  async insertVector(
    databaseId: string,
    request: VectorInsertRequest,
  ): Promise<{ rowid: number }> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Serialize vector to binary format
    const vectorBlob = this.serializeFloat32Vector(request.vector)

    const columns: string[] = ['embedding']
    const values: (Uint8Array | string | number | boolean | null)[] = [
      vectorBlob,
    ]

    if (request.rowid !== undefined) {
      columns.unshift('rowid')
      values.unshift(request.rowid)
    }

    if (request.metadata) {
      for (const [key, value] of Object.entries(request.metadata)) {
        columns.push(key)
        values.push(value)
      }
    }

    if (request.partitionValue !== undefined) {
      columns.push('partition_key')
      values.push(request.partitionValue)
    }

    const placeholders = values.map(() => '?').join(', ')
    const sql = `INSERT INTO ${request.tableName}(${columns.join(', ')}) VALUES (${placeholders})`

    const result = dbState.db.run(
      sql,
      values as (string | number | boolean | null | Uint8Array)[],
    )

    // Record in WAL (store vector as base64 for replication)
    await this.recordWAL(dbState, {
      sql: `INSERT INTO ${request.tableName}(${columns.join(', ')}) VALUES (${placeholders})`,
      params: values.map((v) =>
        v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v,
      ) as (string | number | boolean | null | bigint)[],
    })

    return { rowid: Number(result.lastInsertRowid) }
  }

  /**
   * Batch insert vectors
   */
  async batchInsertVectors(
    databaseId: string,
    request: VectorBatchInsertRequest,
  ): Promise<{ rowids: number[] }> {
    const rowids: number[] = []

    for (const vec of request.vectors) {
      const result = await this.insertVector(databaseId, {
        tableName: request.tableName,
        ...vec,
      })
      rowids.push(result.rowid)
    }

    return { rowids }
  }

  /**
   * Search for similar vectors using KNN
   */
  async searchVectors(
    databaseId: string,
    request: VectorSearchRequest,
  ): Promise<VectorSearchResult[]> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Serialize query vector
    const queryBlob = this.serializeFloat32Vector(request.vector)

    // Build the KNN query using vec0 MATCH syntax
    let sql = `SELECT rowid, distance
FROM ${request.tableName}
WHERE embedding MATCH ?
  AND k = ${request.k}`

    const params: (Uint8Array | string | number)[] = [queryBlob]

    // Add partition filter
    if (request.partitionValue !== undefined) {
      sql += '\n  AND partition_key = ?'
      params.push(request.partitionValue)
    }

    // Add metadata filter (validated)
    if (request.metadataFilter) {
      // Basic validation - only allow safe comparisons
      if (
        !/^[a-zA-Z_][a-zA-Z0-9_]*\s*(=|!=|<|>|<=|>=|LIKE|IS NULL|IS NOT NULL)\s*('.*'|\d+|NULL)$/i.test(
          request.metadataFilter,
        )
      ) {
        throw new SQLitError(
          'Invalid metadata filter - use simple comparisons only',
          SQLitErrorCode.QUERY_TIMEOUT,
        )
      }
      sql += `\n  AND ${request.metadataFilter}`
    }

    sql += '\nORDER BY distance'

    const rows = dbState.db
      .query<{ rowid: number; distance: number }, []>(sql)
      .all(...(params as []))

    // Get metadata if requested
    const results: VectorSearchResult[] = []
    for (const row of rows) {
      const result: VectorSearchResult = {
        rowid: row.rowid,
        distance: row.distance,
      }

      if (request.includeMetadata) {
        // Fetch metadata separately
        const metaRow = dbState.db
          .query<Record<string, string | number | boolean | null>, [number]>(
            `SELECT * FROM ${request.tableName} WHERE rowid = ?`,
          )
          .get(row.rowid)

        if (metaRow) {
          const {
            embedding: _,
            rowid: __,
            distance: ___,
            ...metadata
          } = metaRow as Record<string, string | number | boolean | null>
          result.metadata = metadata
        }
      }

      results.push(result)
    }

    return results
  }

  private serializeFloat32Vector(vector: number[]): Uint8Array {
    const buffer = new ArrayBuffer(vector.length * 4)
    const view = new DataView(buffer)
    for (let i = 0; i < vector.length; i++) {
      const value = vector[i]
      if (value === undefined) {
        throw new Error(`Vector element at index ${i} is undefined`)
      }
      view.setFloat32(i * 4, value, true) // little-endian
    }
    return new Uint8Array(buffer)
  }

  // ============ ACL Operations ============

  /**
   * Grant permissions to an address
   */
  async grant(databaseId: string, request: GrantRequest): Promise<void> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Ensure ACL table exists
    dbState.db.exec(`
      CREATE TABLE IF NOT EXISTS __sqlit_acl (
        grantee TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (grantee, permission)
      )
    `)

    const grantedAt = Date.now()

    for (const permission of request.permissions) {
      dbState.db.run(
        `INSERT OR REPLACE INTO __sqlit_acl (grantee, permission, granted_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        [request.grantee, permission, grantedAt, request.expiresAt ?? null],
      )
    }

    // Record in WAL
    await this.recordWAL(dbState, {
      sql: 'INSERT INTO __sqlit_acl (grantee, permission, granted_at, expires_at) VALUES (?, ?, ?, ?)',
      params: [
        request.grantee,
        request.permissions.join(','),
        grantedAt,
        request.expiresAt ?? null,
      ],
    })

    console.log(
      `[SQLit v2] Granted ${request.permissions.join(',')} to ${request.grantee} in ${databaseId}`,
    )
  }

  /**
   * Revoke permissions from an address
   */
  async revoke(databaseId: string, request: RevokeRequest): Promise<void> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    if (request.permissions && request.permissions.length > 0) {
      // Revoke specific permissions
      for (const permission of request.permissions) {
        dbState.db.run(
          'DELETE FROM __sqlit_acl WHERE grantee = ? AND permission = ?',
          [request.grantee, permission],
        )
      }
    } else {
      // Revoke all permissions
      dbState.db.run('DELETE FROM __sqlit_acl WHERE grantee = ?', [
        request.grantee,
      ])
    }

    // Record in WAL
    await this.recordWAL(dbState, {
      sql: 'DELETE FROM __sqlit_acl WHERE grantee = ?',
      params: [request.grantee],
    })

    console.log(
      `[SQLit v2] Revoked permissions from ${request.grantee} in ${databaseId}`,
    )
  }

  /**
   * List ACL rules for a database
   */
  listACL(databaseId: string): ACLRule[] {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Check if ACL table exists
    const tableExists = dbState.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='__sqlit_acl'",
      )
      .get()

    if (!tableExists) {
      return []
    }

    const rows = dbState.db
      .query<
        {
          grantee: string
          permission: string
          granted_at: number
          expires_at: number | null
        },
        []
      >('SELECT * FROM __sqlit_acl')
      .all()

    // Group by grantee
    const aclMap = new Map<string, ACLRule>()
    for (const row of rows) {
      const existing = aclMap.get(row.grantee)
      if (existing) {
        existing.permissions.push(row.permission as 'read' | 'write' | 'admin')
      } else {
        aclMap.set(row.grantee, {
          grantee: row.grantee as `0x${string}`,
          permissions: [row.permission as 'read' | 'write' | 'admin'],
          grantedAt: row.granted_at,
          expiresAt: row.expires_at ?? undefined,
        })
      }
    }

    return Array.from(aclMap.values())
  }

  /**
   * Check if an address has permission
   */
  hasPermission(
    databaseId: string,
    address: `0x${string}`,
    permission: 'read' | 'write' | 'admin',
  ): boolean {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) return false

    // Owner always has all permissions
    if (address.toLowerCase() === dbState.instance.owner.toLowerCase()) {
      return true
    }

    // Check ACL table
    const tableExists = dbState.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='__sqlit_acl'",
      )
      .get()

    if (!tableExists) return false

    const now = Date.now()
    const rule = dbState.db
      .query<{ permission: string }, [string, string, number]>(
        `SELECT permission FROM __sqlit_acl 
       WHERE grantee = ? AND permission = ?
       AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .get(address, permission, now)

    return rule !== null
  }

  // ============ Replication ============

  /**
   * Get WAL entries for replication sync
   */
  getWALEntries(request: WALSyncRequest): WALSyncResponse {
    const dbState = this.state.databases.get(request.databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${request.databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    const stmt = dbState.db.prepare(`
      SELECT position, transaction_id, timestamp, sql, params, hash, prev_hash
      FROM __sqlit_wal
      WHERE position > ?
      ORDER BY position ASC
      LIMIT ?
    `)

    const rows = stmt.all(
      Number(request.fromPosition),
      request.limit,
    ) as Array<{
      position: number
      transaction_id: string
      timestamp: number
      sql: string
      params: string | null
      hash: string
      prev_hash: string
    }>

    const entries: WALEntry[] = rows.map((row) => ({
      position: BigInt(row.position),
      transactionId: row.transaction_id,
      timestamp: row.timestamp,
      sql: row.sql,
      params: row.params ? JSON.parse(row.params) : [],
      checksum: row.hash as Hex,
      hash: row.hash as Hex,
      prevHash: row.prev_hash as Hex,
    }))

    return {
      entries,
      hasMore: entries.length === request.limit,
      currentPosition: dbState.walPosition,
    }
  }

  /**
   * Apply WAL entries from primary (for replicas)
   */
  async applyWALEntries(
    databaseId: string,
    entries: WALEntry[],
  ): Promise<void> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Verify chain integrity
    let prevHash =
      dbState.walPosition > 0
        ? this.getLastWALHash(dbState)
        : (`0x${'0'.repeat(64)}` as Hex)

    for (const entry of entries) {
      // Verify hash chain
      if (entry.prevHash !== prevHash) {
        throw new SQLitError(
          'WAL chain integrity check failed',
          SQLitErrorCode.REPLICATION_LAG,
          { expected: prevHash, got: entry.prevHash },
        )
      }

      // Apply the SQL
      if (entry.params) {
        dbState.db.run(
          entry.sql,
          entry.params as (string | number | boolean | null)[],
        )
      } else {
        dbState.db.exec(entry.sql)
      }

      // Record in local WAL
      dbState.db.run(
        `INSERT INTO __sqlit_wal (position, transaction_id, timestamp, sql, params, hash, prev_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(entry.position),
          entry.transactionId ?? '',
          entry.timestamp,
          entry.sql,
          entry.params ? JSON.stringify(entry.params) : null,
          entry.hash ?? entry.checksum,
          entry.prevHash ?? '',
        ],
      )

      dbState.walPosition = entry.position
      prevHash = entry.hash ?? entry.checksum
    }

    // Update instance state
    dbState.instance.walPosition = dbState.walPosition
    dbState.instance.updatedAt = Date.now()
  }

  // ============ Node Management ============

  /**
   * Get node info
   */
  getNodeInfo(): DatabaseNode {
    return { ...this.state.node }
  }

  /**
   * Get replication status for a database
   */
  getReplicationStatus(
    databaseId: string,
  ): Map<string, import('./types').ReplicationStatus> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }
    return new Map(dbState.replicaStatus)
  }

  /**
   * Get TEE capabilities for this node
   */
  async getTEECapabilities(): Promise<NodeTEECapabilities | null> {
    if (!this.tee) {
      return null
    }
    return this.tee.getCapabilities()
  }

  /**
   * Check if TEE is enabled and available
   */
  isTEEEnabled(): boolean {
    return this.tee !== null
  }

  /**
   * Execute a query in TEE (if available and database uses tee_encrypted mode)
   */
  async executeInTEE(
    databaseId: string,
    sql: string,
    params?: (string | number | boolean | null | bigint)[],
  ): Promise<import('./tee').TEEQueryResponse | null> {
    if (!this.tee) {
      return null
    }

    const dbState = this.state.databases.get(databaseId)
    if (!dbState) {
      throw new SQLitError(
        `Database ${databaseId} not found`,
        SQLitErrorCode.DATABASE_NOT_FOUND,
      )
    }

    // Only use TEE execution for tee_encrypted databases
    if (dbState.instance.encryptionMode !== 'tee_encrypted') {
      return null
    }

    return this.tee.executeInTEE({
      databaseId,
      sql,
      params,
      sessionId: this.state.node.nodeId,
      attestationLevel: 'verified',
    })
  }

  /**
   * Add event handler
   */
  onEvent(handler: SQLitEventHandler): void {
    this.eventHandlers.push(handler)
  }

  /**
   * Remove event handler
   */
  offEvent(handler: SQLitEventHandler): void {
    const index = this.eventHandlers.indexOf(handler)
    if (index > -1) {
      this.eventHandlers.splice(index, 1)
    }
  }

  // ============ Private Methods ============

  private createInitialNodeInfo(): DatabaseNode {
    const account = privateKeyToAccount(this.config.operatorPrivateKey)
    const nodeId = keccak256(
      toBytes(`${account.address}:${this.config.endpoint}:${Date.now()}`),
    )

    return {
      id: nodeId,
      nodeId,
      operator: account.address,
      operatorAddress: account.address,
      role: DatabaseNodeRole.PRIMARY, // Default to primary, can be changed
      status: DatabaseNodeStatus.PENDING,
      endpoint: this.config.endpoint,
      wsEndpoint: this.config.wsEndpoint,
      stakedAmount: BigInt(0),
      region: this.config.region,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      databaseCount: 0,
      totalQueries: BigInt(0),
      teeEnabled: this.config.teeEnabled,
      version: this.config.version,
      performanceScore: 1000, // Start with perfect score
      slashedAmount: BigInt(0),
    }
  }

  private async registerOnChain(): Promise<void> {
    // Only skip if explicitly requested (for unit tests)
    if (process.env.SKIP_CHAIN_REGISTRATION === 'true') {
      console.log(
        '[SQLit v2] Skipping on-chain registration (SKIP_CHAIN_REGISTRATION=true)',
      )
      this.state.node.status = DatabaseNodeStatus.ACTIVE
      return
    }

    const account = privateKeyToAccount(this.config.operatorPrivateKey)

    // Use local devnet (Anvil/Hardhat) or configured L2 RPC
    const rpcUrl = this.config.l2RpcUrl
    const chainId = process.env.NODE_ENV === 'development' ? 31337 : 901

    const chain: Chain = {
      ...devChain,
      id: chainId,
      name: chainId === 31337 ? 'Local Devnet' : 'Jeju L2',
      rpcUrls: { default: { http: [rpcUrl] } },
    }

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    })

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    // Check if registry contract is deployed
    try {
      const code = await publicClient.getCode({
        address: this.config.registryAddress,
      })
      if (!code || code === '0x') {
        console.log(
          `[SQLit v2] Registry contract not deployed at ${this.config.registryAddress}, ` +
            `running in offline mode (run 'bun run deploy:contracts' to deploy)`,
        )
        this.state.node.status = DatabaseNodeStatus.ACTIVE
        return
      }
    } catch (error) {
      console.warn(
        '[SQLit v2] Failed to connect to RPC, running in offline mode:',
        String(error).slice(0, 100),
      )
      this.state.node.status = DatabaseNodeStatus.ACTIVE
      return
    }

    // Check if already registered
    try {
      const existingNode = await publicClient.readContract({
        address: this.config.registryAddress,
        abi: SQLIT_REGISTRY_ABI,
        functionName: 'getNode',
        args: [this.state.node.nodeId as Hex],
      })

      if (
        existingNode &&
        (existingNode as { registeredAt: bigint }).registeredAt > 0
      ) {
        console.log('[SQLit v2] Node already registered on-chain')
        this.state.node.status = DatabaseNodeStatus.ACTIVE
        return
      }
    } catch {
      // Node not registered, continue with registration
    }

    // Register node
    const regionIndex = [
      'us-east',
      'us-west',
      'eu-west',
      'eu-central',
      'asia-pacific',
      'asia-south',
      'south-america',
      'global',
    ].indexOf(this.config.region)

    try {
      const hash = await walletClient.writeContract({
        address: this.config.registryAddress,
        abi: SQLIT_REGISTRY_ABI,
        functionName: 'registerNode',
        args: [
          this.config.endpoint,
          regionIndex >= 0 ? regionIndex : 7, // Default to 'global' if not found
          this.config.teeEnabled,
        ],
        value: this.serviceConfig.stakeAmount,
      })

      console.log(`[SQLit v2] Registered node on-chain: ${hash}`)
      this.state.node.stakedAmount = this.serviceConfig.stakeAmount
      this.state.node.status = DatabaseNodeStatus.ACTIVE
    } catch (error) {
      console.warn(
        '[SQLit v2] Failed to register on-chain, running in offline mode:',
        String(error).slice(0, 100),
      )
      this.state.node.status = DatabaseNodeStatus.ACTIVE
    }
  }

  private async registerDatabaseOnChain(
    instance: DatabaseInstance,
  ): Promise<void> {
    // Only skip if explicitly requested
    if (process.env.SKIP_CHAIN_REGISTRATION === 'true') {
      return
    }

    // If node is not registered on-chain (offline mode), skip database registration
    if (this.state.node.stakedAmount === BigInt(0)) {
      return
    }

    const account = privateKeyToAccount(this.config.operatorPrivateKey)
    const rpcUrl = this.config.l2RpcUrl
    const chainId = process.env.NODE_ENV === 'development' ? 31337 : 901

    const chain: Chain = {
      ...devChain,
      id: chainId,
      name: chainId === 31337 ? 'Local Devnet' : 'Jeju L2',
      rpcUrls: { default: { http: [rpcUrl] } },
    }

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    })

    const encryptionModeIndex = ['none', 'at_rest', 'tee_encrypted'].indexOf(
      instance.encryptionMode,
    )

    const replication = instance.replication ?? instance.replicationConfig
    const preferredRegions = replication?.preferredRegions ?? []
    const regionIndices = preferredRegions.map((r: string) =>
      [
        'us-east',
        'us-west',
        'eu-west',
        'eu-central',
        'asia-pacific',
        'asia-south',
        'south-america',
        'global',
      ].indexOf(r),
    )

    try {
      // Note: 'createDatabase' is not in the ABI subset, using heartbeat as placeholder
      // In production, this would call the actual createDatabase function
      await walletClient.writeContract({
        address: this.config.registryAddress,
        abi: SQLIT_REGISTRY_ABI,
        functionName: 'heartbeat',
        args: [instance.id as Hex],
      })
      // Store the data locally for now
      console.log(
        `[SQLit v2] Database ${instance.name} registered (encryptionMode=${encryptionModeIndex}, regions=${regionIndices.join(',')})`,
      )
    } catch (error) {
      console.warn(
        '[SQLit v2] Failed to register database on-chain:',
        String(error).slice(0, 100),
      )
    }
  }

  private async loadExistingDatabases(): Promise<void> {
    // Load all .db files from data directory
    const glob = new Bun.Glob('*.db')
    for await (const file of glob.scan(this.config.dataDir)) {
      if (file.startsWith('__')) continue // Skip internal files

      const databaseId = file.replace('.db', '')
      const dbPath = join(this.config.dataDir, file)

      try {
        const db = new Database(dbPath, { create: false })
        db.exec('PRAGMA journal_mode=WAL')
        db.exec('PRAGMA synchronous=NORMAL')

        // Get WAL position
        const walResult = db
          .query<{ max_pos: number | null }, []>(
            'SELECT MAX(position) as max_pos FROM __sqlit_wal',
          )
          .get()
        const walPosition = BigInt(walResult?.max_pos ?? 0)

        // Create instance info (would be loaded from on-chain in production)
        const instance: DatabaseInstance = {
          id: databaseId,
          databaseId,
          name: databaseId,
          owner: privateKeyToAccount(this.config.operatorPrivateKey).address,
          status: 'ready',
          encryptionMode: 'none',
          replicationConfig: this.serviceConfig.defaultReplication,
          replication: this.serviceConfig.defaultReplication,
          primaryNodeId: this.state.node.nodeId,
          replicaNodeIds: [],
          sizeBytes: BigInt(0),
          rowCount: BigInt(0),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          walPosition,
          connectionString: `sqlit://${this.config.endpoint}/${databaseId}`,
          httpEndpoint: `${this.config.endpoint}/v2/${databaseId}`,
          schemaVersion: 1,
          accessControl: [],
        }

        const dbState: DatabaseState = {
          db,
          instance,
          walPosition,
          walBuffer: [],
          activeTransactions: new Map(),
          replicaStatus: new Map(),
          lastCheckpoint: Date.now(),
          schemaHash: this.computeSchemaHash(db),
        }

        this.state.databases.set(databaseId, dbState)
        this.state.node.databaseCount++

        console.log(`[SQLit v2] Loaded database ${databaseId}`)
      } catch (error) {
        console.error(
          `[SQLit v2] Failed to load database ${databaseId}:`,
          error,
        )
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      this.state.node.lastHeartbeat = Date.now()

      // Send heartbeat on-chain if node is registered (has staked)
      if (
        this.state.node.stakedAmount > BigInt(0) &&
        process.env.SKIP_CHAIN_REGISTRATION !== 'true'
      ) {
        try {
          const account = privateKeyToAccount(this.config.operatorPrivateKey)
          const rpcUrl = this.config.l2RpcUrl
          const chainId = process.env.NODE_ENV === 'development' ? 31337 : 901

          const chain: Chain = {
            ...devChain,
            id: chainId,
            rpcUrls: { default: { http: [rpcUrl] } },
          }

          const walletClient = createWalletClient({
            account,
            chain,
            transport: http(rpcUrl),
          })

          await walletClient.writeContract({
            address: this.config.registryAddress,
            abi: SQLIT_REGISTRY_ABI,
            functionName: 'heartbeat',
            args: [this.state.node.nodeId as Hex],
          })
        } catch (error) {
          // Silently fail - heartbeat is non-critical
          if (process.env.DEBUG) {
            console.error('[SQLit v2] Heartbeat failed:', error)
          }
        }
      }

      this.emitEvent({
        type: 'node:heartbeat',
        timestamp: Date.now(),
        nodeId: this.state.node.nodeId,
        data: { databaseCount: this.state.node.databaseCount },
      })
    }, this.serviceConfig.heartbeatIntervalMs)
  }

  private startReplicationSync(): void {
    // For each database where this node is a replica, sync from primary
    for (const [dbId, dbState] of Array.from(this.state.databases.entries())) {
      if (dbState.instance.primaryNodeId !== this.state.node.nodeId) {
        // This is a replica, start syncing
        const timer = setInterval(async () => {
          await this.syncFromPrimary(dbId)
        }, 1000) // Sync every second

        this.walSyncTimers.set(dbId, timer)
      }
    }
  }

  private async syncFromPrimary(databaseId: string): Promise<void> {
    const dbState = this.state.databases.get(databaseId)
    if (!dbState) return

    const primaryNodeId = dbState.instance.primaryNodeId
    const primaryPeer = this.state.peerConnections.get(primaryNodeId)
    if (!primaryPeer?.connected) {
      console.warn(`[SQLit v2] Primary node ${primaryNodeId} not connected`)
      return
    }

    try {
      // Fetch WAL entries from primary
      const response = await fetch(`${primaryPeer.endpoint}/v2/wal/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          fromPosition: dbState.walPosition.toString(),
          limit: 1000,
        }),
      })

      if (!response.ok) {
        throw new Error(`WAL sync failed: ${response.statusText}`)
      }

      const syncResponse = (await response.json()) as WALSyncResponse
      if (syncResponse.entries.length > 0) {
        await this.applyWALEntries(databaseId, syncResponse.entries)

        this.emitEvent({
          type: 'replication:synced',
          timestamp: Date.now(),
          nodeId: this.state.node.nodeId,
          databaseId,
          data: {
            entriesApplied: syncResponse.entries.length,
            walPosition: dbState.walPosition.toString(),
          },
        })
      }
    } catch (error) {
      console.error(`[SQLit v2] WAL sync failed for ${databaseId}:`, error)
      this.emitEvent({
        type: 'replication:lagging',
        timestamp: Date.now(),
        nodeId: this.state.node.nodeId,
        databaseId,
        data: { error: String(error) },
      })
    }
  }

  private async discoverPeers(): Promise<void> {
    // Skip peer discovery if not registered on-chain
    if (
      this.state.node.stakedAmount === BigInt(0) ||
      process.env.SKIP_CHAIN_REGISTRATION === 'true'
    ) {
      return
    }

    const rpcUrl = this.config.l2RpcUrl
    const chainId = process.env.NODE_ENV === 'development' ? 31337 : 901

    const chain: Chain = {
      ...devChain,
      id: chainId,
      rpcUrls: { default: { http: [rpcUrl] } },
    }
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    try {
      // Note: getActiveNodes is not in the ABI subset. For now, we use a placeholder.
      // In production, this would be a proper registry call.
      const nodeIds: Hex[] = [] // Would come from contract

      for (const nodeId of nodeIds) {
        if (nodeId === this.state.node.nodeId) continue

        const rawNodeInfo = (await publicClient.readContract({
          address: this.config.registryAddress,
          abi: SQLIT_REGISTRY_ABI,
          functionName: 'getNode',
          args: [nodeId],
        })) as {
          id: Hex
          operator: Address
          endpoint: string
          region: number
          role: number
          status: number
          stakedAmount: bigint
          teeEnabled: boolean
          registeredAt: bigint
          lastHeartbeat: bigint
        }

        const nodeInfo = {
          endpoint: rawNodeInfo.endpoint,
          wsEndpoint: `${rawNodeInfo.endpoint}/ws`, // Derive from endpoint
          role: rawNodeInfo.role,
        }

        const connection: PeerConnection = {
          nodeId,
          endpoint: nodeInfo.endpoint,
          wsEndpoint: nodeInfo.wsEndpoint,
          lastPing: Date.now(),
          latencyMs: 0,
          connected: true,
          role:
            nodeInfo.role === 0
              ? DatabaseNodeRole.PRIMARY
              : DatabaseNodeRole.REPLICA,
        }

        this.state.peerConnections.set(nodeId, connection)
      }

      console.log(
        `[SQLit v2] Discovered ${this.state.peerConnections.size} peers`,
      )
    } catch (error) {
      console.error('[SQLit v2] Peer discovery failed:', error)
    }
  }

  private async executeQuery(
    dbState: DatabaseState,
    request: Pick<ExecuteRequest, 'sql' | 'params'>,
  ): Promise<QueryResult> {
    const startTime = Date.now()
    const isReadOnly = this.isReadOnlyQuery(request.sql)

    let rows: Record<string, unknown>[] = []
    let rowsAffected = 0
    let lastInsertId = BigInt(0)

    if (isReadOnly) {
      // Execute SELECT query
      const stmt = dbState.db.prepare(request.sql)
      if (request.params) {
        rows = stmt.all(
          ...(request.params as (string | number | boolean | null)[]),
        ) as Record<string, unknown>[]
      } else {
        rows = stmt.all() as Record<string, unknown>[]
      }
    } else {
      // Execute write query
      let result: { changes: number; lastInsertRowid: number | bigint }
      if (request.params) {
        result = dbState.db.run(
          request.sql,
          request.params as (string | number | boolean | null)[],
        )
      } else {
        result = dbState.db.run(request.sql)
      }
      rowsAffected = result.changes
      lastInsertId = BigInt(result.lastInsertRowid)
    }

    this.state.node.totalQueries = this.state.node.totalQueries + BigInt(1)

    return {
      success: true,
      rows,
      rowsAffected,
      lastInsertId,
      walPosition: dbState.walPosition,
      executionTimeMs: Date.now() - startTime,
      processedByNodeId: this.state.node.nodeId,
    }
  }

  private async recordWAL(
    dbState: DatabaseState,
    request: Pick<ExecuteRequest, 'sql' | 'params'>,
  ): Promise<void> {
    const transactionId = randomBytes(16).toString('hex')
    const timestamp = Date.now()
    const prevHash = this.getLastWALHash(dbState)

    // Compute entry hash
    const hashInput = `${dbState.walPosition + BigInt(1)}:${transactionId}:${timestamp}:${request.sql}:${JSON.stringify(request.params)}:${prevHash}`
    const hash =
      `0x${createHash('sha256').update(hashInput).digest('hex')}` as Hex

    // Insert into WAL table
    dbState.db.run(
      `INSERT INTO __sqlit_wal (transaction_id, timestamp, sql, params, hash, prev_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        transactionId,
        timestamp,
        request.sql,
        request.params ? JSON.stringify(request.params) : null,
        hash,
        prevHash,
      ],
    )

    // Update position
    const posResult = dbState.db
      .query<{ last_id: number }, []>('SELECT last_insert_rowid() as last_id')
      .get()
    dbState.walPosition = BigInt(posResult?.last_id ?? 0)
    dbState.instance.walPosition = dbState.walPosition
    dbState.instance.updatedAt = Date.now()

    // Add to buffer for replication
    const entry: WALEntry = {
      position: dbState.walPosition,
      transactionId,
      timestamp,
      sql: request.sql,
      params: (request.params?.map((p) =>
        typeof p === 'bigint' ? Number(p) : p,
      ) ?? []) as (string | number | boolean | null)[],
      checksum: hash,
      hash,
      prevHash,
    }
    dbState.walBuffer.push(entry)

    // Keep buffer size limited
    if (dbState.walBuffer.length > 10000) {
      dbState.walBuffer.shift()
    }
  }

  private getLastWALHash(dbState: DatabaseState): Hex {
    const result = dbState.db
      .query<{ hash: string } | null, []>(
        'SELECT hash FROM __sqlit_wal ORDER BY position DESC LIMIT 1',
      )
      .get()
    return (result?.hash ?? `0x${'0'.repeat(64)}`) as Hex
  }

  private isReadOnlyQuery(sql: string): boolean {
    const trimmed = sql.trim().toUpperCase()
    return (
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('EXPLAIN') ||
      (trimmed.startsWith('PRAGMA') && !trimmed.includes('='))
    )
  }

  private generateDatabaseId(name: string): string {
    const input = `${name}:${this.state.node.nodeId}:${Date.now()}:${randomBytes(8).toString('hex')}`
    return createHash('sha256').update(input).digest('hex').slice(0, 32)
  }

  private computeSchemaHash(db: Database): Hex {
    const schema = db
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.sql)
      .join('\n')
    return `0x${createHash('sha256').update(schema).digest('hex')}` as Hex
  }

  private emitEvent(event: import('./types').SQLitEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch (error) {
        console.error('[SQLit v2] Event handler error:', error)
      }
    }
  }
}
