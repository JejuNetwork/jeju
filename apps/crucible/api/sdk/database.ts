/**
 * Crucible Database - SQLit Integration
 *
 * Uses DWS SQLit for decentralized database storage.
 * Falls back gracefully when SQLit is not available.
 */

import { getSQLitBlockProducerUrl } from '@jejunetwork/config'
import { z } from 'zod'
import { createLogger, type Logger } from './logger'

// SQLit query result schema
const SQLitQueryResultSchema = z.object({
  data: z
    .object({
      rows: z.array(z.record(z.unknown())).nullable(),
    })
    .optional(),
  status: z.string(),
  error: z.string().optional(),
})

export interface DatabaseConfig {
  endpoint?: string
  database?: string
  timeout?: number
  logger?: Logger
}

export interface Agent {
  id: number
  agent_id: string
  name: string
  owner: string
  character_cid: string | null
  state_cid: string | null
  created_at: number
  updated_at: number
}

export interface Room {
  id: number
  room_id: string
  name: string
  room_type: string
  state_cid: string | null
  created_at: number
}

export interface Message {
  id: number
  room_id: string
  agent_id: string
  content: string
  action: string | null
  created_at: number
}

export interface Trigger {
  id: number
  trigger_id: string
  agent_id: string
  trigger_type: string
  config: string
  enabled: number
  created_at: number
}

type ConnectionState = 'disconnected' | 'connected' | 'unavailable'

export class CrucibleDatabase {
  private config: DatabaseConfig
  private log: Logger
  private state: ConnectionState = 'disconnected'
  private endpoint: string
  private database: string
  private timeout: number

  constructor(config: DatabaseConfig = {}) {
    this.config = config
    this.log = config.logger ?? createLogger('Database')
    this.endpoint = config.endpoint ?? getSQLitBlockProducerUrl()
    this.database = config.database ?? 'crucible'
    this.timeout = config.timeout ?? 30000
  }

  /**
   * Connect to SQLit and verify database exists
   */
  async connect(): Promise<boolean> {
    if (this.state === 'connected') return true
    if (this.state === 'unavailable') return false

    try {
      this.log.info('Connecting to SQLit', { endpoint: this.endpoint })

      // Check if SQLit is available
      const statusResponse = await fetch(`${this.endpoint}/v1/status`, {
        signal: AbortSignal.timeout(5000),
      })

      if (!statusResponse.ok) {
        this.state = 'unavailable'
        this.log.warn('SQLit not available')
        return false
      }

      // Create tables if they don't exist
      await this.initSchema()

      this.state = 'connected'
      this.log.info('Connected to SQLit')
      return true
    } catch (error) {
      this.state = 'unavailable'
      this.log.warn('Failed to connect to SQLit', { error: String(error) })
      return false
    }
  }

  get isConnected(): boolean {
    return this.state === 'connected'
  }

  /**
   * Initialize database schema
   */
  private async initSchema(): Promise<void> {
    await this.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        owner TEXT NOT NULL,
        character_cid TEXT,
        state_cid TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `)

    await this.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        room_type TEXT NOT NULL DEFAULT 'chat',
        state_cid TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `)

    await this.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        action TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `)

    await this.exec(`
      CREATE TABLE IF NOT EXISTS triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_id TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `)

    // Create indices
    await this.exec(
      `CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id)`,
    )
    await this.exec(
      `CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id)`,
    )
    await this.exec(
      `CREATE INDEX IF NOT EXISTS idx_triggers_agent ON triggers(agent_id)`,
    )
  }

  /**
   * Execute a SELECT query
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    if (this.state !== 'connected') {
      await this.connect()
      if (this.state !== 'connected') {
        return []
      }
    }

    const formattedSql = this.formatSql(sql, values)
    const result = await this.fetchQuery('query', formattedSql)
    return (result ?? []) as T[]
  }

  /**
   * Execute a write operation (INSERT, UPDATE, DELETE)
   */
  async exec(
    sql: string,
    values: unknown[] = [],
  ): Promise<Record<string, unknown>[] | null> {
    if (this.state !== 'connected') {
      await this.connect()
      if (this.state !== 'connected') {
        return null
      }
    }

    const formattedSql = this.formatSql(sql, values)
    return this.fetchQuery('exec', formattedSql)
  }

  /**
   * Format SQL with parameter substitution
   */
  private formatSql(sql: string, values: unknown[]): string {
    let index = 0
    return sql.replace(/\?/g, () => {
      const value = values[index++]
      if (value === null || value === undefined) return 'NULL'
      if (typeof value === 'number') return String(value)
      if (typeof value === 'boolean') return value ? '1' : '0'
      // Escape string values
      const str = String(value).replace(/'/g, "''")
      return `'${str}'`
    })
  }

  /**
   * Internal fetch for query operations
   */
  private async fetchQuery(
    method: 'query' | 'exec',
    sql: string,
  ): Promise<Record<string, unknown>[] | null> {
    const uri = `${this.endpoint}/v1/${method}`

    const response = await fetch(uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assoc: true,
        database: this.database,
        query: sql,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`SQLit request failed: ${response.status}`)
    }

    const result: unknown = await response.json()
    const parsed = SQLitQueryResultSchema.safeParse(result)
    if (!parsed.success) {
      throw new Error(`Invalid SQLit response: ${parsed.error.message}`)
    }

    if (parsed.data.error) {
      throw new Error(`SQLit error: ${parsed.data.error}`)
    }

    return parsed.data.data?.rows ?? null
  }

  // ============================================
  // Agent Operations
  // ============================================

  async createAgent(data: {
    agentId: string
    name: string
    owner: string
    characterCid?: string
    stateCid?: string
  }): Promise<Agent | null> {
    await this.exec(
      `INSERT INTO agents (agent_id, name, owner, character_cid, state_cid) VALUES (?, ?, ?, ?, ?)`,
      [
        data.agentId,
        data.name,
        data.owner,
        data.characterCid ?? null,
        data.stateCid ?? null,
      ],
    )

    const results = await this.query<Agent>(
      `SELECT * FROM agents WHERE agent_id = ?`,
      [data.agentId],
    )
    return results[0] ?? null
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    const results = await this.query<Agent>(
      `SELECT * FROM agents WHERE agent_id = ?`,
      [agentId],
    )
    return results[0] ?? null
  }

  async updateAgent(
    agentId: string,
    updates: Partial<{
      name: string
      characterCid: string
      stateCid: string
    }>,
  ): Promise<void> {
    const sets: string[] = []
    const values: unknown[] = []

    if (updates.name !== undefined) {
      sets.push('name = ?')
      values.push(updates.name)
    }
    if (updates.characterCid !== undefined) {
      sets.push('character_cid = ?')
      values.push(updates.characterCid)
    }
    if (updates.stateCid !== undefined) {
      sets.push('state_cid = ?')
      values.push(updates.stateCid)
    }

    if (sets.length > 0) {
      sets.push("updated_at = strftime('%s', 'now')")
      values.push(agentId)
      await this.exec(
        `UPDATE agents SET ${sets.join(', ')} WHERE agent_id = ?`,
        values,
      )
    }
  }

  async listAgents(
    options: { owner?: string; limit?: number; offset?: number } = {},
  ): Promise<Agent[]> {
    let sql = 'SELECT * FROM agents'
    const values: unknown[] = []

    if (options.owner) {
      sql += ' WHERE owner = ?'
      values.push(options.owner)
    }

    sql += ' ORDER BY created_at DESC'

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`
    }
    if (options.offset) {
      sql += ` OFFSET ${options.offset}`
    }

    return this.query<Agent>(sql, values)
  }

  // ============================================
  // Room Operations
  // ============================================

  async createRoom(data: {
    roomId: string
    name: string
    roomType?: string
    stateCid?: string
  }): Promise<Room | null> {
    await this.exec(
      `INSERT INTO rooms (room_id, name, room_type, state_cid) VALUES (?, ?, ?, ?)`,
      [data.roomId, data.name, data.roomType ?? 'chat', data.stateCid ?? null],
    )

    const results = await this.query<Room>(
      `SELECT * FROM rooms WHERE room_id = ?`,
      [data.roomId],
    )
    return results[0] ?? null
  }

  async getRoom(roomId: string): Promise<Room | null> {
    const results = await this.query<Room>(
      `SELECT * FROM rooms WHERE room_id = ?`,
      [roomId],
    )
    return results[0] ?? null
  }

  async listRooms(limit = 100): Promise<Room[]> {
    return this.query<Room>(
      `SELECT * FROM rooms ORDER BY created_at DESC LIMIT ?`,
      [limit],
    )
  }

  // ============================================
  // Message Operations
  // ============================================

  async createMessage(data: {
    roomId: string
    agentId: string
    content: string
    action?: string
  }): Promise<Message | null> {
    await this.exec(
      `INSERT INTO messages (room_id, agent_id, content, action) VALUES (?, ?, ?, ?)`,
      [data.roomId, data.agentId, data.content, data.action ?? null],
    )

    const results = await this.query<Message>(
      `SELECT * FROM messages WHERE room_id = ? AND agent_id = ? ORDER BY id DESC LIMIT 1`,
      [data.roomId, data.agentId],
    )
    return results[0] ?? null
  }

  async getMessages(
    roomId: string,
    options: { limit?: number; since?: number } = {},
  ): Promise<Message[]> {
    let sql = 'SELECT * FROM messages WHERE room_id = ?'
    const values: unknown[] = [roomId]

    if (options.since) {
      sql += ' AND created_at > ?'
      values.push(options.since)
    }

    sql += ' ORDER BY created_at DESC'

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`
    }

    return this.query<Message>(sql, values)
  }

  // ============================================
  // Trigger Operations
  // ============================================

  async createTrigger(data: {
    triggerId: string
    agentId: string
    triggerType: string
    config: Record<string, unknown>
  }): Promise<Trigger | null> {
    await this.exec(
      `INSERT INTO triggers (trigger_id, agent_id, trigger_type, config) VALUES (?, ?, ?, ?)`,
      [
        data.triggerId,
        data.agentId,
        data.triggerType,
        JSON.stringify(data.config),
      ],
    )

    const results = await this.query<Trigger>(
      `SELECT * FROM triggers WHERE trigger_id = ?`,
      [data.triggerId],
    )
    return results[0] ?? null
  }

  async getTriggers(agentId: string): Promise<Trigger[]> {
    return this.query<Trigger>(
      `SELECT * FROM triggers WHERE agent_id = ? AND enabled = 1`,
      [agentId],
    )
  }

  async disableTrigger(triggerId: string): Promise<void> {
    await this.exec(`UPDATE triggers SET enabled = 0 WHERE trigger_id = ?`, [
      triggerId,
    ])
  }
}

// Singleton instance
let dbInstance: CrucibleDatabase | null = null

export function getDatabase(config?: DatabaseConfig): CrucibleDatabase {
  if (!dbInstance) {
    dbInstance = new CrucibleDatabase(config)
  }
  return dbInstance
}

export function createDatabase(config?: DatabaseConfig): CrucibleDatabase {
  return new CrucibleDatabase(config)
}

