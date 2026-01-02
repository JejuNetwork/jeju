/**
 * SQLit Database adapter for Subsquid processor
 *
 * Implements the Database interface from @subsquid/util-internal-processor-tools
 * to work with processor.run() while storing data in SQLit instead of PostgreSQL
 */

import { getSQLit, type QueryParam, type SQLitClient } from '@jejunetwork/db'
import { INDEX_DDL, SCHEMA_DDL } from './db/schema'

// Interface matching subsquid's FinalTxInfo
interface FinalTxInfo {
  prevHead: HashAndHeight
  nextHead: HashAndHeight
  isOnTop: boolean
}

interface HashAndHeight {
  height: number
  hash: string
}

interface DatabaseState {
  height: number
  hash: string
  top: HashAndHeight[]
}

// Entity class type
type EntityClass<E> = { new (...args: unknown[]): E; name?: string }

// Minimal Store interface for our use case
export interface SQLitStoreInterface {
  save<E>(entity: E | E[]): Promise<void>
  insert<E>(entity: E | E[]): Promise<void>
  upsert<E>(entity: E | E[]): Promise<void>
  remove<E>(entity: E | E[]): Promise<void>
  find<E>(entityClass: EntityClass<E>, options?: FindOptions): Promise<E[]>
  get<E>(entityClass: EntityClass<E>, id: string): Promise<E | undefined>
  count<E>(entityClass: EntityClass<E>, options?: FindOptions): Promise<number>
  flush(): Promise<void>
}

interface FindOptions {
  where?: Record<string, QueryParam>
  order?: Record<string, 'ASC' | 'DESC'>
  take?: number
}

// Status table for tracking processor progress
const STATUS_TABLE = '_squid_processor_status'

/**
 * SQLit Database adapter for Subsquid processor
 */
export class SQLitDatabase {
  private client: SQLitClient
  private databaseId: string
  readonly supportsHotBlocks = false

  constructor(options: { databaseId: string }) {
    this.client = getSQLit()
    this.databaseId = options.databaseId
  }

  /**
   * Connect to SQLit and return current state
   */
  async connect(): Promise<DatabaseState> {
    console.log(
      '[SQLitDatabase] Connecting to SQLit database:',
      this.databaseId,
    )

    // Initialize full schema (tables and indexes)
    await this.initializeSchema()

    // Ensure status table exists
    await this.ensureStatusTable()

    // Get current height
    const state = await this.getState()

    console.log('[SQLitDatabase] Connected, current height:', state.height)

    return state
  }

  /**
   * Process a batch of blocks in a transaction
   */
  async transact(
    info: FinalTxInfo,
    cb: (store: SQLitStoreInterface) => Promise<void>,
  ): Promise<void> {
    const store = new SQLitStore(this.client, this.databaseId)

    try {
      await cb(store)

      // Flush all pending writes
      await store.flush()

      // Update processor status
      await this.updateStatus(info.nextHead.height, info.nextHead.hash)

      console.log(`[SQLitDatabase] Processed to block ${info.nextHead.height}`)
    } catch (error) {
      console.error('[SQLitDatabase] Transaction failed:', error)
      throw error
    }
  }

  /**
   * Initialize full schema (all tables and indexes)
   * Drops and recreates tables if column count doesn't match
   */
  private async initializeSchema(): Promise<void> {
    console.log('[SQLitDatabase] Initializing schema...')

    // For each DDL, check if table needs recreation
    for (const ddl of SCHEMA_DDL) {
      // Extract table name from DDL
      const tableMatch = ddl.match(
        /CREATE TABLE IF NOT EXISTS "?([a-z_]+)"?\s*\(/i,
      )
      if (!tableMatch) continue
      const tableName = tableMatch[1]
      const quotedName = [
        'transaction',
        'log',
        'trace',
        'order',
        'index',
      ].includes(tableName)
        ? `"${tableName}"`
        : tableName

      // Count expected columns from DDL
      const columnMatches = ddl.match(/^\s+\w+\s+(?:TEXT|INTEGER|BLOB)/gim)
      const expectedColumns = columnMatches?.length || 0

      try {
        // Check existing table column count
        const result = await this.client.query<{ name: string }>(
          `PRAGMA table_info(${quotedName})`,
          [],
          this.databaseId,
        )
        const existingColumns = result.rows?.length || 0

        if (existingColumns > 0 && existingColumns !== expectedColumns) {
          // Table exists but has wrong number of columns - drop and recreate
          console.log(
            `[SQLitDatabase] Recreating ${tableName}: ${existingColumns} -> ${expectedColumns} columns`,
          )
          await this.client.exec(
            `DROP TABLE IF EXISTS ${quotedName}`,
            [],
            this.databaseId,
          )
        }

        // Create table
        await this.client.exec(ddl, [], this.databaseId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Ignore "table already exists" errors
        if (!message.includes('already exists')) {
          console.warn(
            `[SQLitDatabase] Schema DDL error for ${tableName}: ${message}`,
          )
        }
      }
    }

    // Create all indexes
    for (const idx of INDEX_DDL) {
      try {
        await this.client.exec(idx, [], this.databaseId)
      } catch {
        // Indexes are optional, ignore errors
      }
    }

    console.log('[SQLitDatabase] Schema initialized')
  }

  /**
   * Ensure status table exists with correct schema
   */
  private async ensureStatusTable(): Promise<void> {
    const expectedColumns = 5 // id, height, hash, updated_at, timestamp

    try {
      // Check if table exists and has correct columns
      const result = await this.client.query<{ name: string }>(
        `PRAGMA table_info("${STATUS_TABLE}")`,
        [],
        this.databaseId,
      )
      const existingColumns = result.rows?.length || 0

      if (existingColumns > 0 && existingColumns !== expectedColumns) {
        // Drop and recreate with correct schema
        console.log(
          `[SQLitDatabase] Recreating status table: ${existingColumns} -> ${expectedColumns} columns`,
        )
        await this.client.exec(
          `DROP TABLE IF EXISTS "${STATUS_TABLE}"`,
          [],
          this.databaseId,
        )
      }

      await this.client.exec(
        `
        CREATE TABLE IF NOT EXISTS "${STATUS_TABLE}" (
          id INTEGER PRIMARY KEY,
          height INTEGER NOT NULL,
          hash TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT '',
          timestamp TEXT NOT NULL DEFAULT ''
        )
        `,
        [],
        this.databaseId,
      )
    } catch (error) {
      console.warn('[SQLitDatabase] Failed to create status table:', error)
    }
  }

  /**
   * Get current processor state
   */
  private async getState(): Promise<DatabaseState> {
    try {
      const result = await this.client.query<{ height: number; hash: string }>(
        `SELECT height, hash FROM "${STATUS_TABLE}" WHERE id = 1 LIMIT 1`,
        [],
        this.databaseId,
      )

      if (result.rows.length > 0) {
        const { height, hash } = result.rows[0]
        return {
          height,
          hash,
          top: [{ height, hash }],
        }
      }
    } catch {
      // Table might not exist or be empty
    }

    // Return initial state
    return {
      height: -1,
      hash: '',
      top: [],
    }
  }

  /**
   * Update processor status
   */
  private async updateStatus(height: number, hash: string): Promise<void> {
    await this.client.exec(
      `
      INSERT INTO "${STATUS_TABLE}" (id, height, hash, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        height = excluded.height,
        hash = excluded.hash,
        updated_at = excluded.updated_at
      `,
      [height, hash, new Date().toISOString()],
      this.databaseId,
    )
  }
}

/**
 * SQLit Store implementation
 */
class SQLitStore implements SQLitStoreInterface {
  private client: SQLitClient
  private databaseId: string
  private pendingWrites: Map<string, Record<string, unknown>[]> = new Map()

  constructor(client: SQLitClient, databaseId: string) {
    this.client = client
    this.databaseId = databaseId
  }

  async save<E>(entity: E | E[]): Promise<void> {
    const entities = Array.isArray(entity) ? entity : [entity]
    if (entities.length === 0) return

    for (const e of entities) {
      const entityObj = e as Record<string, unknown>
      const entityCtor = entityObj.constructor as EntityClass<E>
      const tableName = this.getTableName(entityCtor)

      // Skip invalid entities (Object, unknown, etc.)
      if (!tableName) continue

      if (!this.pendingWrites.has(tableName)) {
        this.pendingWrites.set(tableName, [])
      }
      const pending = this.pendingWrites.get(tableName)
      if (pending) {
        pending.push(entityObj)
      }
    }
  }

  async insert<E>(entity: E | E[]): Promise<void> {
    return this.save(entity)
  }

  async upsert<E>(entity: E | E[]): Promise<void> {
    return this.save(entity)
  }

  async remove<E>(entity: E | E[]): Promise<void> {
    const entities = Array.isArray(entity) ? entity : [entity]
    if (entities.length === 0) return

    for (const e of entities) {
      const entityObj = e as Record<string, unknown>
      const entityCtor = entityObj.constructor as EntityClass<E>
      const tableName = this.getTableName(entityCtor)

      // Skip invalid entities
      if (!tableName) continue

      const id = entityObj.id as QueryParam

      await this.client.exec(
        `DELETE FROM "${tableName}" WHERE id = ?`,
        [id],
        this.databaseId,
      )
    }
  }

  async find<E>(
    entityClass: EntityClass<E>,
    options?: FindOptions,
  ): Promise<E[]> {
    const tableName = this.getTableName(entityClass)
    let sql = `SELECT * FROM "${tableName}"`
    const params: QueryParam[] = []

    if (options?.where) {
      const conditions: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`"${key}" = ?`)
        params.push(value)
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
    }

    if (options?.order) {
      const orderClauses: string[] = []
      for (const [key, direction] of Object.entries(options.order)) {
        orderClauses.push(`"${key}" ${direction}`)
      }
      if (orderClauses.length > 0) {
        sql += ` ORDER BY ${orderClauses.join(', ')}`
      }
    }

    if (options?.take) {
      sql += ` LIMIT ${options.take}`
    }

    const result = await this.client.query(sql, params, this.databaseId)
    return result.rows as E[]
  }

  async get<E>(
    entityClass: EntityClass<E>,
    id: string,
  ): Promise<E | undefined> {
    const tableName = this.getTableName(entityClass)
    const result = await this.client.query(
      `SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`,
      [id],
      this.databaseId,
    )
    return result.rows[0] as E | undefined
  }

  async count<E>(
    entityClass: EntityClass<E>,
    options?: FindOptions,
  ): Promise<number> {
    const tableName = this.getTableName(entityClass)
    let sql = `SELECT COUNT(*) as count FROM "${tableName}"`
    const params: QueryParam[] = []

    if (options?.where) {
      const conditions: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`"${key}" = ?`)
        params.push(value)
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
    }

    const result = await this.client.query<{ count: number }>(
      sql,
      params,
      this.databaseId,
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async flush(): Promise<void> {
    for (const [tableName, entities] of this.pendingWrites.entries()) {
      // Skip empty or invalid table names
      if (!tableName || entities.length === 0) continue
      await this.batchUpsert(tableName, entities)
    }
    this.pendingWrites.clear()
  }

  private async batchUpsert(
    tableName: string,
    entities: Record<string, unknown>[],
  ): Promise<void> {
    if (entities.length === 0) return

    // Convert camelCase to snake_case for database columns
    const toSnakeCase = (str: string): string =>
      str.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()

    // Helper to check if a value is an entity (FK reference)
    const isEntityRef = (val: unknown): val is { id: string } =>
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(val) &&
      !Buffer.isBuffer(val) &&
      !(val instanceof Uint8Array) &&
      !(val instanceof Date) &&
      'id' in val &&
      typeof (val as Record<string, unknown>).id === 'string'

    // Helper to check if a value is an array of entities (OneToMany)
    const isEntityArray = (val: unknown): boolean => {
      if (!Array.isArray(val)) return false
      if (val.length === 0) return false
      // Check first non-null item
      const first = val.find((v) => v !== null && v !== undefined)
      return first && isEntityRef(first)
    }

    // Helper to serialize primitive arrays (not entity arrays)
    const serializePrimitiveArray = (val: unknown[]): string => {
      return JSON.stringify(
        val.map((v) => (typeof v === 'bigint' ? v.toString() : v)),
      )
    }

    // Known FK columns by table name - based on TypeORM entity definitions
    // This handles the case where all FK values are null in the entities
    const KNOWN_FK_COLUMNS: Record<string, string[]> = {
      account: ['contract'],
      agent_ban_event: ['agent'],
      agent_feedback: ['agent', 'client'],
      agent_metadata: ['agent'],
      agent_profile: ['profileIPFS'],
      agent_slash_event: ['agent'],
      agent_stake_event: ['agent'],
      agent_validation: ['agent', 'validator'],
      anomaly_detection: ['target'],
      block: ['miner'],
      ceo_decision: ['proposal'],
      compute_ledger_balance: ['account'],
      compute_rental: ['renter', 'provider', 'resource'],
      compute_resource: ['provider'],
      container_image: [
        'uploadedBy',
        'storageProvider',
        'storageDeal',
        'verifiedBy',
      ],
      contest_result: ['resultsIPFS'],
      contract: ['creator', 'creationTransaction', 'creationBlock'],
      council_proposal: ['proposer'],
      council_vote: ['proposal', 'councilAgent'],
      cross_chain_voucher: ['request', 'xlp'],
      cross_chain_voucher_request: ['requester', 'voucher'],
      cross_network_attestation: ['federatedIdentity'],
      cross_service_request: [
        'requester',
        'containerImage',
        'sourceProvider',
        'destinationProvider',
        'destinationRental',
      ],
      decoded_event: ['address', 'block', 'transaction'],
      delegate: ['delegate'],
      delegation: ['delegator', 'delegate'],
      dex_pool: ['dex', 'token0', 'token1'],
      eil_transfer: ['user', 'xlp', 'request', 'voucher'],
      ens_mirror: ['owner'],
      ens_mirror_sync: ['mirror'],
      federated_entry: ['registry'],
      federated_network: ['contracts'],
      federated_network_contracts: ['network'],
      federated_registry: ['network'],
      feedback_response: ['feedback', 'responder'],
      governance_event: ['proposal'],
      inference_request: ['requester', 'provider'],
      ipfs_file: [
        'moderationReport',
        'teeAttestation',
        'nftMetadata',
        'agentProfile',
        'contestResult',
      ],
      jns_listing: ['name', 'seller', 'buyer'],
      jns_name: ['owner', 'linkedAgent', 'currentListing'],
      jns_renewal: ['name', 'renewer'],
      jns_resolver_record: ['name'],
      jns_reverse_record: ['name'],
      jns_transfer: ['name', 'from', 'to'],
      keepalive: ['owner'],
      keepalive_auto_fund: ['keepalive'],
      keepalive_health_check: ['keepalive'],
      keepalive_resource: ['keepalive'],
      log: ['address', 'block', 'transaction', 'decodedEvent'],
      market_position: ['market', 'trader'],
      market_trade: ['market', 'trader'],
      moderation_report: ['evidenceIPFS'],
      nft_approval_event: [
        'owner',
        'operator',
        'token',
        'block',
        'transaction',
      ],
      nft_metadata: ['metadataIPFS'],
      oif_attestation: ['intent', 'settlement'],
      oif_intent: ['user', 'solver', 'settlement', 'acceptedQuote'],
      oif_quote: ['solver'],
      oif_settlement: ['intent', 'solver', 'attestation'],
      oif_slash_event: ['solver'],
      oif_solver_liquidity: ['solver'],
      oracle_attestation: ['operator'],
      oracle_committee_member: ['feed', 'operator'],
      oracle_dispute: ['report', 'feed', 'disputer', 'challenger'],
      oracle_game: ['market'],
      oracle_report: ['feed', 'submittedBy', 'dispute'],
      oracle_subscription: ['subscriber'],
      pause_event: ['target', 'pauser'],
      performance_update: ['node'],
      perp_collateral_deposit: ['trader'],
      perp_collateral_withdrawal: ['trader'],
      perp_funding_payment: ['market', 'position', 'trader'],
      perp_liquidation: ['market', 'position', 'liquidator', 'trader'],
      perp_market_stats: ['market'],
      perp_position: ['market', 'trader'],
      perp_trade: ['market', 'position', 'trader'],
      pool_daily_candle: ['pool'],
      pool_hourly_candle: ['pool'],
      proposal_backer: ['proposal', 'backer'],
      protected_contract: ['target', 'pausedBy'],
      registered_agent: ['owner'],
      registry_stake: ['agent'],
      reward_claim: ['node'],
      safe_approval: ['execution', 'approver'],
      security_council_member: ['member'],
      storage_deal: ['user', 'provider'],
      storage_ledger_balance: ['user', 'provider'],
      swap: [
        'pool',
        'transaction',
        'sender',
        'recipient',
        'tokenIn',
        'tokenOut',
      ],
      tag_update: ['agent'],
      tee_attestation: ['attestationIPFS'],
      token: ['creator'],
      token_approval_event: [
        'owner',
        'spender',
        'token',
        'block',
        'transaction',
      ],
      token_balance: ['account', 'token'],
      token_candle: ['token'],
      token_transfer: [
        'from',
        'to',
        'operator',
        'token',
        'block',
        'transaction',
      ],
      trace: ['from', 'to', 'transaction'],
      transaction: ['from', 'to', 'block', 'contractAddress'],
      veto_vote: ['proposal', 'voter'],
      xlp_liquidity_deposit: ['xlp'],
      xlp_slash_event: ['xlp'],
    }

    // Known OneToMany columns (should be skipped)
    const KNOWN_SKIP_COLUMNS: Record<string, string[]> = {
      account: [
        'sentTransactions',
        'receivedTransactions',
        'tokenBalances',
        'createdContracts',
        'tokenTransfersFrom',
        'tokenTransfersTo',
      ],
      agent_feedback: ['responses'],
      block: ['transactions', 'logs'],
      compute_provider: ['resources', 'rentals', 'inferenceRequests'],
      compute_resource: ['rentals'],
      container_image: ['crossServiceRequests'],
      contract: ['tokenTransfers'],
      council_proposal: ['councilVotes', 'backers', 'vetoVotes'],
      delegate: ['delegations'],
      dex: ['pools'],
      dex_pool: ['swaps', 'hourlyCandles', 'dailyCandles'],
      ens_mirror: ['syncs'],
      federated_identity: ['attestations'],
      federated_network: ['registries'],
      federated_registry: ['entries'],
      governance_proposal: ['events'],
      jns_name: ['transfers', 'renewals', 'listings'],
      keepalive: ['resources', 'healthChecks'],
      node_stake: ['performanceUpdates', 'rewardClaims'],
      oif_solver: ['liquidity', 'fills', 'settlements', 'slashEvents'],
      oracle_feed: ['reports', 'disputes', 'committee'],
      oracle_operator: ['committees', 'attestations'],
      perp_market: ['positions', 'trades', 'liquidations', 'fundingPayments'],
      perp_position: ['trades', 'fundingPayments'],
      prediction_market: ['trades', 'positions'],
      registered_agent: [
        'metadataUpdates',
        'stakes',
        'tagUpdates',
        'banEvents',
        'slashEvents',
        'stakeEvents',
        'feedback',
        'validations',
      ],
      safe_execution: ['approvals'],
      storage_provider: ['deals'],
      token: ['pools0', 'pools1', 'swapsIn', 'swapsOut', 'candles'],
      transaction: ['logs', 'traces'],
      xlp: ['liquidityDeposits', 'vouchersIssued'],
    }

    const knownFks = new Set(KNOWN_FK_COLUMNS[tableName] ?? [])
    const knownSkips = new Set(KNOWN_SKIP_COLUMNS[tableName] ?? [])

    // Analyze columns across ALL entities to properly detect FK columns
    // This is important because a FK might be null in the first entity
    const rawColumns = new Set<string>()
    const fkColumns = new Set<string>()
    const skipColumns = new Set<string>()

    for (const entity of entities) {
      for (const [key, val] of Object.entries(entity)) {
        if (key === 'constructor' || key.startsWith('_')) continue

        rawColumns.add(key)

        // Skip known OneToMany relations
        if (knownSkips.has(key)) {
          skipColumns.add(key)
          continue
        }

        // Skip dynamically detected OneToMany relations (arrays of entities)
        if (isEntityArray(val)) {
          skipColumns.add(key)
          continue
        }

        // Detect FK columns (known or dynamically detected)
        if (knownFks.has(key) || isEntityRef(val)) {
          fkColumns.add(key)
        }
      }
    }

    // Filter out skip columns
    const columns: string[] = []
    const snakeCols: string[] = []

    for (const col of rawColumns) {
      if (skipColumns.has(col)) continue

      columns.push(col)
      if (fkColumns.has(col)) {
        snakeCols.push(`${toSnakeCase(col)}_id`)
      } else {
        snakeCols.push(toSnakeCase(col))
      }
    }

    if (columns.length === 0) {
      console.warn(`[SQLitStore] No columns found for ${tableName}`)
      return
    }

    const quotedCols = snakeCols.map((c) => `"${c}"`)
    const placeholders = columns.map(() => '?').join(', ')
    const values: QueryParam[] = []
    const valuesClauses: string[] = []

    for (const entity of entities) {
      valuesClauses.push(`(${placeholders})`)
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]
        const isFk = fkColumns.has(col)
        const val = entity[col]

        if (val === null || val === undefined) {
          values.push(null)
        } else if (isFk && isEntityRef(val)) {
          // FK reference - extract the id
          values.push(val.id)
        } else if (val instanceof Date) {
          values.push(val.toISOString())
        } else if (typeof val === 'bigint') {
          values.push(val.toString())
        } else if (Array.isArray(val)) {
          // Primitive array (not entity array - those are skipped)
          values.push(serializePrimitiveArray(val))
        } else if (
          typeof val === 'object' &&
          !Buffer.isBuffer(val) &&
          !(val instanceof Uint8Array)
        ) {
          // Complex object - serialize as JSON (handling BigInt)
          values.push(
            JSON.stringify(val, (_k, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          )
        } else if (
          typeof val === 'string' ||
          typeof val === 'number' ||
          typeof val === 'boolean'
        ) {
          values.push(val)
        } else if (val instanceof Uint8Array) {
          values.push(val)
        } else {
          // Fallback - stringify unknown types
          values.push(String(val))
        }
      }
    }

    const updateCols = snakeCols.filter((c) => c !== 'id')
    const updateSet =
      updateCols.length > 0
        ? updateCols.map((c) => `"${c}" = excluded."${c}"`).join(', ')
        : '"id" = excluded."id"' // Fallback if only id column

    const sql = `
      INSERT INTO "${tableName}" (${quotedCols.join(', ')})
      VALUES ${valuesClauses.join(', ')}
      ON CONFLICT (id) DO UPDATE SET ${updateSet}
    `.trim()

    try {
      await this.client.exec(sql, values, this.databaseId)
      console.log(`[SQLitStore] Saved ${entities.length} ${tableName} records`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      // Log and continue for column mismatches - don't fail the whole transaction
      if (
        errorMsg.includes('no column named') ||
        errorMsg.includes('table has no column')
      ) {
        console.warn(
          `[SQLitStore] Schema mismatch for ${tableName}: ${errorMsg}`,
        )
      } else {
        console.error(`[SQLitStore] Failed to save ${tableName}:`, error)
        throw error // Re-throw non-schema errors
      }
    }
  }

  private getTableName<E>(entityClass: EntityClass<E>): string {
    const name = entityClass.name ?? 'unknown'

    // Handle common base object cases that shouldn't be stored
    if (name === 'Object' || name === 'object' || name === 'unknown') {
      console.warn(
        `[SQLitStore] Skipping invalid entity with constructor name: ${name}`,
      )
      return '' // Return empty to signal skip
    }

    return name
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase()
  }
}
