/**
 * Trading Bot Types
 * 
 * Types for MEV/arbitrage trading bots integrated into Crucible
 */

import type { ChainId, ChainConfig, StrategyConfig, Opportunity, ProfitSource, Metrics } from './autocrat-types';
import type { TradingBotStrategy, TradingBotChain, TradingBotState, TradingBotMetrics, TradingBotConfig } from '../types';

export type { ChainId, ChainConfig, StrategyConfig, Opportunity, ProfitSource, Metrics };
export type { TradingBotStrategy, TradingBotChain, TradingBotState, TradingBotMetrics, TradingBotConfig };

export interface TradingBotDefinition {
  agentId: bigint;
  name: string;
  description: string;
  strategies: TradingBotStrategy[];
  chains: TradingBotChain[];
  treasuryAddress?: string;
  config: TradingBotConfig;
}

