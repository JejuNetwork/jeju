export * from './markets/useMarkets';
export * from './markets/useMarket';
export * from './markets/useUserPositions';
export * from './markets/useClaim';
export * from './markets/useGameFeed';
export * from './markets/usePlayerEvents';

// Game item hooks (generic - work with any game's Items.sol)
export * from './nft/useGameItems';

// NFT marketplace hooks
export * from './nft/useNFTListing';
export * from './nft/useNFTBuy';
export * from './nft/useNFTOffer';
export * from './nft/useNFTAuction';

// Account Abstraction / Gasless transactions (ERC-4337)
export * from './useGasless';

// Perpetual Futures Trading
export * from './perps';

// Token Launchpad (Bonding Curve & ICO)
export * from './launchpad';

// TFMM (Temporal Function Market Maker) - import specific exports to avoid conflicts
export {
  useTFMMPools,
  useTFMMPoolState,
  useTFMMUserBalance,
  useTFMMAddLiquidity,
  useTFMMRemoveLiquidity,
  formatWeight,
  formatTVL,
  type TFMMPool,
  type TFMMPoolState,
} from './tfmm/useTFMMPools';
export {
  useTFMMStrategies,
  useStrategyPerformance,
  useUpdateWeights,
  useCanUpdate,
  formatStrategyParam,
  STRATEGY_CONFIGS,
  type StrategyType,
  type StrategyConfig,
  type StrategyPerformance,
} from './tfmm/useTFMMStrategies';
export {
  useTFMMOracles,
  useOraclePrice,
  useOraclePrices,
  useOracleStatus,
  formatDeviation,
  getOracleTypeIcon,
  getOracleTypeName,
  getOracleTypeColor,
  type OracleType,
  type OracleConfig,
  type OracleStatus,
} from './tfmm/useTFMMOracles';
export {
  useTFMMGovernance,
  usePoolFees,
  useSetSwapFee,
  useSetGuardRails,
  usePausePool,
  formatInterval,
  type PoolFees,
  type GuardRails,
} from './tfmm/useTFMMGovernance';
