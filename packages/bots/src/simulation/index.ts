/**
 * Simulation & Backtesting Framework
 *
 * Provides:
 * - Historical price simulation
 * - Strategy backtesting
 * - Risk metrics calculation
 * - Performance attribution
 * - Stress testing (crashes, depegs)
 * - Flash loan integration testing
 * - MEV competition simulation
 * - Multi-chain opportunity scanning
 */

// Core simulation
export { type BacktestConfig, type BacktestResult, Backtester } from './backtester'
export { HistoricalDataFetcher, type PriceCandle } from './data-fetcher'
export { PortfolioSimulator } from './portfolio-simulator'
export {
  type DrawdownAnalysis,
  RiskAnalyzer,
  type RiskMetrics,
} from './risk-analyzer'

// Multi-source data fetching
export {
  MultiSourceFetcher,
  SUPPORTED_CHAINS,
  STRESS_SCENARIOS,
  type DataSourceConfig,
  type GasDataPoint,
  type MEVOpportunity,
  type PoolStateSnapshot,
  type StressTestScenario,
} from './multi-source-fetcher'

// Stress testing
export {
  StressTestRunner,
  runStressTests,
  type StressTestConfig,
  type StressTestResult,
} from './stress-tests'

// Flash loan testing
export {
  FlashLoanTester,
  runFlashLoanTests,
  type FlashLoanTestConfig,
  type FlashLoanTestResult,
} from './flashloan-tests'

// MEV competition simulation
export {
  MEVCompetitionSimulator,
  runMEVCompetitionSim,
  type MEVSearcher,
  type MEVStrategy,
  type BlockBuilder,
  type CompetitionSimResult,
} from './mev-competition'

// Multi-chain scanning
export {
  MultiChainScanner,
  createScanner,
  type ChainPrice,
  type CrossChainOpportunity,
  type SameChainOpportunity,
  type ScanResult,
  type ScannerConfig,
} from './multi-chain-scanner'

// Full test pipeline
export {
  TestPipeline,
  type TestPipelineConfig,
  type TestPipelineResult,
} from './test-runner'
