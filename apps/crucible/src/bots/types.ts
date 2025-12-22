/**
 * Trading Bot Types
 *
 * Types for MEV/arbitrage trading bots integrated into Crucible
 */

import type {
  TradingBotChain,
  TradingBotConfig,
  TradingBotMetrics,
  TradingBotState,
  TradingBotStrategy,
} from '../types'
import type {
  ChainConfig,
  ChainId,
  Metrics,
  Opportunity,
  ProfitSource,
  StrategyConfig,
} from './autocrat-types-source'

export type {
  ChainId,
  ChainConfig,
  StrategyConfig,
  Opportunity,
  ProfitSource,
  Metrics,
}
export type {
  TradingBotStrategy,
  TradingBotChain,
  TradingBotState,
  TradingBotMetrics,
  TradingBotConfig,
}

export interface TradingBotDefinition {
  agentId: bigint
  name: string
  description: string
  strategies: TradingBotStrategy[]
  chains: TradingBotChain[]
  treasuryAddress?: string
  config: TradingBotConfig
}
