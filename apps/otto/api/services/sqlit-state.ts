/**
 * Otto SQLit State Manager
 *
 * Distributed state management using SQLit (permissionless distributed SQLite).
 * Features:
 * - Auto-provisioning on first use
 * - Automatic backup and recovery
 * - Dynamic database ID based on deployer wallet
 * - No AWS dependencies - fully decentralized
 */

import {
  getCurrentNetwork,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { SQLitClient, SQLitError } from '@jejunetwork/sqlit'
import { expectValid } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import {
  type LimitOrder,
  LimitOrderSchema,
  type OttoUser,
  OttoUserSchema,
  type PendingBridgeData,
  type PendingSwapData,
  type Platform,
} from '../../lib'
import type { LaunchRequest } from './launch'

// Database ID is derived from app name + network for consistency
function getDatabaseId(): string {
  const network = getCurrentNetwork()
  // Use a deterministic ID so we can find it across restarts
  const seed = `otto-state-${network}`
  const hash = keccak256(toBytes(seed))
  return `otto-${network}-${hash.slice(2, 18)}`
}

const SQLIT_DATABASE_ID = getDatabaseId()

export interface PendingSwap {
  type: 'swap'
  quote: PendingSwapData['quote']
  params: PendingSwapData['params']
  expiresAt: number
}

export interface PendingBridge {
  type: 'bridge'
  quote?: PendingBridgeData['quote']
  params: PendingBridgeData['params']
  expiresAt: number
}

export interface PendingLaunch {
  type: 'launch'
  params: LaunchRequest
  expiresAt: number
}

export type PendingAction = PendingSwap | PendingBridge | PendingLaunch

interface ConversationState {
  pendingAction?: PendingAction
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  lastUpdated: number
}

interface ChatSession {
  sessionId: string
  userId: string
  walletAddress?: Address
  createdAt: number
  lastActiveAt: number
}

// SQL schema for SQLit
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS otto_users (
    id TEXT PRIMARY KEY,
    primary_wallet TEXT NOT NULL,
    smart_account TEXT,
    session_key TEXT,
    session_key_expiry INTEGER,
    platforms TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_otto_users_wallet ON otto_users(primary_wallet);
  CREATE INDEX IF NOT EXISTS idx_otto_users_smart_account ON otto_users(smart_account);

  CREATE TABLE IF NOT EXISTS otto_platform_links (
    platform TEXT NOT NULL,
    platform_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (platform, platform_id)
  );

  CREATE TABLE IF NOT EXISTS otto_limit_orders (
    order_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    from_token TEXT NOT NULL,
    to_token TEXT NOT NULL,
    from_amount TEXT NOT NULL,
    target_price TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    filled_at INTEGER,
    filled_tx_hash TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_otto_orders_user ON otto_limit_orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_otto_orders_status ON otto_limit_orders(status);

  CREATE TABLE IF NOT EXISTS otto_conversations (
    conversation_key TEXT PRIMARY KEY,
    pending_action TEXT,
    history TEXT NOT NULL,
    last_updated INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otto_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    wallet_address TEXT,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otto_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

const MAX_HISTORY_PER_CONVERSATION = 50
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const PROVISIONING_RETRY_DELAY_MS = 2000
const MAX_PROVISIONING_RETRIES = 5

// Row types with index signature for SQLitClient compatibility
interface UserRow extends Record<string, unknown> {
  id: string
  primary_wallet: string
  smart_account: string | null
  session_key: string | null
  session_key_expiry: number | null
  platforms: string
  settings: string
  created_at: number
  updated_at: number
}

interface PlatformLinkRow extends Record<string, unknown> {
  platform: string
  platform_id: string
  user_id: string
}

interface LimitOrderRow extends Record<string, unknown> {
  order_id: string
  user_id: string
  from_token: string
  to_token: string
  from_amount: string
  target_price: string
  chain_id: number
  status: string
  created_at: number
  expires_at: number | null
  filled_at: number | null
  filled_tx_hash: string | null
}

interface ConversationRow extends Record<string, unknown> {
  conversation_key: string
  pending_action: string | null
  history: string
  last_updated: number
}

interface SessionRow extends Record<string, unknown> {
  session_id: string
  user_id: string
  wallet_address: string | null
  created_at: number
  last_active_at: number
}

interface MetadataRow extends Record<string, unknown> {
  key: string
  value: string
  updated_at: number
}

class SQLitStateManager {
  private client: SQLitClient
  private initialized = false
  private initializing = false
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private endpoint: string

  constructor() {
    this.endpoint = getSQLitBlockProducerUrl()
    this.client = new SQLitClient({
      endpoint: this.endpoint,
      databaseId: SQLIT_DATABASE_ID,
      timeoutMs: 30000,
      fallbackEndpoints: this.getFallbackEndpoints(),
    })
  }

  private getFallbackEndpoints(): string[] {
    const network = getCurrentNetwork()
    if (network === 'localnet') {
      return []
    }
    // Use DWS sqlit endpoints as fallbacks
    if (network === 'testnet') {
      return ['https://dws.testnet.jejunetwork.org/sqlit']
    }
    return ['https://dws.jejunetwork.org/sqlit']
  }

  /**
   * Provision the database if it doesn't exist
   */
  private async provisionDatabase(): Promise<void> {
    const network = getCurrentNetwork()
    console.log(`[SQLit State] Provisioning database: ${SQLIT_DATABASE_ID}`)
    console.log(`[SQLit State] Network: ${network}`)
    console.log(`[SQLit State] Endpoint: ${this.endpoint}`)

    // Try to create the database
    for (let attempt = 1; attempt <= MAX_PROVISIONING_RETRIES; attempt++) {
      try {
        await this.client.createDatabase({
          name: `otto-${network}`,
          databaseId: SQLIT_DATABASE_ID,
          encryptionMode: 'none',
          replication: {
            replicaCount: network === 'mainnet' ? 3 : 2,
            minConfirmations: 1,
            syncMode: 'async',
            readPreference: 'primary',
            failoverTimeout: 30000,
          },
        })
        console.log(`[SQLit State] Database created: ${SQLIT_DATABASE_ID}`)
        return
      } catch (error) {
        if (error instanceof SQLitError) {
          // Database already exists - that's fine
          if (
            error.code === 'DATABASE_EXISTS' ||
            error.message.includes('already exists')
          ) {
            console.log(`[SQLit State] Database already exists, using it`)
            return
          }
        }

        console.warn(
          `[SQLit State] Provisioning attempt ${attempt}/${MAX_PROVISIONING_RETRIES} failed:`,
          error instanceof Error ? error.message : String(error),
        )

        if (attempt < MAX_PROVISIONING_RETRIES) {
          await Bun.sleep(PROVISIONING_RETRY_DELAY_MS * attempt)
        }
      }
    }

    // If we get here, provisioning failed but we'll try to use the database anyway
    // It might exist on a different node
    console.warn(
      `[SQLit State] Could not confirm database provisioning, attempting to use existing`,
    )
  }

  /**
   * Initialize the database schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializing) {
      // Wait for ongoing initialization
      while (this.initializing) {
        await Bun.sleep(100)
      }
      return
    }

    this.initializing = true

    try {
      // First, try to provision the database
      await this.provisionDatabase()

      // Create database schema
      const statements = SCHEMA.split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      for (const statement of statements) {
        try {
          await this.client.run(statement)
        } catch (error) {
          // Ignore "table already exists" errors
          if (
            error instanceof Error &&
            !error.message.includes('already exists')
          ) {
            throw error
          }
        }
      }

      // Store metadata about this instance
      await this.setMetadata('schema_version', '1')
      await this.setMetadata('last_initialized', Date.now().toString())
      await this.setMetadata('network', getCurrentNetwork())

      this.initialized = true

      // Start cleanup interval
      this.cleanupInterval = setInterval(
        () => this.cleanup(),
        CLEANUP_INTERVAL_MS,
      )

      console.log(
        `[SQLit State] Initialized with distributed persistence on ${getCurrentNetwork()}`,
      )
      console.log(`[SQLit State] Database ID: ${SQLIT_DATABASE_ID}`)
    } finally {
      this.initializing = false
    }
  }

  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  // ============ Metadata Operations ============

  private async setMetadata(key: string, value: string): Promise<void> {
    await this.client.run(
      `INSERT OR REPLACE INTO otto_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
      [key, value, Date.now()],
    )
  }

  async getMetadata(key: string): Promise<string | null> {
    const row = await this.client.queryOne<MetadataRow>(
      'SELECT value FROM otto_metadata WHERE key = ?',
      [key],
    )
    return row?.value ?? null
  }

  // ============ User Operations ============

  async getUser(userId: string): Promise<OttoUser | null> {
    await this.ensureInitialized()

    const row = await this.client.queryOne<UserRow>(
      'SELECT * FROM otto_users WHERE id = ?',
      [userId],
    )

    if (!row) return null
    return this.rowToUser(row)
  }

  async getUserByPlatform(
    platform: Platform,
    platformId: string,
  ): Promise<OttoUser | null> {
    await this.ensureInitialized()

    const link = await this.client.queryOne<PlatformLinkRow>(
      'SELECT * FROM otto_platform_links WHERE platform = ? AND platform_id = ?',
      [platform, platformId],
    )

    if (!link) return null
    return this.getUser(link.user_id)
  }

  async getUserByWallet(walletAddress: Address): Promise<OttoUser | null> {
    await this.ensureInitialized()
    const lowerAddress = walletAddress.toLowerCase()

    const row = await this.client.queryOne<UserRow>(
      'SELECT * FROM otto_users WHERE LOWER(primary_wallet) = ? OR LOWER(smart_account) = ?',
      [lowerAddress, lowerAddress],
    )

    if (!row) return null
    return this.rowToUser(row)
  }

  async setUser(user: OttoUser): Promise<void> {
    await this.ensureInitialized()
    const validated = expectValid(OttoUserSchema, user, 'setUser')

    await this.client.run(
      `INSERT OR REPLACE INTO otto_users 
       (id, primary_wallet, smart_account, session_key, session_key_expiry, platforms, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validated.id,
        validated.primaryWallet,
        validated.smartAccountAddress ?? null,
        validated.sessionKeyAddress ?? null,
        validated.sessionKeyExpiry ?? null,
        JSON.stringify(validated.platforms),
        JSON.stringify(validated.settings),
        validated.createdAt,
        Date.now(),
      ],
    )

    // Update platform links
    for (const link of validated.platforms) {
      await this.client.run(
        `INSERT OR REPLACE INTO otto_platform_links (platform, platform_id, user_id) VALUES (?, ?, ?)`,
        [link.platform, link.platformId, validated.id],
      )
    }
  }

  private rowToUser(row: UserRow): OttoUser {
    const platforms = JSON.parse(row.platforms) as OttoUser['platforms']
    const settings = JSON.parse(row.settings) as OttoUser['settings']

    const user: OttoUser = {
      id: row.id,
      primaryWallet: row.primary_wallet as Address,
      smartAccountAddress: row.smart_account as Address | undefined,
      sessionKeyAddress: row.session_key as Address | undefined,
      sessionKeyExpiry: row.session_key_expiry ?? undefined,
      platforms,
      settings,
      createdAt: row.created_at,
      lastActiveAt: row.updated_at,
    }

    return expectValid(OttoUserSchema, user, 'rowToUser')
  }

  // ============ Conversation Operations ============

  private getConversationKey(platform: Platform, channelId: string): string {
    return `${platform}:${channelId}`
  }

  async getConversation(
    platform: Platform,
    channelId: string,
  ): Promise<ConversationState> {
    await this.ensureInitialized()
    const key = this.getConversationKey(platform, channelId)

    const row = await this.client.queryOne<ConversationRow>(
      'SELECT * FROM otto_conversations WHERE conversation_key = ?',
      [key],
    )

    if (!row) {
      return { history: [], lastUpdated: Date.now() }
    }

    const history = JSON.parse(row.history) as ConversationState['history']
    const pendingAction = row.pending_action
      ? (JSON.parse(row.pending_action) as PendingAction)
      : undefined

    // Check if pending action expired
    if (pendingAction && pendingAction.expiresAt < Date.now()) {
      return { history, lastUpdated: row.last_updated }
    }

    return { pendingAction, history, lastUpdated: row.last_updated }
  }

  async setPendingAction(
    platform: Platform,
    channelId: string,
    action: PendingAction,
  ): Promise<void> {
    await this.ensureInitialized()
    const key = this.getConversationKey(platform, channelId)
    const state = await this.getConversation(platform, channelId)

    await this.client.run(
      `INSERT OR REPLACE INTO otto_conversations 
       (conversation_key, pending_action, history, last_updated)
       VALUES (?, ?, ?, ?)`,
      [key, JSON.stringify(action), JSON.stringify(state.history), Date.now()],
    )
  }

  async clearPendingAction(
    platform: Platform,
    channelId: string,
  ): Promise<void> {
    await this.ensureInitialized()
    const key = this.getConversationKey(platform, channelId)

    await this.client.run(
      'UPDATE otto_conversations SET pending_action = NULL, last_updated = ? WHERE conversation_key = ?',
      [Date.now(), key],
    )
  }

  async getPendingAction(
    platform: Platform,
    channelId: string,
  ): Promise<PendingAction | undefined> {
    const state = await this.getConversation(platform, channelId)
    return state.pendingAction
  }

  async addToHistory(
    platform: Platform,
    channelId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    await this.ensureInitialized()
    const key = this.getConversationKey(platform, channelId)
    const state = await this.getConversation(platform, channelId)

    state.history.push({ role, content })
    if (state.history.length > MAX_HISTORY_PER_CONVERSATION) {
      state.history = state.history.slice(-MAX_HISTORY_PER_CONVERSATION)
    }

    await this.client.run(
      `INSERT OR REPLACE INTO otto_conversations 
       (conversation_key, pending_action, history, last_updated)
       VALUES (?, ?, ?, ?)`,
      [
        key,
        state.pendingAction ? JSON.stringify(state.pendingAction) : null,
        JSON.stringify(state.history),
        Date.now(),
      ],
    )
  }

  async getHistory(
    platform: Platform,
    channelId: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const state = await this.getConversation(platform, channelId)
    return state.history
  }

  // ============ Session Operations ============

  async createSession(walletAddress?: Address): Promise<ChatSession> {
    await this.ensureInitialized()

    const sessionId = crypto.randomUUID()
    const now = Date.now()
    const session: ChatSession = {
      sessionId,
      userId: walletAddress ?? sessionId,
      walletAddress,
      createdAt: now,
      lastActiveAt: now,
    }

    await this.client.run(
      `INSERT INTO otto_sessions (session_id, user_id, wallet_address, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, session.userId, walletAddress ?? null, now, now],
    )

    return session
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    await this.ensureInitialized()

    const row = await this.client.queryOne<SessionRow>(
      'SELECT * FROM otto_sessions WHERE session_id = ?',
      [sessionId],
    )

    if (!row) return null

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      walletAddress: row.wallet_address as Address | undefined,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    }
  }

  async updateSession(
    sessionId: string,
    update: Partial<ChatSession>,
  ): Promise<void> {
    await this.ensureInitialized()

    const fields: string[] = ['last_active_at = ?']
    const values: (string | number | null)[] = [Date.now()]

    if (update.walletAddress !== undefined) {
      fields.push('wallet_address = ?')
      values.push(update.walletAddress ?? null)
    }

    values.push(sessionId)

    await this.client.run(
      `UPDATE otto_sessions SET ${fields.join(', ')} WHERE session_id = ?`,
      values,
    )
  }

  // ============ Limit Order Operations ============

  async addLimitOrder(order: LimitOrder): Promise<void> {
    await this.ensureInitialized()
    const validated = expectValid(LimitOrderSchema, order, 'addLimitOrder')

    await this.client.run(
      `INSERT INTO otto_limit_orders 
       (order_id, user_id, from_token, to_token, from_amount, target_price, chain_id, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validated.orderId,
        validated.userId,
        JSON.stringify(validated.fromToken),
        JSON.stringify(validated.toToken),
        validated.fromAmount,
        validated.targetPrice,
        validated.chainId,
        validated.status,
        validated.createdAt,
        validated.expiresAt ?? null,
      ],
    )
  }

  async getLimitOrder(orderId: string): Promise<LimitOrder | null> {
    await this.ensureInitialized()

    const row = await this.client.queryOne<LimitOrderRow>(
      'SELECT * FROM otto_limit_orders WHERE order_id = ?',
      [orderId],
    )

    if (!row) return null
    return this.rowToLimitOrder(row)
  }

  async getUserLimitOrders(userId: string): Promise<LimitOrder[]> {
    await this.ensureInitialized()

    const rows = await this.client.query<LimitOrderRow>(
      'SELECT * FROM otto_limit_orders WHERE user_id = ? AND status = ?',
      [userId, 'open'],
    )

    return rows.map((row) => this.rowToLimitOrder(row))
  }

  async updateLimitOrder(
    orderId: string,
    update: Partial<LimitOrder>,
  ): Promise<void> {
    await this.ensureInitialized()

    const fields: string[] = []
    const values: (string | number | null)[] = []

    if (update.status !== undefined) {
      fields.push('status = ?')
      values.push(update.status)
    }
    if (update.filledAt !== undefined) {
      fields.push('filled_at = ?')
      values.push(update.filledAt)
    }
    if (update.filledTxHash !== undefined) {
      fields.push('filled_tx_hash = ?')
      values.push(update.filledTxHash)
    }

    if (fields.length === 0) return

    values.push(orderId)

    await this.client.run(
      `UPDATE otto_limit_orders SET ${fields.join(', ')} WHERE order_id = ?`,
      values,
    )
  }

  async getOpenLimitOrders(): Promise<LimitOrder[]> {
    await this.ensureInitialized()

    const rows = await this.client.query<LimitOrderRow>(
      'SELECT * FROM otto_limit_orders WHERE status = ?',
      ['open'],
    )

    return rows.map((row) => this.rowToLimitOrder(row))
  }

  private rowToLimitOrder(row: LimitOrderRow): LimitOrder {
    const order: LimitOrder = {
      orderId: row.order_id,
      userId: row.user_id,
      fromToken: JSON.parse(row.from_token),
      toToken: JSON.parse(row.to_token),
      fromAmount: row.from_amount,
      targetPrice: row.target_price,
      chainId: row.chain_id,
      status: row.status as LimitOrder['status'],
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
      filledAt: row.filled_at ?? undefined,
      filledTxHash: row.filled_tx_hash as Hex | undefined,
    }

    return expectValid(LimitOrderSchema, order, 'rowToLimitOrder')
  }

  // ============ Limit Order Monitor ============

  async startLimitOrderMonitor(
    checkPriceFn: (token: string, chainId: number) => Promise<number | null>,
    executeFn: (
      order: LimitOrder,
    ) => Promise<{ success: boolean; txHash?: Hex }>,
  ): Promise<void> {
    console.log('[SQLit State] Starting limit order monitor')

    const checkOrders = async () => {
      try {
        const orders = await this.getOpenLimitOrders()

        for (const order of orders) {
          // Check expiry
          if (order.expiresAt && order.expiresAt < Date.now()) {
            await this.updateLimitOrder(order.orderId, { status: 'expired' })
            console.log(`[SQLit State] Order ${order.orderId} expired`)
            continue
          }

          // Check price
          const price = await checkPriceFn(
            order.fromToken.symbol,
            order.chainId,
          )
          if (price === null) continue

          const targetPrice = parseFloat(order.targetPrice)

          if (price >= targetPrice) {
            console.log(
              `[SQLit State] Order ${order.orderId} triggered at price ${price} (target: ${targetPrice})`,
            )

            const result = await executeFn(order)
            if (result.success) {
              await this.updateLimitOrder(order.orderId, {
                status: 'filled',
                filledAt: Date.now(),
                filledTxHash: result.txHash,
              })
              console.log(
                `[SQLit State] Order ${order.orderId} filled, tx: ${result.txHash}`,
              )
            }
          }
        }
      } catch (error) {
        console.error('[SQLit State] Limit order monitor error:', error)
      }
    }

    // Run immediately and then every 30 seconds
    await checkOrders()
    setInterval(checkOrders, 30_000)
  }

  // ============ Backup & Recovery ============

  /**
   * Export all data for backup
   */
  async exportData(): Promise<{
    users: OttoUser[]
    limitOrders: LimitOrder[]
    exportedAt: number
  }> {
    await this.ensureInitialized()

    const userRows = await this.client.query<UserRow>(
      'SELECT * FROM otto_users',
    )
    const orderRows = await this.client.query<LimitOrderRow>(
      'SELECT * FROM otto_limit_orders',
    )

    return {
      users: userRows.map((row) => this.rowToUser(row)),
      limitOrders: orderRows.map((row) => this.rowToLimitOrder(row)),
      exportedAt: Date.now(),
    }
  }

  /**
   * Import data from backup
   */
  async importData(backup: {
    users: OttoUser[]
    limitOrders: LimitOrder[]
  }): Promise<void> {
    await this.ensureInitialized()

    // Import users
    for (const user of backup.users) {
      await this.setUser(user)
    }

    // Import limit orders
    for (const order of backup.limitOrders) {
      try {
        await this.addLimitOrder(order)
      } catch {
        // Order might already exist
        await this.updateLimitOrder(order.orderId, {
          status: order.status,
          filledAt: order.filledAt,
          filledTxHash: order.filledTxHash,
        })
      }
    }

    console.log(
      `[SQLit State] Imported ${backup.users.length} users, ${backup.limitOrders.length} orders`,
    )
  }

  // ============ Cleanup ============

  private async cleanup(): Promise<void> {
    try {
      const now = Date.now()
      const maxAge = 24 * 60 * 60 * 1000 // 24 hours

      // Clean old conversations
      await this.client.run(
        'DELETE FROM otto_conversations WHERE last_updated < ?',
        [now - maxAge],
      )

      // Clean old sessions
      await this.client.run(
        'DELETE FROM otto_sessions WHERE last_active_at < ?',
        [now - maxAge],
      )

      // Clean expired pending actions
      await this.client.run(
        `UPDATE otto_conversations SET pending_action = NULL 
         WHERE pending_action IS NOT NULL AND json_extract(pending_action, '$.expiresAt') < ?`,
        [now],
      )

      console.log('[SQLit State] Cleanup completed')
    } catch (error) {
      console.error('[SQLit State] Cleanup error:', error)
    }
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  // ============ Health Check ============

  async isHealthy(): Promise<boolean> {
    try {
      // Try a simple query
      await this.client.queryOne<MetadataRow>(
        'SELECT value FROM otto_metadata WHERE key = ?',
        ['schema_version'],
      )
      return true
    } catch {
      return false
    }
  }

  /**
   * Get database info for diagnostics
   */
  getDatabaseInfo(): {
    databaseId: string
    endpoint: string
    network: string
    initialized: boolean
  } {
    return {
      databaseId: SQLIT_DATABASE_ID,
      endpoint: this.endpoint,
      network: getCurrentNetwork(),
      initialized: this.initialized,
    }
  }
}

// Singleton instance
let stateManager: SQLitStateManager | null = null

export function getSQLitStateManager(): SQLitStateManager {
  if (!stateManager) {
    stateManager = new SQLitStateManager()
  }
  return stateManager
}

export type { ConversationState, ChatSession }
