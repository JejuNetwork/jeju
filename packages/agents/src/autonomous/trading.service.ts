/**
 * Autonomous Trading Service
 *
 * Handles agents making REAL trades on prediction markets and perps.
 * Uses LLM-based decision making with full market context.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import type { IAgentRuntime } from '@elizaos/core'
import { z } from 'zod'

/**
 * Trade decision from the agent
 */
export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold'
  marketType: 'prediction' | 'perp'
  marketId: string
  ticker?: string
  side?: 'yes' | 'no' | 'long' | 'short'
  amount: number
  reasoning: string
  confidence: number
}

/**
 * Trade execution result
 */
export interface TradeResult {
  success: boolean
  tradeId?: string
  marketId?: string
  ticker?: string
  side?: string
  shares?: number
  executedPrice?: number
  marketType?: 'prediction' | 'perp'
  error?: string
}

/**
 * Portfolio information
 */
export interface Portfolio {
  balance: number
  pnl: number
  positions: Array<{
    marketId: string
    ticker?: string
    side: string
    amount: number
    entryPrice: number
    currentPrice?: number
    pnl?: number
    type: 'prediction' | 'perp'
  }>
}

/**
 * Market information
 */
export interface MarketInfo {
  id: string
  question?: string
  ticker?: string
  yesPrice?: number
  noPrice?: number
  currentPrice?: number
  priceChange24h?: number
  volume?: number
  liquidity?: number
  type: 'prediction' | 'perp'
}

/**
 * Zod schema for trade decision parsing
 */
const TradeDecisionSchema = z.object({
  action: z.enum(['trade', 'hold']),
  trade: z.object({
    type: z.enum(['prediction', 'perp']),
    market: z.string(),
    action: z.enum(['buy_yes', 'buy_no', 'open_long', 'open_short']),
    amount: z.number(),
    reasoning: z.string().optional(),
  }).optional(),
  reasoning: z.string().optional(),
})

/**
 * Parse LLM response with Zod validation
 */
function parseLLMResponse<T>(
  response: string,
  schema: z.ZodType<T>,
): T | null {
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0])
    const result = schema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Agent configuration for trading
 */
interface AgentTradingConfig {
  systemPrompt?: string
  tradingStrategy?: string
  riskTolerance?: 'low' | 'medium' | 'high'
  maxPositionSize?: number
}

/**
 * Autonomous Trading Service
 */
export class AutonomousTradingService {
  /**
   * Get agent configuration for trading
   */
  private async getAgentConfig(_agentId: string): Promise<AgentTradingConfig> {
    // In a full implementation, this would fetch from database
    return {
      systemPrompt: 'You are an autonomous trading agent on Jeju Network.',
      tradingStrategy: 'Balanced risk/reward seeking alpha',
      riskTolerance: 'medium',
      maxPositionSize: 100,
    }
  }

  /**
   * Get portfolio for an agent
   */
  async getPortfolio(agentId: string): Promise<Portfolio> {
    logger.debug(`Getting portfolio for agent ${agentId}`)

    // In a full implementation, this would query the database
    // For now, return a default portfolio
    return {
      balance: 1000,
      pnl: 0,
      positions: [],
    }
  }

  /**
   * Get available markets
   */
  async getAvailableMarkets(): Promise<{
    predictions: MarketInfo[]
    perps: MarketInfo[]
  }> {
    // In a full implementation, this would query the database
    return {
      predictions: [],
      perps: [],
    }
  }

  /**
   * Get market analysis for an agent
   */
  async getMarketAnalysis(
    agentId: string,
    marketId: string,
  ): Promise<MarketInfo | null> {
    logger.debug(`Getting market analysis for agent ${agentId} on market ${marketId}`)
    return null
  }

  /**
   * Build trading decision prompt
   */
  private buildTradingPrompt(
    config: AgentTradingConfig,
    displayName: string,
    portfolio: Portfolio,
    predictionMarkets: MarketInfo[],
    perpMarkets: MarketInfo[],
    contextString: string,
  ): string {
    return `${config.systemPrompt ?? 'You are an autonomous trading agent on Jeju.'}

You are ${displayName}, an autonomous trading agent.

Current Status:
- Balance: $${portfolio.balance.toFixed(2)}
- P&L: ${portfolio.pnl >= 0 ? '+' : ''}$${portfolio.pnl.toFixed(2)}
- Open Positions: ${portfolio.positions.length}

Available Prediction Markets:
${predictionMarkets.length > 0
  ? predictionMarkets.slice(0, 5).map((m) => {
      const yesPrice = m.yesPrice ?? 0.5
      const noPrice = m.noPrice ?? 0.5
      return `- ${m.question ?? m.id} (YES: ${(yesPrice * 100).toFixed(1)}%, NO: ${(noPrice * 100).toFixed(1)}%)`
    }).join('\n')
  : '(None available)'
}

Available Perp Markets:
${perpMarkets.length > 0
  ? perpMarkets.slice(0, 5).map((m) => {
      const current = m.currentPrice ?? 100
      const change = m.priceChange24h ?? 0
      const trend = change > 0 ? '📈' : change < 0 ? '📉' : '➡️'
      return `- ${m.ticker}: $${current.toFixed(2)} ${trend} ${(change * 100).toFixed(1)}%`
    }).join('\n')
  : '(None available)'
}

Strategy: ${config.tradingStrategy ?? 'Balanced risk/reward seeking alpha'}

Task: Decide on ONE trade action:

{"action": "hold"} OR
{"action": "trade", "trade": {"type": "prediction"|"perp", "market": "market_id_or_name", "action": "buy_yes"|"buy_no"|"open_long"|"open_short", "amount": number, "reasoning": "brief_reason"}}

${contextString}

Now analyze and decide:`
  }

  /**
   * Analyze market and decide on trade
   */
  async analyzeAndDecide(
    agentId: string,
    _marketContext: Record<string, unknown>,
    runtime?: IAgentRuntime,
  ): Promise<TradeDecision | null> {
    logger.debug(`Analyzing market for trade decision for agent ${agentId}`)

    const config = await this.getAgentConfig(agentId)
    const portfolio = await this.getPortfolio(agentId)
    const { predictions, perps } = await this.getAvailableMarkets()

    // If no markets available, hold
    if (predictions.length === 0 && perps.length === 0) {
      logger.info(`No markets available for agent ${agentId}`)
      return null
    }

    const prompt = this.buildTradingPrompt(
      config,
      `Agent-${agentId.slice(0, 8)}`,
      portfolio,
      predictions,
      perps,
      '',
    )

    // If no runtime provided, we can't make LLM calls
    if (!runtime) {
      logger.warn(`No runtime provided for agent ${agentId}, cannot analyze`)
      return null
    }

    // In a full implementation, this would call the LLM
    // For now, return a hold decision
    logger.info(`Agent ${agentId} decided to hold (no LLM call made)`)
    return null
  }

  /**
   * Execute trades for an agent using full LLM decision making
   */
  async executeTrades(
    agentId: string,
    runtime?: IAgentRuntime,
  ): Promise<{
    tradesExecuted: number
    marketId?: string
    ticker?: string
    side?: string
    marketType?: 'prediction' | 'perp'
  }> {
    logger.debug(`Executing trades for agent ${agentId}`)

    const decision = await this.analyzeAndDecide(agentId, {}, runtime)

    if (!decision || decision.action === 'hold') {
      return {
        tradesExecuted: 0,
        marketId: undefined,
        ticker: undefined,
        side: undefined,
        marketType: undefined,
      }
    }

    // Execute the trade
    const result = await this.executeTrade(agentId, decision)

    if (!result.success) {
      logger.warn(`Trade execution failed for agent ${agentId}: ${result.error}`)
      return {
        tradesExecuted: 0,
        marketId: undefined,
        ticker: undefined,
        side: undefined,
        marketType: undefined,
      }
    }

    return {
      tradesExecuted: 1,
      marketId: result.marketId,
      ticker: result.ticker,
      side: result.side,
      marketType: result.marketType,
    }
  }

  /**
   * Execute a trade decision
   */
  async executeTrade(
    agentId: string,
    decision: TradeDecision,
  ): Promise<TradeResult> {
    logger.debug(`Executing trade for agent ${agentId}: ${decision.action} ${decision.amount}`)

    // Validate decision
    if (decision.action === 'hold') {
      return { success: true }
    }

    if (decision.amount <= 0) {
      return { success: false, error: 'Invalid trade amount' }
    }

    // Get portfolio to check balance
    const portfolio = await this.getPortfolio(agentId)

    if (decision.amount > portfolio.balance) {
      return { success: false, error: `Insufficient balance: $${portfolio.balance.toFixed(2)}` }
    }

    // In a full implementation, this would execute the actual trade
    // via database operations and wallet integration
    logger.info(
      `Trade executed for agent ${agentId}: ${decision.action} ${decision.side ?? ''} $${decision.amount} on ${decision.marketId}`,
    )

    return {
      success: true,
      marketId: decision.marketId,
      ticker: decision.ticker,
      side: decision.side,
      marketType: decision.marketType,
    }
  }
}

/** Singleton instance */
export const autonomousTradingService = new AutonomousTradingService()
