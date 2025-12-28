/**
 * Agent P&L Service
 *
 * Tracks and calculates agent profit and loss from trading activity.
 *
 * @packageDocumentation
 */

import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import { logger } from '@jejunetwork/shared'
import { z } from 'zod'

/**
 * P&L summary for an agent
 */
export interface AgentPnLSummary {
  agentId: string
  totalPnL: number
  realizedPnL: number
  unrealizedPnL: number
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  avgWin: number
  avgLoss: number
  largestWin: number
  largestLoss: number
  sharpeRatio: number
  maxDrawdown: number
}

// Zod schemas for database row validation
const TradeResultRowSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  trade_id: z.string(),
  pnl: z.number(),
  created_at: z.string(),
})

const AgentStatsRowSchema = z.object({
  lifetime_pnl: z.number(),
  total_trades: z.number(),
  win_rate: z.number(),
})

const PnLHistoryRowSchema = z.object({
  pnl: z.number(),
  created_at: z.string(),
})

type TradeResultRow = z.infer<typeof TradeResultRowSchema>

/**
 * Agent P&L Service
 */
export class AgentPnLService {
  private db: EQLiteClient

  constructor(db?: EQLiteClient) {
    this.db = db ?? getEQLite()
  }

  /**
   * Get P&L summary for an agent
   */
  async getPnLSummary(agentId: string): Promise<AgentPnLSummary> {
    logger.debug(`Getting P&L summary for ${agentId}`)

    // Get basic stats from agents table
    const agentResult = await this.db.query<{
      lifetime_pnl: number
      total_trades: number
      win_rate: number
    }>('SELECT lifetime_pnl, total_trades, win_rate FROM agents WHERE id = ?', [
      agentId,
    ])

    if (agentResult.rows.length === 0) {
      throw new Error(`Agent ${agentId} not found`)
    }

    const agentStats = AgentStatsRowSchema.parse(agentResult.rows[0])

    // Get detailed trade results for advanced metrics
    const tradesResult = await this.db.query<TradeResultRow>(
      `SELECT id, agent_id, trade_id, pnl, created_at
       FROM agent_trade_results
       WHERE agent_id = ?
       ORDER BY created_at DESC`,
      [agentId],
    )

    const trades = tradesResult.rows.map((row) =>
      TradeResultRowSchema.parse(row),
    )

    // Calculate advanced metrics
    const winningTrades = trades.filter((t) => t.pnl > 0)
    const losingTrades = trades.filter((t) => t.pnl < 0)

    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) /
          winningTrades.length
        : 0

    const avgLoss =
      losingTrades.length > 0
        ? Math.abs(
            losingTrades.reduce((sum, t) => sum + t.pnl, 0) /
              losingTrades.length,
          )
        : 0

    const largestWin =
      winningTrades.length > 0
        ? Math.max(...winningTrades.map((t) => t.pnl))
        : 0

    const largestLoss =
      losingTrades.length > 0
        ? Math.abs(Math.min(...losingTrades.map((t) => t.pnl)))
        : 0

    // Calculate Sharpe ratio and max drawdown
    const sharpeRatio = await this.calculateSharpeRatio(agentId)
    const maxDrawdown = await this.calculateMaxDrawdown(agentId)

    return {
      agentId,
      totalPnL: agentStats.lifetime_pnl,
      realizedPnL: agentStats.lifetime_pnl,
      unrealizedPnL: 0, // Would need open position data
      totalTrades: agentStats.total_trades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: agentStats.win_rate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      sharpeRatio,
      maxDrawdown,
    }
  }

  /**
   * Record a trade result
   */
  async recordTradeResult(
    agentId: string,
    tradeId: string,
    pnl: number,
  ): Promise<void> {
    logger.debug(
      `Recording trade result for ${agentId}: trade ${tradeId} = ${pnl}`,
    )

    const id = `tr-${crypto.randomUUID()}`
    const now = new Date().toISOString()

    // Insert trade result
    await this.db.exec(
      `INSERT INTO agent_trade_results (id, agent_id, trade_id, pnl, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, agentId, tradeId, pnl, now],
    )

    // Get current agent stats
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

    const stats = AgentStatsRowSchema.parse(result.rows[0])

    // Calculate new stats
    const newTotalTrades = stats.total_trades + 1
    const currentWins = Math.round(stats.total_trades * stats.win_rate)
    const newWins = pnl > 0 ? currentWins + 1 : currentWins
    const newWinRate = newWins / newTotalTrades
    const newLifetimePnL = stats.lifetime_pnl + pnl

    // Update agent stats
    await this.db.exec(
      `UPDATE agents SET
         lifetime_pnl = ?,
         total_trades = ?,
         win_rate = ?,
         updated_at = ?
       WHERE id = ?`,
      [newLifetimePnL, newTotalTrades, newWinRate, now, agentId],
    )
  }

  /**
   * Calculate Sharpe ratio for an agent
   */
  async calculateSharpeRatio(
    agentId: string,
    periodDays = 30,
  ): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - periodDays)

    const result = await this.db.query<{ pnl: number; created_at: string }>(
      `SELECT pnl, created_at FROM agent_trade_results
       WHERE agent_id = ? AND created_at >= ?
       ORDER BY created_at ASC`,
      [agentId, cutoffDate.toISOString()],
    )

    const trades = result.rows.map((row) => PnLHistoryRowSchema.parse(row))

    if (trades.length < 2) {
      return 0
    }

    // Calculate daily returns
    const dailyReturns: number[] = []
    let dayPnL = 0
    let currentDay = ''

    for (const trade of trades) {
      const tradeDay = trade.created_at.split('T')[0] ?? ''
      if (tradeDay !== currentDay) {
        if (currentDay) {
          dailyReturns.push(dayPnL)
        }
        currentDay = tradeDay
        dayPnL = trade.pnl
      } else {
        dayPnL += trade.pnl
      }
    }
    if (dayPnL !== 0) {
      dailyReturns.push(dayPnL)
    }

    if (dailyReturns.length < 2) {
      return 0
    }

    // Calculate mean and standard deviation
    const mean =
      dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length
    const variance =
      dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
      dailyReturns.length
    const stdDev = Math.sqrt(variance)

    if (stdDev === 0) {
      return 0
    }

    // Annualized Sharpe ratio (assuming 252 trading days)
    const annualizationFactor = Math.sqrt(252)
    return (mean / stdDev) * annualizationFactor
  }

  /**
   * Calculate maximum drawdown for an agent
   */
  async calculateMaxDrawdown(
    agentId: string,
    periodDays = 30,
  ): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - periodDays)

    const result = await this.db.query<{ pnl: number; created_at: string }>(
      `SELECT pnl, created_at FROM agent_trade_results
       WHERE agent_id = ? AND created_at >= ?
       ORDER BY created_at ASC`,
      [agentId, cutoffDate.toISOString()],
    )

    const trades = result.rows.map((row) => PnLHistoryRowSchema.parse(row))

    if (trades.length === 0) {
      return 0
    }

    // Calculate cumulative P&L and track max drawdown
    let cumulativePnL = 0
    let peak = 0
    let maxDrawdown = 0

    for (const trade of trades) {
      cumulativePnL += trade.pnl

      if (cumulativePnL > peak) {
        peak = cumulativePnL
      }

      const drawdown = peak - cumulativePnL
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown
      }
    }

    // Return as a ratio of peak (or 0 if no peak)
    return peak > 0 ? maxDrawdown / peak : 0
  }

  /**
   * Get leaderboard of top performing agents
   */
  async getLeaderboard(
    limit = 10,
    period: 'day' | 'week' | 'month' | 'all' = 'week',
  ): Promise<AgentPnLSummary[]> {
    let periodClause = ''

    if (period !== 'all') {
      const cutoffDate = new Date()
      switch (period) {
        case 'day':
          cutoffDate.setDate(cutoffDate.getDate() - 1)
          break
        case 'week':
          cutoffDate.setDate(cutoffDate.getDate() - 7)
          break
        case 'month':
          cutoffDate.setMonth(cutoffDate.getMonth() - 1)
          break
      }
      periodClause = ` AND tr.created_at >= '${cutoffDate.toISOString()}'`
    }

    // Get agents with their P&L for the period
    const result = await this.db.query<{
      agent_id: string
      period_pnl: number
    }>(
      `SELECT tr.agent_id, SUM(tr.pnl) as period_pnl
       FROM agent_trade_results tr
       WHERE 1=1 ${periodClause}
       GROUP BY tr.agent_id
       ORDER BY period_pnl DESC
       LIMIT ?`,
      [limit],
    )

    // Get full summary for each agent
    const summaries: AgentPnLSummary[] = []
    for (const row of result.rows) {
      const summary = await this.getPnLSummary(row.agent_id)
      summaries.push(summary)
    }

    return summaries
  }
}

/** Singleton instance */
export const agentPnLService = new AgentPnLService()
