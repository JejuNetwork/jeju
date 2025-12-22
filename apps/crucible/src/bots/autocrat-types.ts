/**
 * Autocrat Types Bridge
 *
 * Re-exports types from autocrat codebase for use in Crucible
 */

// Re-export all types from autocrat types source
export type {
  AccessTier,
  ArbitrageOpportunity,
  AutocratConfig,
  BundleStatus,
  BundleSubmission,
  ChainConfig,
  ChainId,
  CrossChainArbOpportunity,
  LiquidationOpportunity,
  Metrics,
  Opportunity,
  OpportunityExecutionResult,
  OpportunityStatus,
  Pool,
  PoolType,
  ProfitDeposit,
  ProfitSource,
  SandwichOpportunity,
  StrategyConfig,
  StrategyType,
  Token,
  TreasuryStats,
} from './autocrat-types-source'

// Re-export event types
export type {
  BlockEvent,
  PendingTransaction,
  SwapEvent,
  SyncEvent,
} from './engine/collector'
