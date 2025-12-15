/**
 * External Protocol Integrations
 * 
 * Permissionless integrations with external intent/order protocols
 * to earn solver/filler fees by leveraging Jeju's liquidity.
 * 
 * All integrations are fully permissionless - no API keys required.
 */

export { AcrossAdapter, type AcrossDeposit } from './across';
export { UniswapXAdapter, type UniswapXOrder } from './uniswapx';
export { CowProtocolSolver, COW_SETTLEMENT, COW_VAULT_RELAYER, type CowAuction, type CowOrder, type CowQuote, type CowOrderParams, type CowSolution } from './cow';
export { CowSolverValidator, printSolverReport, printComparisonReport, type SolverMetrics, type CompetitionResult } from './cow-validator';
export { CowSolverOptimizer, printOptimizationReport, type LiquidityPool, type PriceFeed, type OptimizedSolution } from './cow-optimizer';
export { ExternalProtocolAggregator } from './aggregator';

// Price Oracle (Chainlink integration)
export { 
  PriceOracle, 
  CHAINLINK_FEEDS, 
  TOKEN_TO_FEED,
  type PriceData,
  type TokenPrice,
} from './price-oracle';

// DEX Aggregator (Uniswap V2/V3, Balancer routing)
export {
  DexAggregator,
  UNISWAP_V3_QUOTER,
  UNISWAP_V2_ROUTER,
  BALANCER_VAULT,
  INTERMEDIATE_TOKENS,
  type DexQuote,
  type AggregatedQuote,
} from './dex-aggregator';

// JIT Liquidity Provider
export {
  JITLiquidityProvider,
  POSITION_MANAGER,
  priceToTick,
  tickToPrice,
  type JITPosition,
  type JITOpportunity,
  type JITConfig,
} from './jit-liquidity';

// Chain configurations for external protocols
export const SUPPORTED_CHAINS = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  polygon: 137,
  bsc: 56,
  jeju: 420691,
} as const;

export type SupportedChain = keyof typeof SUPPORTED_CHAINS;
