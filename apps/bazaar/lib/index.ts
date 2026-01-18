/**
 * Bazaar - Shared Library
 *
 * Exports shared utilities and modules used across api/ and web/.
 * Some modules export same-named functions (formatPrice, formatTimeRemaining).
 * Use explicit imports with aliases when you need multiple versions.
 */

// Browser stubs - explicit exports to avoid ipfs.ts conflicts
export {
  type BanStatus,
  BanType,
  getBanTypeLabel,
  type IPFSClient,
  type OAuth3Config,
  type OAuth3ContextValue,
  type OAuth3Session,
  useBanStatus,
} from './browser-stubs'
export * from './client'
export * from './data-client'
export * from './erc8004'
export * from './ipfs'

// JNS - explicit exports to avoid conflicts with nft.ts formatTimeRemaining
export {
  BASE_REGISTRATION_PRICE_ETH,
  type CurrencyType,
  CurrencyTypeSchema,
  calculateExpiryDate,
  calculateExpiryTimestamp,
  calculateRegistrationPrice,
  calculateRegistrationPriceWei,
  computeLabelhash,
  computeNameIdentifiers,
  formatExpiryDate,
  formatFullName,
  formatListingPrice,
  formatRegistrationPrice,
  formatTimeRemaining as formatJNSTimeRemaining,
  getAnnualPrice,
  getNameLengthCategory,
  getRemainingSeconds,
  isExpired,
  isValidNameFormat,
  JNS_SUFFIX,
  JNSNameSchema,
  ListingDurationSchema,
  ListingPriceSchema,
  type ListingStatus,
  ListingStatusSchema,
  labelhashToTokenId,
  listingDurationToSeconds,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  type NameListingInput,
  NameListingInputSchema,
  type NameRegistrationInput,
  NameRegistrationInputSchema,
  normalizeName,
  parseEthToWei,
  REGISTRATION_DURATIONS,
  RegistrationDurationSchema,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  SHORT_NAME_MULTIPLIERS,
  validateListingDuration,
  validateListingInput,
  validateName,
  validateRegistrationInput,
} from './jns'

// Launchpad - explicit exports to avoid conflicts with perps.ts formatPrice
export {
  type BondingCurveConfig,
  BondingCurveConfigSchema,
  type BondingCurveStats,
  BondingCurveStatsSchema,
  calculateBuyPriceImpact,
  calculateEthOut,
  calculateGraduationMarketCap,
  calculateGraduationProgress,
  calculateInitialMarketCap,
  calculateInitialPrice,
  calculateLPAllocation,
  calculatePresaleTokens,
  calculateTokenAllocation,
  calculateTokensOut,
  canClaimRefund,
  canClaimTokens,
  DEFAULT_BONDING_CONFIG,
  DEFAULT_ICO_CONFIG,
  DEGEN_ICO_CONFIG,
  formatBasisPoints,
  formatDuration,
  formatEthAmount,
  formatPrice as formatLaunchpadPrice,
  type ICOConfig,
  ICOConfigSchema,
  type LaunchInfo,
  LaunchInfoSchema,
  type LaunchType,
  LaunchTypeSchema,
  type PresaleStatus,
  PresaleStatusSchema,
  parseBondingCurveStats,
  parsePresaleStatus,
  parseUserContribution,
  type UserContribution,
  UserContributionSchema,
  validateBondingCurveLaunch,
  validateICOLaunch,
} from './launchpad'

// Markets - explicit exports to avoid conflicts with formatPrice from perps
export {
  calculateCost,
  calculateExpectedShares,
  calculateNoPrice,
  calculateYesPrice,
  formatPrice as formatMarketPrice,
} from './markets/lmsrPricing'
export * from './moderation-contracts'

// NFT - explicit exports to use NFT-specific formatTimeRemaining
export {
  type AuctionParams,
  AuctionParamsSchema,
  type AuctionState,
  type BidParams,
  BidParamsSchema,
  calculateMinimumBid,
  DEFAULT_AUCTION_DURATION_SECONDS,
  daysToSeconds,
  type ERC721TokenInput,
  type ERC1155BalanceInput,
  filterNFTsByOwner,
  formatAddress,
  formatTimeRemaining as formatNFTTimeRemaining,
  getAuctionTimeRemaining,
  groupNFTsByCollection,
  isAuctionActive,
  isListingActive,
  isNFTOwner,
  ListingParamsSchema,
  type ListingState,
  MIN_BID_INCREMENT_BPS,
  MIN_LISTING_PRICE_ETH,
  type NFTCollectionGroup,
  type NFTSortOption,
  normalizeERC721Token,
  normalizeERC1155Balance,
  normalizeNFTQueryResult,
  type OfferParams,
  OfferParamsSchema,
  secondsToDays,
  sortNFTs,
  validateBidAmount,
  validateListingPrice,
} from './nft'

// Perps - formatPrice is the canonical one from this module
export * from './perps'

export * from './portfolio'
export * from './swap'
export * from './tee'
export * from './validation'
