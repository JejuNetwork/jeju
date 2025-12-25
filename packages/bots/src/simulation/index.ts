/**
 * Simulation & Backtesting Framework
 *
 * Provides:
 * - Historical price simulation
 * - Strategy backtesting with realistic economics
 * - Risk metrics calculation
 * - Monte Carlo simulation
 * - Statistical validation
 * - Stress testing (crashes, depegs)
 * - Flash loan integration testing
 * - MEV competition simulation
 * - Multi-chain opportunity scanning
 * - Visualization and reporting
 */

export type { BacktestResult } from '../types'
// Core simulation
export { type BacktestConfig, Backtester } from './backtester'
export { HistoricalDataFetcher, type PriceCandle } from './data-fetcher'
// Economic modeling
export {
  BridgeEconomics,
  createEconomicsCalculator,
  type EconomicConfig,
  GAS_COSTS,
  type GasCostEstimate,
  GasCostModel,
  ImpermanentLossCalculator,
  type LiquidityPool,
  MarketImpactModel,
  type MarketImpactResult,
  MEVRiskModel,
  type OrderBookDepth,
  SlippageModel,
  type SlippageResult,
  type TradeEconomics,
  TradeEconomicsCalculator,
} from './economics'
// Flash loan testing
export {
  type FlashLoanTestConfig,
  FlashLoanTester,
  type FlashLoanTestResult,
  runFlashLoanTests,
} from './flashloan-tests'
// Full validation pipeline
export {
  type FullValidationConfig,
  type FullValidationResult,
  FullValidationRunner,
} from './full-validation'
// Historical MEV analysis
export {
  type ChainMEVStats,
  type HistoricalAnalysisResult,
  HistoricalMEVAnalyzer,
  RealOpportunityFetcher,
} from './historical-mev-analyzer'
// MEV competition simulation
export {
  type BlockBuilder,
  type CompetitionSimResult,
  MEVCompetitionSimulator,
  type MEVSearcher,
  type MEVStrategy,
  runMEVCompetitionSim,
} from './mev-competition'
// Monte Carlo & Statistical Validation
export {
  createValidationSuite,
  type MonteCarloConfig,
  type MonteCarloResult,
  MonteCarloSimulator,
  type StatisticalTest,
  StatisticalValidator,
  type ValidationResult,
  ValidationSuite,
  WalkForwardAnalyzer,
  type WalkForwardResult,
} from './monte-carlo'

// Multi-chain scanning
export {
  type ChainPrice,
  type CrossChainOpportunity,
  createScanner,
  MultiChainScanner,
  type SameChainOpportunity,
  type ScannerConfig,
  type ScanResult,
} from './multi-chain-scanner'
// Multi-source data fetching
export {
  type DataSourceConfig,
  type GasDataPoint,
  type MEVOpportunity,
  MultiSourceFetcher,
  type PoolStateSnapshot,
  STRESS_SCENARIOS,
  type StressTestScenario,
  SUPPORTED_CHAINS,
} from './multi-source-fetcher'
export { PortfolioSimulator } from './portfolio-simulator'
// Multi-chain backtesting
export {
  MultiChainBacktester,
  type MultiChainBacktestResult,
} from './real-data-backtest'
// Realistic backtesting
export { RealisticBacktester } from './realistic-backtest'
export {
  type DrawdownAnalysis,
  RiskAnalyzer,
  type RiskMetrics,
} from './risk-analyzer'
// Stress testing
export {
  runStressTests,
  type StressTestConfig,
  type StressTestResult,
  StressTestRunner,
} from './stress-tests'
// Legacy test pipeline
export {
  TestPipeline,
  type TestPipelineConfig,
  type TestPipelineResult,
} from './test-runner'
// Visualization
export {
  ASCIICharts,
  type ChartConfig,
  HTMLReportGenerator,
  type ReportConfig,
  TerminalReport,
} from './visualizer'

// Scientific Benchmarking
export {
  ScientificBenchmark,
  Statistics,
} from './scientific-benchmark'

// Critical Review & Audit
export {
  LARP_AUDIT,
  printAuditReport,
  VALIDATED_BRIDGE_COSTS,
  VALIDATED_GAS_COSTS,
  VALIDATED_GAS_PRICES,
  VALIDATED_MARKET_IMPACT,
  VALIDATED_MEV_PARAMS,
} from './critical-review'
