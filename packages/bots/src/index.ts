/**
 * Jeju Bots Package
 * 
 * Provides MEV, arbitrage, liquidity management, and TFMM strategies
 * for the Jeju Network.
 */

// Types
export * from './types';

// Schemas (Zod validation)
export * from './schemas';

// Shared utilities
export * from './shared';

// Oracle Integration
export { OracleAggregator, TOKEN_SYMBOLS, getTokenSymbol } from './oracles';

// Strategies
export * from './strategies';

// Simulation
export * from './simulation';

// Engine
export { BotEngine } from './engine';
export type { BotEngineConfig, StrategyStats } from './engine';

// Re-export key types for convenience
export type {
  EVMChainId,
  Token,
  Pool,
  TFMMPool,
  ArbitrageOpportunity,
  CrossChainArbOpportunity,
  BacktestResult,
  RiskMetrics,
  BotStats,
  TradeResult,
} from './types';

