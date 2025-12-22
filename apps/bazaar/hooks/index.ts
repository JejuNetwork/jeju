// OIFChainInfo is now defined in config/chains
export type { OIFChainInfo } from '@/config/chains'
// Token Launchpad (Bonding Curve & ICO)
export * from './launchpad'
export * from './markets/useClaim'
export * from './markets/useGameFeed'
export * from './markets/useMarket'
export * from './markets/useMarkets'
export * from './markets/usePlayerEvents'
export * from './markets/useUserPositions'
// Game item hooks (generic - work with any game's Items.sol)
export * from './nft/useGameItems'
export * from './nft/useNFTAuction'
export * from './nft/useNFTBuy'
// NFT marketplace hooks
export * from './nft/useNFTListing'
export * from './nft/useNFTOffer'
// Perpetual Futures Trading
export * from './perps'
export {
  formatInterval,
  type GuardRails,
  type PoolFees,
  usePausePool,
  usePoolFees,
  useSetGuardRails,
  useSetSwapFee,
  useTFMMGovernance,
} from './tfmm/useTFMMGovernance'
export {
  formatDeviation,
  getOracleTypeColor,
  getOracleTypeIcon,
  getOracleTypeName,
  type OracleConfig,
  type OracleStatus,
  type OracleType,
  useOraclePrice,
  useOraclePrices,
  useOracleStatus,
  useTFMMOracles,
} from './tfmm/useTFMMOracles'
// TFMM (Temporal Function Market Maker) - import specific exports to avoid conflicts
export {
  formatTVL,
  formatWeight,
  type TFMMPool,
  type TFMMPoolState,
  useTFMMAddLiquidity,
  useTFMMPoolState,
  useTFMMPools,
  useTFMMRemoveLiquidity,
  useTFMMUserBalance,
} from './tfmm/useTFMMPools'
export {
  formatStrategyParam,
  STRATEGY_CONFIGS,
  type StrategyConfig,
  type StrategyPerformance,
  type StrategyType,
  useCanUpdate,
  useStrategyPerformance,
  useTFMMStrategies,
  useUpdateWeights,
} from './tfmm/useTFMMStrategies'

// EIL (Cross-chain)
export * from './useEIL'
// Account Abstraction / Gasless transactions (ERC-4337)
export * from './useGasless'
// Intent API (OIF) - explicitly exclude ChainInfo to avoid conflict with useEIL
export {
  type CreateIntentParams,
  type Intent,
  type IntentQuote,
  type LeaderboardEntry,
  type OIFStats,
  type Route,
  type Solver,
  useAllIntents,
  useIntentAPI,
  useIntentQuote,
  useIntents,
  useOIFStats,
  useRoutes,
  useSolverLeaderboard,
  useSolvers,
  useSupportedChains,
} from './useIntentAPI'
// OIF (Open Intent Framework)
export * from './useOIF'
// Protocol Tokens
export * from './useProtocolTokens'
