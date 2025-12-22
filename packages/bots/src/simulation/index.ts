/**
 * Simulation & Backtesting Framework
 *
 * Provides:
 * - Historical price simulation
 * - Strategy backtesting
 * - Risk metrics calculation
 * - Performance attribution
 */

export { type BacktestConfig, Backtester } from './backtester'
export { HistoricalDataFetcher, type PriceCandle } from './data-fetcher'
export { PortfolioSimulator } from './portfolio-simulator'
export {
  type DrawdownAnalysis,
  RiskAnalyzer,
  type RiskMetrics,
} from './risk-analyzer'
