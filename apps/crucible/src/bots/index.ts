/**
 * MEV Trading Bot Module
 *
 * Complete infrastructure for MEV extraction and automated trading:
 *
 * @example
 * ```typescript
 * import {
 *   TradingBot,
 *   DexArbitrageStrategy,
 *   MevBundler,
 *   FlashLoanExecutor,
 *   GasOracle,
 *   RiskManager,
 * } from '@jejunetwork/crucible/bots';
 *
 * // Initialize components
 * const gasOracle = new GasOracle();
 * await gasOracle.initialize([{ chainId: 1, rpcUrl: 'https://...' }]);
 *
 * const riskManager = new RiskManager({
 *   maxPositionSizeWei: BigInt(10e18),
 *   maxDailyLossWei: BigInt(1e18),
 * });
 *
 * const bundler = new MevBundler(privateKey, 1);
 *
 * // Create strategy
 * const arbStrategy = new DexArbitrageStrategy(1, { minProfitBps: 50 });
 * arbStrategy.initialize(pools);
 *
 * // Execute opportunities
 * const opportunities = arbStrategy.getOpportunities();
 * ```
 */

export { main as startBot, startBotAPIServer } from './api-server'
// ============ Types ============
export type {
  ArbitrageOpportunity,
  AutocratConfig,
  ChainConfig,
  ChainId,
  CrossChainArbOpportunity,
  LiquidationOpportunity,
  Opportunity,
  OpportunityExecutionResult,
  Pool,
  PoolType,
  SandwichOpportunity,
  StrategyConfig,
  StrategyType,
  Token,
} from './autocrat-types'
export {
  createTradingBotOptions,
  DEFAULT_BOTS,
  DEFAULT_CHAINS,
  type DefaultBotConfig,
  getDefaultBotsForNetwork,
} from './default-bots'
// ============ Engine (Infrastructure) ============
export {
  ARBITRAGE_EXECUTOR_SOLIDITY,
  type BlockEvent,
  type BundleParams,
  type BundleResult,
  type BundleTransaction,
  type ContractAddresses,
  calculateArbitrageGas,
  calculateSwapGas,
  createMempoolStreamer,
  DEFAULT_RISK_CONFIG,
  // Data collection
  EventCollector,
  type ExecutorConfig,
  type FlashLoanConfig,
  // Flash loans
  FlashLoanExecutor,
  type FlashLoanParams,
  type FlashLoanResult,
  GAS_ESTIMATES,
  // Gas estimation
  GasOracle,
  type MempoolConfig,
  // Mempool streaming
  MempoolStreamer,
  type MempoolTransaction,
  // Bundle submission
  MevBundler,
  type MevShareHint,
  type PendingTransaction,
  type RiskConfig,
  // Risk management
  RiskManager,
  type SimulationResult,
  type SwapEvent,
  type SyncEvent,
  // Transaction execution
  TransactionExecutor,
  type TreasuryConfig,
  // Treasury
  TreasuryManager,
} from './engine'
export { BotInitializer, type BotInitializerConfig } from './initializer'
// ============ Math & Utilities ============
export {
  AUTOCRAT_TREASURY_ABI,
  bigintAbsDiff,
  bigintMax,
  bigintMin,
  bigintPow,
  // BigInt helpers
  bigintSqrt,
  CHAINLINK_AGGREGATOR_ABI,
  calculateMinProfitableTradeSize,
  calculateNetProfit,
  // Optimal sizing
  calculateOptimalCrossPoolArbitrage,
  calculateOptimalMultiHopArbitrage,
  calculateOptimalSandwich,
  calculateOptimalTriangularArbitrage,
  calculateV2V3Arbitrage,
  calculateV3SwapOutput,
  type DecodedSwap,
  // Transaction decoders
  decodeSwapTransaction,
  // Contract ABIs
  ERC20_ABI,
  // Gas calculations
  estimateGasCostWei,
  // Uniswap V3
  FEE_TIERS,
  type FeeTier,
  getAllSwapSelectors,
  getAmountIn,
  // AMM math
  getAmountOut,
  getEffectivePrice,
  getPriceImpactBps,
  getSpotPrice,
  isSwapSelector,
  PERPETUAL_MARKET_ABI,
  PRICE_ORACLE_ABI,
  sqrtPriceX96ToTick,
  tickToSqrtPriceX96,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_ROUTER_ABI,
  type V3PoolState,
  XLP_ROUTER_ABI,
  XLP_V2_FACTORY_ABI,
  XLP_V2_PAIR_ABI,
  ZERO_ADDRESS,
} from './lib'
// ============ Solana DEX Adapters ============
export {
  type DexSource,
  JupiterAdapter,
  type LiquidityPool as SolanaPool,
  type LiquidityPosition as SolanaPosition,
  MeteoraAdapter,
  OrcaAdapter,
  RaydiumAdapter,
  SolanaDexAggregator,
  type SwapQuote,
} from './solana'
// ============ Strategies ============
export {
  CrossChainArbStrategy,
  DexArbitrageStrategy,
  type FarmPosition,
  LiquidationStrategy,
  LiquidityManager,
  OracleKeeperStrategy,
  type PoolAnalysis,
  type RebalanceAction,
  type RiskLevel,
  SandwichStrategy,
  SolanaArbStrategy,
  SolverStrategy,
  type UnifiedPosition,
  type YieldFarmingConfig,
  YieldFarmingStrategy,
  type YieldOpportunity,
  type YieldSource,
} from './strategies'
// ============ Core Trading Bot ============
export { TradingBot, type TradingBotOptions } from './trading-bot'
// ============ Unified Bot ============
export {
  type BotStats,
  type TradeResult,
  UnifiedBot,
  type UnifiedBotConfig,
} from './unified-bot'
