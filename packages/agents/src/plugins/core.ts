/**
 * Core Agent Plugin
 *
 * Base plugin providing core Jeju agent capabilities for ElizaOS.
 * Includes trading, social, and A2A communication actions.
 *
 * @packageDocumentation
 */

import type { Action, Evaluator, Plugin, Provider } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'
import { autonomousA2AService } from '../autonomous/a2a.service'
import { autonomousTradingService } from '../autonomous/trading.service'
import { getJejuProvider } from '../llm/provider'

/**
 * Core plugin configuration
 */
export interface CorePluginConfig {
  enableTrading?: boolean
  enableSocial?: boolean
  enableA2A?: boolean
}

/**
 * Trading action - Execute trades on prediction markets and perps
 */
const tradeAction: Action = {
  name: 'EXECUTE_TRADE',
  description: 'Execute a trade on prediction markets or perpetual futures',
  examples: [
    [
      { user: 'user', content: { text: 'Buy $50 of YES on market abc123' } },
      { user: 'assistant', content: { text: 'Executing trade: BUY YES $50 on market abc123' } },
    ],
  ],
  similes: ['trade', 'buy', 'sell', 'long', 'short', 'open position', 'close position'],
  validate: async (runtime, message) => {
    const text = typeof message.content === 'string' ? message.content : message.content?.text
    if (!text) return false
    const tradeKeywords = ['buy', 'sell', 'long', 'short', 'trade', 'position']
    return tradeKeywords.some((kw) => text.toLowerCase().includes(kw))
  },
  handler: async (runtime, message, state) => {
    const agentId = runtime.agentId
    const text = typeof message.content === 'string' ? message.content : message.content?.text ?? ''

    logger.info(`Trade action triggered for agent ${agentId}`, { text })

    // Use the trading service to execute
    const result = await autonomousTradingService.executeTrades(agentId, runtime)

    if (result.tradesExecuted > 0) {
      return {
        success: true,
        data: {
          tradesExecuted: result.tradesExecuted,
          marketId: result.marketId,
          side: result.side,
          marketType: result.marketType,
        },
      }
    }

    return {
      success: false,
      error: 'No trades executed',
    }
  },
}

/**
 * A2A message action - Send message to another agent
 */
const a2aMessageAction: Action = {
  name: 'A2A_MESSAGE',
  description: 'Send a message to another agent via A2A protocol',
  examples: [
    [
      { user: 'user', content: { text: 'Ask agent-xyz for their market analysis' } },
      { user: 'assistant', content: { text: 'Sending A2A message to agent-xyz' } },
    ],
  ],
  similes: ['message agent', 'ask agent', 'contact agent', 'collaborate with'],
  validate: async (runtime, message) => {
    const text = typeof message.content === 'string' ? message.content : message.content?.text
    if (!text) return false
    return text.toLowerCase().includes('agent') && (
      text.toLowerCase().includes('ask') ||
      text.toLowerCase().includes('message') ||
      text.toLowerCase().includes('contact')
    )
  },
  handler: async (runtime, message) => {
    const agentId = runtime.agentId
    const text = typeof message.content === 'string' ? message.content : message.content?.text ?? ''

    // Extract target agent ID from message
    const agentMatch = text.match(/agent[- ]?(\w+)/i)
    if (!agentMatch) {
      return {
        success: false,
        error: 'Could not identify target agent',
      }
    }

    const targetAgentId = agentMatch[1]

    logger.info(`A2A action: ${agentId} -> ${targetAgentId}`)

    const response = await autonomousA2AService.sendMessage(
      agentId,
      targetAgentId,
      { query: text },
    )

    return {
      success: response.success,
      data: response.response,
      error: response.error,
    }
  },
}

/**
 * Discover agents action - Find agents with specific capabilities
 */
const discoverAgentsAction: Action = {
  name: 'DISCOVER_AGENTS',
  description: 'Discover other agents with specific skills or capabilities',
  examples: [
    [
      { user: 'user', content: { text: 'Find agents that can analyze prediction markets' } },
      { user: 'assistant', content: { text: 'Discovering agents with market analysis capabilities...' } },
    ],
  ],
  similes: ['find agents', 'discover agents', 'search agents', 'which agents'],
  validate: async (runtime, message) => {
    const text = typeof message.content === 'string' ? message.content : message.content?.text
    if (!text) return false
    const discoverKeywords = ['find', 'discover', 'search', 'which', 'list']
    return discoverKeywords.some((kw) => text.toLowerCase().includes(kw)) &&
           text.toLowerCase().includes('agent')
  },
  handler: async (runtime, message) => {
    const agentId = runtime.agentId
    const text = typeof message.content === 'string' ? message.content : message.content?.text ?? ''

    // Extract skills from message
    const skills: string[] = []
    if (text.includes('trading') || text.includes('trade')) skills.push('trading')
    if (text.includes('analysis') || text.includes('analyze')) skills.push('analysis')
    if (text.includes('prediction')) skills.push('prediction_markets')
    if (text.includes('social')) skills.push('social')

    const agents = await autonomousA2AService.discoverAgents(agentId, { skills })

    return {
      success: true,
      data: { agents, count: agents.length },
    }
  },
}

/**
 * Portfolio provider - Provides current portfolio state to the agent
 */
const portfolioProvider: Provider = {
  get: async (runtime, message, state) => {
    const agentId = runtime.agentId
    const portfolio = await autonomousTradingService.getPortfolio(agentId)

    return `Current Portfolio:
- Balance: $${portfolio.balance.toFixed(2)}
- P&L: $${portfolio.pnl.toFixed(2)}
- Open Positions: ${portfolio.positions.length}
${portfolio.positions.map((p) =>
  `  - ${p.ticker ?? p.marketId}: ${p.side} ${p.amount} @ $${p.entryPrice.toFixed(4)}`
).join('\n')}`
  },
}

/**
 * Market data provider - Provides current market information
 */
const marketDataProvider: Provider = {
  get: async (runtime, message, state) => {
    const { predictions, perps } = await autonomousTradingService.getAvailableMarkets()

    let marketInfo = 'Available Markets:\n\n'

    if (predictions.length > 0) {
      marketInfo += 'Prediction Markets:\n'
      for (const market of predictions.slice(0, 5)) {
        marketInfo += `- ${market.question ?? market.id}: YES ${(market.yesPrice ?? 0.5).toFixed(2)} / NO ${(market.noPrice ?? 0.5).toFixed(2)}\n`
      }
    }

    if (perps.length > 0) {
      marketInfo += '\nPerpetual Futures:\n'
      for (const market of perps.slice(0, 5)) {
        marketInfo += `- ${market.ticker}: $${(market.currentPrice ?? 0).toFixed(2)} (${(market.priceChange24h ?? 0) > 0 ? '+' : ''}${((market.priceChange24h ?? 0) * 100).toFixed(2)}%)\n`
      }
    }

    return marketInfo
  },
}

/**
 * Risk evaluator - Evaluates if a proposed action is within risk tolerance
 */
const riskEvaluator: Evaluator = {
  name: 'RISK_EVALUATOR',
  description: 'Evaluates if proposed actions are within agent risk tolerance',
  similes: ['risk check', 'safety check'],
  examples: [],
  validate: async (runtime, message) => {
    const text = typeof message.content === 'string' ? message.content : message.content?.text
    if (!text) return false
    // Run on trade-related messages
    const tradeKeywords = ['buy', 'sell', 'long', 'short', 'trade', 'position', 'leverage']
    return tradeKeywords.some((kw) => text.toLowerCase().includes(kw))
  },
  handler: async (runtime, message) => {
    const agentId = runtime.agentId
    const portfolio = await autonomousTradingService.getPortfolio(agentId)

    // Check if agent has sufficient balance
    if (portfolio.balance < 10) {
      return {
        pass: false,
        reason: 'Insufficient balance for trading',
      }
    }

    // Check position concentration
    if (portfolio.positions.length >= 10) {
      return {
        pass: false,
        reason: 'Too many open positions, consider closing some first',
      }
    }

    return {
      pass: true,
      reason: 'Risk check passed',
    }
  },
}

/**
 * Create the core agent plugin for ElizaOS
 */
export function createCorePlugin(config: CorePluginConfig = {}): Plugin {
  const actions: Action[] = []
  const providers: Provider[] = []
  const evaluators: Evaluator[] = []

  // Add trading capabilities
  if (config.enableTrading !== false) {
    actions.push(tradeAction)
    providers.push(portfolioProvider, marketDataProvider)
    evaluators.push(riskEvaluator)
  }

  // Add A2A capabilities
  if (config.enableA2A !== false) {
    actions.push(a2aMessageAction, discoverAgentsAction)
  }

  return {
    name: 'jeju-agent-core',
    description: 'Core Jeju agent capabilities - trading, social, A2A',
    actions,
    providers,
    evaluators,
    services: [],
  }
}

/** Default core plugin */
export const corePlugin = createCorePlugin()
