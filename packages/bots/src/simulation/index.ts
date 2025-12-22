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

// Economic modeling
export {
  SlippageModel,
  MarketImpactModel,
  GasCostModel,
  BridgeEconomics,
  MEVRiskModel,
  TradeEconomicsCalculator,
  ImpermanentLossCalculator,
  createEconomicsCalculator,
  GAS_COSTS,
  type LiquidityPool,
  type OrderBookDepth,
  type SlippageResult,
  type MarketImpactResult,
  type GasCostEstimate,
  type TradeEconomics,
  type EconomicConfig,
} from './economics'

// Monte Carlo & Statistical Validation
export {
  MonteCarloSimulator,
  StatisticalValidator,
  WalkForwardAnalyzer,
  ValidationSuite,
  createValidationSuite,
  type MonteCarloConfig,
  type MonteCarloResult,
  type StatisticalTest,
  type ValidationResult,
  type WalkForwardResult,
} from './monte-carlo'

// Visualization
export {
  ASCIICharts,
  TerminalReport,
  HTMLReportGenerator,
  type ChartConfig,
  type ReportConfig,
} from './visualizer'

// Full validation pipeline
export {
  FullValidationRunner,
  type FullValidationConfig,
  type FullValidationResult,
} from './full-validation'

// Legacy test pipeline
export {
  TestPipeline,
  type TestPipelineConfig,
  type TestPipelineResult,
} from './test-runner'
