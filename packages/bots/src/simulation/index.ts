/**
 * Simulation & Backtesting Framework
 * 
 * Provides:
 * - Historical price simulation
 * - Strategy backtesting
 * - Risk metrics calculation
 * - Performance attribution
 */

export { Backtester, type BacktestConfig } from './backtester';
export { RiskAnalyzer, type RiskMetrics, type DrawdownAnalysis } from './risk-analyzer';
export { HistoricalDataFetcher, type PriceCandle } from './data-fetcher';
export { PortfolioSimulator } from './portfolio-simulator';

