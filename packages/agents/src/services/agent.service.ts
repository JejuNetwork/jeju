/**
 * Agent Service - Core agent lifecycle management
 *
 * Agents are implemented as users with isAgent=true, allowing them to participate
 * fully in the platform (post, comment, trade, etc).
 *
 * @packageDocumentation
 */

import { type CQLClient, getCQL } from '@jejunetwork/db'
import { logger } from '@jejunetwork/shared'
import type {
  AgentCapabilities,
  AgentDiscoveryProfile,
} from '@jejunetwork/types'
import { z } from 'zod'
import type {
  AgentConfig,
  AgentLog,
  AgentPerformance,
  CreateAgentParams,
} from '../types'

// Zod schemas for database row validation
const AgentRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  profile_image_url: z.string().nullable(),
  character: z.string(),
  model_tier: z.enum(['lite', 'standard', 'pro']),
  autonomous_enabled: z.union([z.number(), z.boolean()]),
  is_active: z.union([z.number(), z.boolean()]),
  points_balance: z.number(),
  wallet_address: z.string().nullable(),
  oauth3_wallet_id: z.string().nullable(),
  lifetime_pnl: z.number(),
  total_trades: z.number(),
  win_rate: z.number(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
})

const AgentLogRowSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  type: z.enum([
    'chat',
    'tick',
    'trade',
    'error',
    'system',
    'post',
    'comment',
    'dm',
  ]),
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string(),
  prompt: z.string().nullable(),
  completion: z.string().nullable(),
  thinking: z.string().nullable(),
  metadata: z.string().nullable(),
  created_at: z.string(),
})

type AgentRow = z.infer<typeof AgentRowSchema>
type AgentLogRow = z.infer<typeof AgentLogRowSchema>

/**
 * Agent with configuration
 */
export interface AgentWithConfig extends AgentConfig {
  systemPrompt?: string
  personality?: string
  tradingStrategy?: string
  messageExamples?: string[]
}

/**
 * Convert database row to AgentConfig
 */
function rowToAgentConfig(row: AgentRow): AgentConfig {
  const character = JSON.parse(row.character)
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    profileImageUrl: row.profile_image_url ?? undefined,
    character,
    modelTier: row.model_tier,
    autonomousEnabled: Boolean(row.autonomous_enabled),
    isActive: Boolean(row.is_active),
    pointsBalance: row.points_balance,
    walletAddress: row.wallet_address ?? undefined,
    oauth3WalletId: row.oauth3_wallet_id ?? undefined,
    lifetimePnL: row.lifetime_pnl,
    totalTrades: row.total_trades,
    winRate: row.win_rate,
  }
}

/**
 * Convert database row to AgentLog
 */
function rowToAgentLog(row: AgentLogRow): AgentLog {
  return {
    id: row.id,
    agentId: row.agent_id,
    type: row.type,
    level: row.level,
    message: row.message,
    prompt: row.prompt ?? undefined,
    completion: row.completion ?? undefined,
    thinking: row.thinking ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: new Date(row.created_at),
  }
}

/**
 * Service for agent lifecycle management
 */
export class AgentService {
  private db: CQLClient

  constructor(db?: CQLClient) {
    this.db = db ?? getCQL()
  }

  /**
   * Create a new agent
   */
  async createAgent(params: CreateAgentParams): Promise<AgentConfig> {
    logger.info(`Creating agent ${params.name} for user ${params.userId}`)

    const id = `agent-${crypto.randomUUID()}`
    const now = new Date().toISOString()

    // Build character from params
    const character = {
      name: params.name,
      system: params.system,
      bio: params.bio ?? [],
      lore: [],
      adjectives: [],
      topics: [],
      style: {
        all: [],
        chat: [],
        post: [],
      },
      messageExamples: [],
      postExamples: [],
    }

    await this.db.exec(
      `INSERT INTO agents (
        id, user_id, name, description, profile_image_url, character,
        model_tier, autonomous_enabled, is_active, points_balance,
        lifetime_pnl, total_trades, win_rate, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.userId,
        params.name,
        params.description ?? null,
        params.profileImageUrl ?? null,
        JSON.stringify(character),
        params.modelTier ?? 'standard',
        1, // autonomous_enabled
        1, // is_active
        params.initialDeposit ?? 0,
        0, // lifetime_pnl
        0, // total_trades
        0, // win_rate
        now,
        now,
      ],
    )

    return {
      id,
      userId: params.userId,
      name: params.name,
      description: params.description,
      profileImageUrl: params.profileImageUrl,
      character,
      modelTier: params.modelTier ?? 'standard',
      autonomousEnabled: true,
      isActive: true,
      pointsBalance: params.initialDeposit ?? 0,
      lifetimePnL: 0,
      totalTrades: 0,
      winRate: 0,
    }
  }

  /**
   * Get agent by ID
   */
  async getAgent(
    agentId: string,
    managerId?: string,
  ): Promise<AgentConfig | null> {
    logger.info(
      `Getting agent ${agentId}${managerId ? ` for manager ${managerId}` : ''}`,
    )

    let sql = 'SELECT * FROM agents WHERE id = ?'
    const params: (string | number | null)[] = [agentId]

    if (managerId) {
      sql += ' AND user_id = ?'
      params.push(managerId)
    }

    const result = await this.db.query<AgentRow>(sql, params)

    if (result.rows.length === 0) {
      return null
    }

    const row = AgentRowSchema.parse(result.rows[0])
    return rowToAgentConfig(row)
  }

  /**
   * Get agent with full configuration
   */
  async getAgentWithConfig(
    agentId: string,
    managerId?: string,
  ): Promise<AgentWithConfig | null> {
    const agent = await this.getAgent(agentId, managerId)
    if (!agent) return null

    const character = agent.character
    const messageExamples = Array.isArray(character.messageExamples)
      ? character.messageExamples
          .map(
            (example: Array<{ content?: { text?: string } }>) =>
              example[0]?.content?.text,
          )
          .filter((text: string | undefined): text is string => !!text)
      : undefined

    return {
      ...agent,
      systemPrompt: character.system,
      personality: character.adjectives?.join(', '),
      tradingStrategy: character.topics?.find((t: string) =>
        t.toLowerCase().includes('trading'),
      ),
      messageExamples,
    }
  }

  /**
   * List agents owned by a user
   */
  async listUserAgents(
    managerId: string,
    filters?: { autonomousTrading?: boolean },
  ): Promise<AgentConfig[]> {
    logger.info(
      `Listing agents for user ${managerId}${filters ? ` with filters: ${JSON.stringify(filters)}` : ''}`,
    )

    let sql = 'SELECT * FROM agents WHERE user_id = ?'
    const params: (string | number | null)[] = [managerId]

    if (filters?.autonomousTrading !== undefined) {
      sql += ' AND autonomous_enabled = ?'
      params.push(filters.autonomousTrading ? 1 : 0)
    }

    sql += ' ORDER BY created_at DESC'

    const result = await this.db.query<AgentRow>(sql, params)

    return result.rows.map((row) => {
      const validated = AgentRowSchema.parse(row)
      return rowToAgentConfig(validated)
    })
  }

  /**
   * Update agent configuration
   */
  async updateAgent(
    agentId: string,
    managerId: string,
    updates: Partial<{
      name: string
      description: string
      profileImageUrl: string
      system: string
      bio: string[]
      personality: string
      tradingStrategy: string
      modelTier: 'lite' | 'standard' | 'pro'
      autonomousTrading: boolean
      autonomousPosting: boolean
      autonomousCommenting: boolean
      autonomousDMs: boolean
      autonomousGroupChats: boolean
      a2aEnabled: boolean
    }>,
  ): Promise<AgentConfig> {
    logger.info(
      `Updating agent ${agentId} by ${managerId}: ${JSON.stringify(updates)}`,
    )

    // First get the existing agent
    const existing = await this.getAgent(agentId, managerId)
    if (!existing) {
      throw new Error(`Agent ${agentId} not found or not owned by ${managerId}`)
    }

    // Build update fields
    const setClauses: string[] = []
    const params: (string | number | null)[] = []

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      params.push(updates.name)
    }

    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      params.push(updates.description)
    }

    if (updates.profileImageUrl !== undefined) {
      setClauses.push('profile_image_url = ?')
      params.push(updates.profileImageUrl)
    }

    if (updates.modelTier !== undefined) {
      setClauses.push('model_tier = ?')
      params.push(updates.modelTier)
    }

    if (updates.autonomousTrading !== undefined) {
      setClauses.push('autonomous_enabled = ?')
      params.push(updates.autonomousTrading ? 1 : 0)
    }

    // Update character if any character fields changed
    if (
      updates.system !== undefined ||
      updates.bio !== undefined ||
      updates.personality !== undefined ||
      updates.tradingStrategy !== undefined
    ) {
      const character = { ...existing.character }
      if (updates.system !== undefined) character.system = updates.system
      if (updates.bio !== undefined) character.bio = updates.bio
      if (updates.personality !== undefined) {
        character.adjectives = updates.personality
          .split(',')
          .map((a: string) => a.trim())
      }
      if (updates.tradingStrategy !== undefined) {
        const existingTopics = character.topics ?? []
        const filteredTopics = existingTopics.filter(
          (t: string) => !t.toLowerCase().includes('trading'),
        )
        filteredTopics.push(updates.tradingStrategy)
        character.topics = filteredTopics
      }
      setClauses.push('character = ?')
      params.push(JSON.stringify(character))
    }

    setClauses.push('updated_at = ?')
    params.push(new Date().toISOString())

    params.push(agentId)
    params.push(managerId)

    await this.db.exec(
      `UPDATE agents SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`,
      params,
    )

    const updated = await this.getAgent(agentId, managerId)
    if (!updated) {
      throw new Error('Failed to retrieve updated agent')
    }
    return updated
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string, managerId: string): Promise<void> {
    logger.info(`Deleting agent ${agentId} by ${managerId}`)

    const result = await this.db.exec(
      'DELETE FROM agents WHERE id = ? AND user_id = ?',
      [agentId, managerId],
    )

    if (result.rowsAffected === 0) {
      throw new Error(`Agent ${agentId} not found or not owned by ${managerId}`)
    }
  }

  /**
   * Deposit points to agent's operations budget
   */
  async depositPoints(
    agentId: string,
    managerId: string,
    amount: number,
  ): Promise<AgentConfig> {
    logger.info(
      `Depositing ${amount} points to agent ${agentId} from ${managerId}`,
    )

    if (amount <= 0) {
      throw new Error('Deposit amount must be positive')
    }

    await this.db.exec(
      `UPDATE agents SET points_balance = points_balance + ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [amount, new Date().toISOString(), agentId, managerId],
    )

    const agent = await this.getAgent(agentId, managerId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }
    return agent
  }

  /**
   * Withdraw points from agent's operations budget
   */
  async withdrawPoints(
    agentId: string,
    managerId: string,
    amount: number,
  ): Promise<AgentConfig> {
    logger.info(
      `Withdrawing ${amount} points from agent ${agentId} to ${managerId}`,
    )

    if (amount <= 0) {
      throw new Error('Withdrawal amount must be positive')
    }

    // Check balance first
    const agent = await this.getAgent(agentId, managerId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found or not owned by ${managerId}`)
    }

    if (agent.pointsBalance < amount) {
      throw new Error(
        `Insufficient balance: ${agent.pointsBalance} < ${amount}`,
      )
    }

    await this.db.exec(
      `UPDATE agents SET points_balance = points_balance - ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [amount, new Date().toISOString(), agentId, managerId],
    )

    return { ...agent, pointsBalance: agent.pointsBalance - amount }
  }

  /**
   * Deduct points for an operation
   */
  async deductPoints(
    agentId: string,
    amount: number,
    reason: string,
    relatedId?: string,
  ): Promise<number> {
    logger.debug(
      `Deducting ${amount} points from ${agentId}: ${reason}${relatedId ? ` (${relatedId})` : ''}`,
    )

    // Get current balance
    const result = await this.db.query<{ points_balance: number }>(
      'SELECT points_balance FROM agents WHERE id = ?',
      [agentId],
    )

    if (result.rows.length === 0) {
      throw new Error(`Agent ${agentId} not found`)
    }

    const currentBalance = result.rows[0].points_balance
    if (currentBalance < amount) {
      throw new Error(`Insufficient points: ${currentBalance} < ${amount}`)
    }

    const newBalance = currentBalance - amount

    await this.db.exec(
      `UPDATE agents SET points_balance = ?, updated_at = ? WHERE id = ?`,
      [newBalance, new Date().toISOString(), agentId],
    )

    // Log the transaction
    await this.createLog(agentId, {
      type: 'system',
      level: 'info',
      message: `Deducted ${amount} points: ${reason}`,
      metadata: {
        reason,
        relatedId: relatedId ?? null,
        amount,
        balanceAfter: newBalance,
      },
    })

    return newBalance
  }

  /**
   * Get agent performance metrics
   */
  async getPerformance(agentId: string): Promise<AgentPerformance> {
    const result = await this.db.query<{
      lifetime_pnl: number
      total_trades: number
      win_rate: number
    }>('SELECT lifetime_pnl, total_trades, win_rate FROM agents WHERE id = ?', [
      agentId,
    ])

    if (result.rows.length === 0) {
      throw new Error(`Agent ${agentId} not found`)
    }

    const row = result.rows[0]
    const profitableTrades = Math.round(row.total_trades * row.win_rate)

    return {
      lifetimePnL: row.lifetime_pnl,
      totalTrades: row.total_trades,
      profitableTrades,
      winRate: row.win_rate,
      avgTradeSize:
        row.total_trades > 0
          ? Math.abs(row.lifetime_pnl) / row.total_trades
          : 0,
    }
  }

  /**
   * Get agent chat history
   */
  async getChatHistory(
    agentId: string,
    limit = 50,
  ): Promise<
    { role: 'user' | 'assistant'; content: string; createdAt: Date }[]
  > {
    const result = await this.db.query<{
      role: string
      message: string
      created_at: string
    }>(
      `SELECT role, message, created_at FROM agent_messages
       WHERE agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [agentId, limit],
    )

    return result.rows.map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.message,
      createdAt: new Date(row.created_at),
    }))
  }

  /**
   * Get agent logs
   */
  async getLogs(
    agentId: string,
    filters?: { type?: string; level?: string; limit?: number },
  ): Promise<AgentLog[]> {
    let sql = 'SELECT * FROM agent_logs WHERE agent_id = ?'
    const params: (string | number)[] = [agentId]

    if (filters?.type) {
      sql += ' AND type = ?'
      params.push(filters.type)
    }

    if (filters?.level) {
      sql += ' AND level = ?'
      params.push(filters.level)
    }

    sql += ' ORDER BY created_at DESC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    const result = await this.db.query<AgentLogRow>(sql, params)

    return result.rows.map((row) => {
      const validated = AgentLogRowSchema.parse(row)
      return rowToAgentLog(validated)
    })
  }

  /**
   * Create a log entry
   */
  async createLog(
    agentId: string,
    log: Omit<AgentLog, 'id' | 'agentId' | 'createdAt'>,
  ): Promise<AgentLog> {
    const id = `log-${crypto.randomUUID()}`
    const now = new Date().toISOString()

    await this.db.exec(
      `INSERT INTO agent_logs (id, agent_id, type, level, message, prompt, completion, thinking, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        agentId,
        log.type,
        log.level,
        log.message,
        log.prompt ?? null,
        log.completion ?? null,
        log.thinking ?? null,
        log.metadata ? JSON.stringify(log.metadata) : null,
        now,
      ],
    )

    return {
      id,
      agentId,
      ...log,
      createdAt: new Date(now),
    }
  }

  /**
   * Get agent capabilities for A2A/Agent0 discovery
   */
  getAgentCapabilities(_agent: AgentConfig): AgentCapabilities {
    return {
      strategies: ['prediction_markets', 'social_interaction'],
      markets: ['prediction', 'perpetual', 'spot'],
      actions: [
        'trade',
        'post',
        'comment',
        'like',
        'message',
        'analyze_market',
        'manage_portfolio',
      ],
      version: '1.0.0',
      x402Support: true,
      platform: 'jeju',
      userType: 'user_controlled',
      skills: [],
      domains: [],
    }
  }

  /**
   * Get agent profile for discovery
   */
  getAgentProfile(agent: AgentConfig): AgentDiscoveryProfile {
    return {
      agentId: agent.id,
      address: agent.walletAddress ?? '',
      capabilities: this.getAgentCapabilities(agent),
      reputation: agent.winRate * 100,
    }
  }
}

/** Singleton instance */
export const agentService = new AgentService()
