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

// ============ Core Trading Bot ============
export { TradingBot, type TradingBotOptions } from './trading-bot';
export { 
  DEFAULT_BOTS,
  DEFAULT_CHAINS,
  getDefaultBotsForNetwork,
  createTradingBotOptions,
  type DefaultBotConfig,
} from './default-bots';
export { BotInitializer, type BotInitializerConfig } from './initializer';

// ============ Strategies ============
export {
  DexArbitrageStrategy,
  SandwichStrategy,
  CrossChainArbStrategy,
  LiquidationStrategy,
  SolverStrategy,
  OracleKeeperStrategy,
  SolanaArbStrategy,
  LiquidityManager,
  type UnifiedPosition,
  type RebalanceAction,
  type PoolAnalysis,
  YieldFarmingStrategy,
  type YieldOpportunity,
  type FarmPosition,
  type YieldFarmingConfig,
  type YieldSource,
  type RiskLevel,
} from './strategies';

// ============ Solana DEX Adapters ============
export {
  SolanaDexAggregator,
  JupiterAdapter,
  RaydiumAdapter,
  OrcaAdapter,
  MeteoraAdapter,
  type SwapQuote,
  type LiquidityPool as SolanaPool,
  type LiquidityPosition as SolanaPosition,
  type DexSource,
} from './solana';

// ============ Unified Bot ============
export { UnifiedBot, type UnifiedBotConfig, type BotStats, type TradeResult } from './unified-bot';
export { startBotAPIServer, main as startBot } from './api-server';

// ============ Engine (Infrastructure) ============
export {
  // Mempool streaming
  MempoolStreamer,
  createMempoolStreamer,
  type MempoolTransaction,
  type MempoolConfig,
  
  // Bundle submission
  MevBundler,
  type BundleTransaction,
  type BundleParams,
  type BundleResult,
  type SimulationResult,
  type MevShareHint,
  
  // Flash loans
  FlashLoanExecutor,
  ARBITRAGE_EXECUTOR_SOLIDITY,
  type FlashLoanConfig,
  type FlashLoanParams,
  type FlashLoanResult,
  
  // Gas estimation
  GasOracle,
  GAS_ESTIMATES,
  calculateSwapGas,
  calculateArbitrageGas,
  
  // Risk management
  RiskManager,
  DEFAULT_RISK_CONFIG,
  type RiskConfig,
  
  // Data collection
  EventCollector,
  type SyncEvent,
  type SwapEvent,
  type BlockEvent,
  type PendingTransaction,
  
  // Transaction execution
  TransactionExecutor,
  type ContractAddresses,
  type ExecutorConfig,
  
  // Treasury
  TreasuryManager,
  type TreasuryConfig,
} from './engine';

// ============ Math & Utilities ============
export {
  // BigInt helpers
  bigintSqrt,
  bigintPow,
  bigintMin,
  bigintMax,
  bigintAbsDiff,
  
  // AMM math
  getAmountOut,
  getAmountIn,
  getSpotPrice,
  getEffectivePrice,
  getPriceImpactBps,
  
  // Optimal sizing
  calculateOptimalCrossPoolArbitrage,
  calculateOptimalTriangularArbitrage,
  calculateOptimalMultiHopArbitrage,
  calculateOptimalSandwich,
  
  // Gas calculations
  estimateGasCostWei,
  calculateMinProfitableTradeSize,
  calculateNetProfit,
  
  // Uniswap V3
  FEE_TIERS,
  type FeeTier,
  type V3PoolState,
  tickToSqrtPriceX96,
  sqrtPriceX96ToTick,
  calculateV3SwapOutput,
  calculateV2V3Arbitrage,
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_ROUTER_ABI,
  
  // Transaction decoders
  decodeSwapTransaction,
  isSwapSelector,
  getAllSwapSelectors,
  type DecodedSwap,
  
  // Contract ABIs
  ERC20_ABI,
  XLP_V2_PAIR_ABI,
  XLP_V2_FACTORY_ABI,
  XLP_ROUTER_ABI,
  PERPETUAL_MARKET_ABI,
  AUTOCRAT_TREASURY_ABI,
  PRICE_ORACLE_ABI,
  CHAINLINK_AGGREGATOR_ABI,
  ZERO_ADDRESS,
} from './lib';

// ============ Types ============
export type {
  ChainId,
  ChainConfig,
  Token,
  Pool,
  PoolType,
  StrategyType,
  StrategyConfig,
  Opportunity,
  ArbitrageOpportunity,
  CrossChainArbOpportunity,
  SandwichOpportunity,
  LiquidationOpportunity,
  OpportunityExecutionResult,
  AutocratConfig,
} from './autocrat-types';
