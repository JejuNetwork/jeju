/**
 * Autocrat Types Bridge
 * 
 * Re-exports types from autocrat codebase for use in Crucible
 */

// Re-export all types from autocrat types source
export type {
  ChainId,
  ChainConfig,
  Token,
  Pool,
  PoolType,
  StrategyType,
  StrategyConfig,
  OpportunityStatus,
  ArbitrageOpportunity,
  CrossChainArbOpportunity,
  SandwichOpportunity,
  LiquidationOpportunity,
  Opportunity,
  OpportunityExecutionResult,
  ProfitSource,
  ProfitDeposit,
  TreasuryStats,
  AccessTier,
  BundleStatus,
  BundleSubmission,
  AutocratConfig,
  Metrics,
} from './autocrat-types-source';

// Re-export event types
export type {
  SwapEvent,
  SyncEvent,
  PendingTransaction,
  BlockEvent,
} from './engine/collector';

