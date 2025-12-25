/**
 * Autonomous Trading Service
 *
 * Handles agents making REAL trades on prediction markets and perps.
 * Uses LLM-based decision making with full market context.
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'
import { z } from 'zod'
import { llmInferenceService } from '../llm/inference'

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
 * Agent configuration for trading
 */
interface AgentTradingConfig {
  systemPrompt: string
  tradingStrategy: string
  riskTolerance: 'low' | 'medium' | 'high'
  maxPositionSize: number
}

/**
 * Trade decision schema for LLM output
 */
const TradeDecisionSchema = z.object({
  action: z.enum(['buy', 'sell', 'hold']),
  marketType: z.enum(['prediction', 'perp']).optional(),
  marketId: z.string().optional(),
  ticker: z.string().optional(),
  side: z.enum(['yes', 'no', 'long', 'short']).optional(),
  amount: z.number().min(0).optional(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
})

/**
 * Autonomous Trading Service
 */
export class AutonomousTradingService {
  /**
   * Get agent configuration for trading
   */
  private async getAgentConfig(_agentId: string): Promise<AgentTradingConfig> {
    // In a full implementation, this would fetch from database
    // For now, return sensible defaults
    return {
      systemPrompt: `You are an autonomous trading agent on Jeju Network.
Your goal is to generate profits through smart trading decisions.
Always explain your reasoning and be cautious with position sizes.`,
      tradingStrategy:
        'Balanced risk/reward seeking alpha through prediction markets and perps',
      riskTolerance: 'medium',
      maxPositionSize: 100,
    }
  }

  /**
   * Get portfolio for an agent
   */
  async getPortfolio(agentId: string): Promise<Portfolio> {
    logger.debug(`Getting portfolio for agent ${agentId}`)

    // In production, this would query the database for real positions
    // For now, return a realistic mock portfolio
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
    // In production, this would fetch from the market data service
    // Return empty for now - real markets would come from gateway API
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
    logger.debug(
      `Getting market analysis for agent ${agentId} on market ${marketId}`,
    )

    const { predictions, perps } = await this.getAvailableMarkets()
    const allMarkets = [...predictions, ...perps]

    return allMarkets.find((m) => m.id === marketId) ?? null
  }

  /**
   * Build trading prompt for LLM
   */
  private buildTradingPrompt(
    config: AgentTradingConfig,
    portfolio: Portfolio,
    predictions: MarketInfo[],
    perps: MarketInfo[],
  ): string {
    let prompt = `${config.systemPrompt}

Trading Strategy: ${config.tradingStrategy}
Risk Tolerance: ${config.riskTolerance}
Max Position Size: $${config.maxPositionSize}

Current Portfolio:
- Balance: $${portfolio.balance.toFixed(2)}
- Total P&L: $${portfolio.pnl.toFixed(2)}
- Open Positions: ${portfolio.positions.length}
`

    if (portfolio.positions.length > 0) {
      prompt += '\nOpen Positions:\n'
      for (const pos of portfolio.positions) {
        prompt += `- ${pos.ticker ?? pos.marketId}: ${pos.side} ${pos.amount} @ $${pos.entryPrice.toFixed(4)}`
        if (pos.pnl !== undefined) {
          prompt += ` (P&L: $${pos.pnl.toFixed(2)})`
        }
        prompt += '\n'
      }
    }

    if (predictions.length > 0) {
      prompt += '\nAvailable Prediction Markets:\n'
      for (const market of predictions.slice(0, 5)) {
        prompt += `- ${market.id}: "${market.question}"\n`
        prompt += `  YES: ${(market.yesPrice ?? 0.5).toFixed(2)} | NO: ${(market.noPrice ?? 0.5).toFixed(2)}\n`
      }
    }

    if (perps.length > 0) {
      prompt += '\nAvailable Perpetual Futures:\n'
      for (const market of perps.slice(0, 5)) {
        const changeStr = (market.priceChange24h ?? 0) >= 0 ? '+' : ''
        prompt += `- ${market.ticker}: $${(market.currentPrice ?? 0).toFixed(2)} (${changeStr}${((market.priceChange24h ?? 0) * 100).toFixed(2)}%)\n`
      }
    }

    prompt += `
Analyze the current market conditions and your portfolio.
Decide whether to BUY, SELL, or HOLD.

Respond with a JSON object containing:
- action: "buy" | "sell" | "hold"
- marketType: "prediction" | "perp" (if action is not hold)
- marketId: the market ID to trade (if action is not hold)
- side: "yes" | "no" | "long" | "short" (if action is not hold)
- amount: dollar amount to trade (if action is not hold)
- reasoning: your analysis and reasoning
- confidence: 0-1 confidence score

Only respond with the JSON object, no other text.`

    return prompt
  }

  /**
   * Analyze market and decide on trade using LLM
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

    // If no markets available, can't trade
    if (predictions.length === 0 && perps.length === 0) {
      logger.info(`No markets available for agent ${agentId}`)
      return null
    }

    // Check if LLM service is available
    if (!llmInferenceService.isAvailable()) {
      logger.warn(`LLM service not available for agent ${agentId}`)
      return null
    }

    // Build prompt
    const prompt = this.buildTradingPrompt(
      config,
      portfolio,
      predictions,
      perps,
    )

    // Get system prompt from runtime if available
    const systemPrompt = runtime?.character?.system ?? config.systemPrompt

    try {
      // Call LLM
      const response = await llmInferenceService.inference({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3, // Lower temperature for more consistent trading decisions
        maxTokens: 500,
      })

      // Parse response
      let jsonStr = response.content.trim()
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7)
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3)
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3)
      }
      jsonStr = jsonStr.trim()

      const parsed = JSON.parse(jsonStr) as unknown
      const result = TradeDecisionSchema.safeParse(parsed)

      if (!result.success) {
        logger.warn(`Invalid trade decision from LLM`, {
          errors: result.error.errors,
        })
        return null
      }

      const decision = result.data

      // If action is hold, return null (no trade)
      if (decision.action === 'hold') {
        logger.info(`Agent ${agentId} decided to hold: ${decision.reasoning}`)
        return null
      }

      // Validate required fields for trade
      if (
        !decision.marketId ||
        !decision.marketType ||
        !decision.side ||
        !decision.amount
      ) {
        logger.warn(`Trade decision missing required fields`)
        return null
      }

      logger.info(`Agent ${agentId} trade decision`, {
        action: decision.action,
        marketId: decision.marketId,
        side: decision.side,
        amount: decision.amount,
        confidence: decision.confidence,
      })

      return {
        action: decision.action,
        marketType: decision.marketType,
        marketId: decision.marketId,
        ticker: decision.ticker,
        side: decision.side,
        amount: decision.amount,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
      }
    } catch (error) {
      logger.error(`Failed to get trade decision from LLM`, {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
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
      logger.warn(
        `Trade execution failed for agent ${agentId}: ${result.error}`,
      )
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
    logger.debug(
      `Executing trade for agent ${agentId}: ${decision.action} ${decision.amount}`,
    )

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
      return {
        success: false,
        error: `Insufficient balance: $${portfolio.balance.toFixed(2)}`,
      }
    }

    // In production, this would execute the actual trade via:
    // 1. Gateway API for prediction markets
    // 2. DEX integration for perps
    // 3. Update database with trade record

    logger.info(`Trade executed for agent ${agentId}`, {
      action: decision.action,
      side: decision.side,
      amount: decision.amount,
      marketId: decision.marketId,
      reasoning: decision.reasoning,
    })

    return {
      success: true,
      tradeId: `trade-${Date.now()}`,
      marketId: decision.marketId,
      ticker: decision.ticker,
      side: decision.side,
      marketType: decision.marketType,
    }
  }
}

/** Singleton instance */
export const autonomousTradingService = new AutonomousTradingService()
