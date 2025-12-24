/**
 * Crucible Database Integration
 *
 * Provides CQL database access for Crucible-specific data:
 * - Team management (red/blue teams)
 * - Bot configuration and strategies
 * - Trade logging and profit tracking
 * - Character storage
 *
 * For ElizaOS agent persistence, use cqlDatabasePlugin from @jejunetwork/eliza-plugin
 */

import { asUUID, type UUID } from '@elizaos/core'
import { type CQLClient, getCQL, type QueryParam } from '@jejunetwork/db'
import { isJsonRecord, type JsonRecord } from '@jejunetwork/sdk'
import {
  asTeamType,
  asTradeAction,
  createUUID,
  parseAgentCharacter,
  parseUUIDArray,
} from '../../lib/type-guards'
import type { AgentCharacter, TeamType } from '../../lib/types'

export interface CrucibleTeam {
  id: UUID
  worldId: UUID
  name: string
  type: TeamType
  agentIds: UUID[]
  metadata: JsonRecord
  createdAt: number
}

export interface CrucibleBotConfig {
  id: UUID
  agentId: UUID
  botType: string
  strategy: string
  config: JsonRecord
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface CrucibleTradeLog {
  id: UUID
  botId: UUID
  action: 'buy' | 'sell' | 'swap' | 'provide_liquidity' | 'remove_liquidity'
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  txHash: string
  profit: string
  timestamp: number
}

// CrucibleDB - Database wrapper for Crucible operations

export class CrucibleDB {
  private cql: CQLClient
  private databaseId: string
  private initialized = false

  constructor(databaseId = 'crucible') {
    this.cql = getCQL()
    this.databaseId = databaseId
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    const healthy = await this.cql.isHealthy()
    if (!healthy) {
      throw new Error('CQL not available. Start Jeju services: bun jeju dev')
    }

    await this.runMigrations()
    this.initialized = true
  }

  private async runMigrations(): Promise<void> {
    const migrations = [
      `CREATE TABLE IF NOT EXISTS crucible_teams (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        agent_ids TEXT,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )`,
      `CREATE TABLE IF NOT EXISTS crucible_bots (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        bot_type TEXT NOT NULL,
        strategy TEXT NOT NULL,
        config TEXT,
        active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )`,
      `CREATE TABLE IF NOT EXISTS crucible_trades (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        action TEXT NOT NULL,
        token_in TEXT NOT NULL,
        token_out TEXT NOT NULL,
        amount_in TEXT NOT NULL,
        amount_out TEXT NOT NULL,
        tx_hash TEXT,
        profit TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (bot_id) REFERENCES crucible_bots(id)
      )`,
      `CREATE TABLE IF NOT EXISTS crucible_characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        character_data TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_crucible_teams_world ON crucible_teams(world_id)',
      'CREATE INDEX IF NOT EXISTS idx_crucible_bots_agent ON crucible_bots(agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_crucible_trades_bot ON crucible_trades(bot_id)',
      'CREATE INDEX IF NOT EXISTS idx_crucible_trades_timestamp ON crucible_trades(timestamp)',
    ]

    for (const sql of migrations) {
      await this.cql.exec(sql, [], this.databaseId)
    }
  }

  // Team Management

  async createTeam(params: {
    worldId: UUID
    name: string
    type: TeamType
    agentIds?: UUID[]
    metadata?: JsonRecord
  }): Promise<CrucibleTeam> {
    const id = createUUID()
    const now = Date.now()

    await this.cql.exec(
      'INSERT INTO crucible_teams (id, world_id, name, type, agent_ids, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        params.worldId,
        params.name,
        params.type,
        JSON.stringify(params.agentIds ?? []),
        JSON.stringify(params.metadata ?? {}),
        now,
      ],
      this.databaseId,
    )

    return {
      id,
      worldId: params.worldId,
      name: params.name,
      type: params.type,
      agentIds: params.agentIds ?? [],
      metadata: params.metadata ?? {},
      createdAt: now,
    }
  }

  async getTeam(id: UUID): Promise<CrucibleTeam | null> {
    const result = await this.cql.query<{
      id: string
      world_id: string
      name: string
      type: string
      agent_ids: string
      metadata: string
      created_at: number
    }>('SELECT * FROM crucible_teams WHERE id = ?', [id], this.databaseId)

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: asUUID(row.id),
      worldId: asUUID(row.world_id),
      name: row.name,
      type: asTeamType(row.type),
      agentIds: parseUUIDArray(row.agent_ids),
      metadata: (() => {
        const parsed: unknown = JSON.parse(row.metadata)
        return isJsonRecord(parsed) ? parsed : {}
      })(),
      createdAt: row.created_at,
    }
  }

  async getTeamsByWorld(worldId: UUID): Promise<CrucibleTeam[]> {
    const result = await this.cql.query<{
      id: string
      world_id: string
      name: string
      type: string
      agent_ids: string
      metadata: string
      created_at: number
    }>(
      'SELECT * FROM crucible_teams WHERE world_id = ?',
      [worldId],
      this.databaseId,
    )

    return result.rows.map((row) => ({
      id: asUUID(row.id),
      worldId: asUUID(row.world_id),
      name: row.name,
      type: asTeamType(row.type),
      agentIds: parseUUIDArray(row.agent_ids),
      metadata: (() => {
        const parsed: unknown = JSON.parse(row.metadata)
        return isJsonRecord(parsed) ? parsed : {}
      })(),
      createdAt: row.created_at,
    }))
  }

  async addAgentToTeam(teamId: UUID, agentId: UUID): Promise<boolean> {
    const team = await this.getTeam(teamId)
    if (!team) return false

    const agentIds = [...team.agentIds, agentId]
    await this.cql.exec(
      'UPDATE crucible_teams SET agent_ids = ? WHERE id = ?',
      [JSON.stringify(agentIds), teamId],
      this.databaseId,
    )
    return true
  }

  async removeAgentFromTeam(teamId: UUID, agentId: UUID): Promise<boolean> {
    const team = await this.getTeam(teamId)
    if (!team) return false

    const agentIds = team.agentIds.filter((id) => id !== agentId)
    await this.cql.exec(
      'UPDATE crucible_teams SET agent_ids = ? WHERE id = ?',
      [JSON.stringify(agentIds), teamId],
      this.databaseId,
    )
    return true
  }

  // Bot Configuration

  async createBot(params: {
    agentId: UUID
    botType: string
    strategy: string
    config?: JsonRecord
  }): Promise<CrucibleBotConfig> {
    const id = createUUID()
    const now = Date.now()

    await this.cql.exec(
      'INSERT INTO crucible_bots (id, agent_id, bot_type, strategy, config, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        params.agentId,
        params.botType,
        params.strategy,
        JSON.stringify(params.config ?? {}),
        1,
        now,
        now,
      ],
      this.databaseId,
    )

    return {
      id,
      agentId: params.agentId,
      botType: params.botType,
      strategy: params.strategy,
      config: params.config ?? {},
      active: true,
      createdAt: now,
      updatedAt: now,
    }
  }

  async getBot(id: UUID): Promise<CrucibleBotConfig | null> {
    const result = await this.cql.query<{
      id: string
      agent_id: string
      bot_type: string
      strategy: string
      config: string
      active: number
      created_at: number
      updated_at: number
    }>('SELECT * FROM crucible_bots WHERE id = ?', [id], this.databaseId)

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: asUUID(row.id),
      agentId: asUUID(row.agent_id),
      botType: row.bot_type,
      strategy: row.strategy,
      config: (() => {
        const parsed: unknown = JSON.parse(row.config)
        return isJsonRecord(parsed) ? parsed : {}
      })(),
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async getBotsByAgent(agentId: UUID): Promise<CrucibleBotConfig[]> {
    const result = await this.cql.query<{
      id: string
      agent_id: string
      bot_type: string
      strategy: string
      config: string
      active: number
      created_at: number
      updated_at: number
    }>(
      'SELECT * FROM crucible_bots WHERE agent_id = ?',
      [agentId],
      this.databaseId,
    )

    return result.rows.map((row) => ({
      id: asUUID(row.id),
      agentId: asUUID(row.agent_id),
      botType: row.bot_type,
      strategy: row.strategy,
      config: (() => {
        const parsed: unknown = JSON.parse(row.config)
        return isJsonRecord(parsed) ? parsed : {}
      })(),
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async getActiveBots(): Promise<CrucibleBotConfig[]> {
    const result = await this.cql.query<{
      id: string
      agent_id: string
      bot_type: string
      strategy: string
      config: string
      active: number
      created_at: number
      updated_at: number
    }>('SELECT * FROM crucible_bots WHERE active = 1', [], this.databaseId)

    return result.rows.map((row) => ({
      id: asUUID(row.id),
      agentId: asUUID(row.agent_id),
      botType: row.bot_type,
      strategy: row.strategy,
      config: (() => {
        const parsed: unknown = JSON.parse(row.config)
        return isJsonRecord(parsed) ? parsed : {}
      })(),
      active: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async updateBotConfig(id: UUID, config: JsonRecord): Promise<boolean> {
    const now = Date.now()
    await this.cql.exec(
      'UPDATE crucible_bots SET config = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(config), now, id],
      this.databaseId,
    )
    return true
  }

  async setBotActive(id: UUID, active: boolean): Promise<boolean> {
    const now = Date.now()
    await this.cql.exec(
      'UPDATE crucible_bots SET active = ?, updated_at = ? WHERE id = ?',
      [active ? 1 : 0, now, id],
      this.databaseId,
    )
    return true
  }

  // Trade Logging

  async logTrade(
    params: Omit<CrucibleTradeLog, 'id'>,
  ): Promise<CrucibleTradeLog> {
    const id = createUUID()

    await this.cql.exec(
      'INSERT INTO crucible_trades (id, bot_id, action, token_in, token_out, amount_in, amount_out, tx_hash, profit, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        params.botId,
        params.action,
        params.tokenIn,
        params.tokenOut,
        params.amountIn,
        params.amountOut,
        params.txHash,
        params.profit,
        params.timestamp,
      ],
      this.databaseId,
    )

    return { id, ...params }
  }

  async getTradesByBot(
    botId: UUID,
    options?: { limit?: number; since?: number },
  ): Promise<CrucibleTradeLog[]> {
    let sql = 'SELECT * FROM crucible_trades WHERE bot_id = ?'
    const params: QueryParam[] = [botId]

    if (options?.since) {
      sql += ' AND timestamp > ?'
      params.push(options.since)
    }

    sql += ' ORDER BY timestamp DESC'

    if (options?.limit) {
      sql += ' LIMIT ?'
      params.push(options.limit)
    }

    const result = await this.cql.query<{
      id: string
      bot_id: string
      action: string
      token_in: string
      token_out: string
      amount_in: string
      amount_out: string
      tx_hash: string
      profit: string
      timestamp: number
    }>(sql, params, this.databaseId)

    return result.rows.map((row) => ({
      id: asUUID(row.id),
      botId: asUUID(row.bot_id),
      action: asTradeAction(row.action),
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      amountIn: row.amount_in,
      amountOut: row.amount_out,
      txHash: row.tx_hash,
      profit: row.profit,
      timestamp: row.timestamp,
    }))
  }

  async getBotProfitSummary(
    botId: UUID,
    since?: number,
  ): Promise<{ totalProfit: bigint; tradeCount: number }> {
    let sql =
      'SELECT COUNT(*) as count, SUM(CAST(profit AS INTEGER)) as total FROM crucible_trades WHERE bot_id = ?'
    const params: QueryParam[] = [botId]

    if (since) {
      sql += ' AND timestamp > ?'
      params.push(since)
    }

    const result = await this.cql.query<{ count: number; total: number }>(
      sql,
      params,
      this.databaseId,
    )

    const row = result.rows[0]
    return {
      totalProfit: BigInt(row?.total ?? 0),
      tradeCount: row?.count ?? 0,
    }
  }

  // Character Storage

  async saveCharacter(
    id: string,
    name: string,
    character: AgentCharacter,
  ): Promise<void> {
    const now = Date.now()
    const existing = await this.getCharacter(id)

    if (existing) {
      await this.cql.exec(
        'UPDATE crucible_characters SET name = ?, character_data = ?, updated_at = ? WHERE id = ?',
        [name, JSON.stringify(character), now, id],
        this.databaseId,
      )
    } else {
      await this.cql.exec(
        'INSERT INTO crucible_characters (id, name, character_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, name, JSON.stringify(character), now, now],
        this.databaseId,
      )
    }
  }

  async getCharacter(id: string): Promise<AgentCharacter | null> {
    const result = await this.cql.query<{
      id: string
      name: string
      character_data: string
    }>('SELECT * FROM crucible_characters WHERE id = ?', [id], this.databaseId)

    if (result.rows.length === 0) return null
    return parseAgentCharacter(result.rows[0].character_data)
  }

  async getAllCharacters(): Promise<
    Array<{ id: string; name: string; character: AgentCharacter }>
  > {
    const result = await this.cql.query<{
      id: string
      name: string
      character_data: string
    }>('SELECT * FROM crucible_characters', [], this.databaseId)

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      character: parseAgentCharacter(row.character_data),
    }))
  }

  async deleteCharacter(id: string): Promise<void> {
    await this.cql.exec(
      'DELETE FROM crucible_characters WHERE id = ?',
      [id],
      this.databaseId,
    )
  }

  // Health & Utility

  async isHealthy(): Promise<boolean> {
    return this.cql.isHealthy()
  }

  getDatabaseId(): string {
    return this.databaseId
  }
}

// Singleton

let crucibleDB: CrucibleDB | null = null

export function getCrucibleDB(): CrucibleDB {
  if (!crucibleDB) {
    crucibleDB = new CrucibleDB()
  }
  return crucibleDB
}

export async function initCrucibleDB(): Promise<CrucibleDB> {
  const db = getCrucibleDB()
  await db.initialize()
  return db
}

export function resetCrucibleDB(): void {
  crucibleDB = null
}
