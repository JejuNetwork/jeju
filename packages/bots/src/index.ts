/**
 * Jeju Bots Package
 *
 * Complete MEV, arbitrage, and yield optimization infrastructure.
 */

// Config
export { getCrossChainArbConfig, getTFMMConfig } from './config'
// DWS Integration
export {
  DWSClient,
  getDWSClient,
  resetDWSClient,
  type DWSClientConfig,
  type DWSRequestOptions,
  type DWSResponse,
} from './dws'
// Engine
export { BotEngine, type BotEngineConfig, type StrategyStats } from './engine'
export {
  createExecutionSimulator,
  ExecutionSimulator,
} from './engine/execution-simulator'
export {
  createFlashbotsProtect,
  type FlashbotsBundle,
  FlashbotsProtect,
} from './engine/flashbots-protect'
export {
  type ArbitragePath,
  createPathOptimizer,
  PathOptimizer,
  type Pool,
} from './engine/path-optimizer'
export {
  createPoolValidator,
  type PoolValidation,
  PoolValidator,
  type TokenValidation,
} from './engine/pool-validator'
export { createRPCManager, RPCManager } from './engine/rpc-manager'
export {
  type BlockEvent,
  createBlockSubscriber,
  WebSocketBlockSubscriber,
} from './engine/websocket-subscriber'
// Oracles
export { OracleAggregator } from './oracles'
// Protocols
export {
  BuilderClient,
  createBuilderClient,
  IntentSolver,
  MEVShareClient,
  MorphoIntegration,
  RateArbitrage,
} from './protocols'
// Simulation - explicit to avoid conflicts
export {
  Backtester,
  HistoricalDataFetcher,
  MultiChainBacktester,
  PortfolioSimulator,
  RealisticBacktester,
  RiskAnalyzer,
} from './simulation'
export type {
  CrossChainArbConfig,
  FundingArbConfig,
  LiquidationBotConfig,
  SolanaArbConfig,
} from './strategies'
// Strategies - explicit exports to avoid conflicts
export {
  CrossChainArbitrage,
  FundingArbitrageBot,
  LiquidationBot,
  SolanaArbitrage,
} from './strategies'
// MEV Strategies
export {
  AtomicLiquidator,
  BackrunStrategy,
  JITLiquidityStrategy,
  OracleArbStrategy,
} from './strategies/mev'
// Types
export type { BotStats, StrategyType, TradeResult } from './types'
