/**
 * Jeju Bots Package
 *
 * Complete MEV, arbitrage, and yield optimization infrastructure.
 */

// Engine
export { BotEngine, type BotEngineConfig, type StrategyStats } from './engine'
export { WebSocketBlockSubscriber, createBlockSubscriber, type BlockEvent } from './engine/websocket-subscriber'
export { FlashbotsProtect, createFlashbotsProtect, type FlashbotsBundle } from './engine/flashbots-protect'
export { RPCManager, createRPCManager } from './engine/rpc-manager'
export { ExecutionSimulator, createExecutionSimulator } from './engine/execution-simulator'
export { PathOptimizer, createPathOptimizer, type Pool, type ArbitragePath } from './engine/path-optimizer'
export { PoolValidator, createPoolValidator, type PoolValidation, type TokenValidation } from './engine/pool-validator'

// Strategies - explicit exports to avoid conflicts
export {
  CrossChainArbitrage,
  SolanaArbitrage,
  FundingArbitrageBot,
  LiquidationBot,
} from './strategies'

export type {
  CrossChainArbConfig,
  SolanaArbConfig,
  FundingArbConfig,
  LiquidationBotConfig,
} from './strategies'

// MEV Strategies
export {
  JITLiquidityStrategy,
  BackrunStrategy,
  OracleArbStrategy,
  AtomicLiquidator,
} from './strategies/mev'

// Protocols
export {
  MorphoIntegration,
  IntentSolver,
  RateArbitrage,
  MEVShareClient,
  BuilderClient,
  createBuilderClient,
} from './protocols'

// Simulation - explicit to avoid conflicts
export {
  Backtester,
  HistoricalDataFetcher,
  PortfolioSimulator,
  RiskAnalyzer,
  MultiChainBacktester,
  RealisticBacktester,
} from './simulation'

// Oracles
export { OracleAggregator, ChainlinkOracle, PythOracle } from './oracles'

// Types
export type { BotStats, StrategyType, TradeResult } from './types'

// Config
export { getCrossChainArbConfig, getTFMMConfig } from './config'
