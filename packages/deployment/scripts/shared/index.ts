/**
 * @title Shared Utilities Index
 * @notice Central export for all shared utilities (browser-safe)
 */

// EIL Hooks (browser-safe) - re-export from @jejunetwork/shared
export {
  APP_TOKEN_PREFERENCE_ABI,
  type AppPreference,
  buildAppAwarePaymentData,
  buildLiquidityDepositTransaction,
  buildSwapTransaction,
  buildTokenPaymentData,
  buildXLPStakeTransaction,
  type ChainInfo,
  CROSS_CHAIN_PAYMASTER_ABI,
  type CrossChainSwapParams,
  calculateSwapFee,
  canPayGasWithToken,
  DEFAULT_EIL_CONFIG,
  type EILConfig,
  type EILStats,
  estimateSwapTime,
  formatGasPaymentOption,
  formatSwapRoute,
  formatXLPPosition,
  type GasPaymentOption,
  getBestGasTokenForApp,
  getChainById,
  isCrossChainSwap,
  L1_STAKE_MANAGER_ABI,
  SUPPORTED_CHAINS,
  type SwapStatus,
  selectBestGasToken,
  validateSwapParams,
  type XLPPosition,
} from '@jejunetwork/shared'
export * from './agent0'
export * from './chain-utils'
// Chain utilities
export * from './chains'
// Config utilities (unified config access)
export * from './config-utils'
// Contract types for deployment scripts
export * from './contract-types'
// EIL exports - export everything, EILConfig is the canonical one
export * from './eil'
// Gas Intent Router
export {
  createGasRouter,
  createMultiChainGasRouter,
  formatPaymasterOption,
  GasIntentRouter,
  generateCrossChainPaymasterData,
  generatePaymasterData as generatePaymasterDataFromGasIntent,
  generateVoucherPaymasterData,
  parsePaymasterData,
} from './gas-intent-router'
export * from './intent-swap'
export * from './jns'
export * from './logger'
// Multi-chain Discovery
export {
  createDiscovery,
  getDiscovery,
  MultiChainDiscovery,
} from './multi-chain-discovery'
export * from './notifications'
export * from './oif-integration'
// Paymaster
export * from './paymaster'
export * from './rpc'
// Token Payment Router
export {
  addChain,
  buildPaymasterData,
  createTokenPaymentRouter,
  formatPaymentOption,
  initializePayment,
  setUser,
  setUserTokens,
  TokenPaymentRouter,
} from './token-payment-router'
export * from './x402'
export * from './x402-client'
