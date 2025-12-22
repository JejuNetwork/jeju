// Hook exports

// Re-export useful utilities and presets from lib
export {
  calculateBuyPriceImpact,
  calculateEthOut,
  calculateGraduationMarketCap,
  calculateInitialPrice,
  calculateTokensOut,
  DEFAULT_BONDING_CONFIG,
  DEFAULT_ICO_CONFIG,
  DEGEN_ICO_CONFIG,
  validateBondingCurveLaunch,
  validateICOLaunch,
} from '@/lib/launchpad'

export {
  type BondingCurveQuote,
  type BondingCurveStats,
  formatBondingCurvePrice,
  formatProgress,
  useBondingCurve,
  useBondingCurveQuote,
} from './useBondingCurve'

export {
  formatPresaleProgress,
  formatTimeRemaining,
  type PresaleStatus,
  type UserContribution,
  useICOPresale,
} from './useICOPresale'
export {
  type BondingCurveConfig,
  type ICOConfig,
  type LaunchInfo,
  useCreatorLaunches,
  useLaunchInfo,
  useTokenLaunchpad,
} from './useTokenLaunchpad'
