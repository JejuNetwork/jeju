/**
 * External Protocol Integrations
 *
 * Permissionless integrations with external intent/order protocols
 * to earn solver/filler fees by leveraging Jeju's liquidity.
 *
 * All integrations are fully permissionless - no API keys required.
 */

export { AcrossAdapter, type AcrossDeposit } from './across'
export {
  type AggregatorConfig,
  type ExternalOpportunity,
  type ExternalOpportunityType,
  ExternalProtocolAggregator,
} from './aggregator'
export {
  COW_SETTLEMENT,
  COW_VAULT_RELAYER,
  type CowAuction,
  type CowOrder,
  type CowOrderParams,
  CowProtocolSolver,
  type CowQuote,
  type CowSolution,
} from './cow'
export {
  CowSolverOptimizer,
  type LiquidityPool,
  type OptimizedSolution,
  type PriceFeed,
  printOptimizationReport,
} from './cow-optimizer'
export {
  type CompetitionResult,
  CowSolverValidator,
  printComparisonReport,
  printSolverReport,
  type SolverMetrics,
} from './cow-validator'
// DEX Aggregator (Uniswap V2/V3, Balancer routing)
export {
  type AggregatedQuote,
  BALANCER_VAULT,
  DexAggregator,
  type DexQuote,
  INTERMEDIATE_TOKENS,
  UNISWAP_V2_ROUTER,
  UNISWAP_V3_QUOTER,
} from './dex-aggregator'
// JIT Liquidity Provider
export {
  type JITConfig,
  JITLiquidityProvider,
  type JITOpportunity,
  type JITPosition,
  POSITION_MANAGER,
  priceToTick,
  tickToPrice,
} from './jit-liquidity'
// Multi-Chain Price Aggregation (no external APIs)
export {
  type AggregatedPrice,
  getPriceAggregator,
  MultiChainPriceAggregator,
  type PoolState,
  type PriceSource,
  type TokenPrice as AggregatorTokenPrice,
} from './price-aggregator'
// Price Oracle (Chainlink integration)
export {
  CHAINLINK_FEEDS,
  type PriceData,
  PriceOracle,
  TOKEN_TO_FEED,
  type TokenPrice,
} from './price-oracle'
// Solana Price Aggregation
export {
  getSolanaPriceAggregator,
  type OrcaWhirlpoolState,
  type RaydiumPoolState,
  SolanaPriceAggregator,
  type SolanaPriceSource,
  type SolanaTokenPrice,
} from './solana-price-aggregator'
export { UniswapXAdapter, type UniswapXOrder } from './uniswapx'

// Chain configurations for external protocols
export const SUPPORTED_CHAINS = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  polygon: 137,
  bsc: 56,
  jeju: 420691,
  solana: 101,
  solanaDevnet: 102,
} as const

export type SupportedChain = keyof typeof SUPPORTED_CHAINS
