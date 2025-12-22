/**
 * @title Shared Utilities Index
 * @notice Central export for all shared utilities
 */

export * from './agent0'
// Chain utilities
export * from './chains'
// Config utilities (unified config access)
export * from './config-utils'
// Contract types for deployment scripts
export * from './contract-types'
// EIL exports - export everything, EILConfig is the canonical one
export * from './eil'
// EIL Hooks - export everything except conflicting types, then export them with aliases
// Export conflicting types with aliases
export type {
  AppPreference as EILHooksAppPreference,
  ChainInfo,
  CrossChainSwapParams,
  EILConfig as EILHooksConfig,
  EILStats,
  GasPaymentOption,
  StakeStatus,
  SwapStatus,
  XLPPosition,
} from './eil-hooks'
export {
  APP_TOKEN_PREFERENCE_ABI,
  buildAppAwarePaymentData,
  buildLiquidityDepositTransaction,
  buildSwapTransaction,
  buildTokenPaymentData,
  buildXLPStakeTransaction,
  CROSS_CHAIN_PAYMASTER_ABI,
  calculateSwapFee,
  canPayGasWithToken,
  DEFAULT_EIL_CONFIG,
  estimateSwapTime,
  formatGasPaymentOption,
  formatSwapRoute,
  formatXLPPosition,
  getBestGasTokenForApp,
  getChainById,
  isCrossChainSwap,
  L1_STAKE_MANAGER_ABI,
  SUPPORTED_CHAINS,
  selectBestGasToken,
  validateSwapParams,
} from './eil-hooks'
export * from './format'
// Re-export with explicit names to avoid conflicts
export type {
  PaymasterOption as GasIntentPaymasterOption,
  TokenBalance as GasIntentTokenBalance,
} from './gas-intent-router'
// Gas Intent Router - export everything except conflicting types
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
// Local Proxy - hosts file and Caddy reverse proxy management
export {
  ensureHostsFile,
  generateCaddyfile,
  getHostsBlockStatus,
  getLocalUrls,
  hasJejuHostsBlock,
  installCaddy,
  isCaddyInstalled,
  removeHostsBlock,
  startProxy,
  stopProxy,
} from './local-proxy'
export * from './logger'
// Re-export with explicit name to avoid conflicts
export type {
  ChainConfig,
  MultiChainBalances,
  TokenBalance as MultiChainTokenBalance,
  TokenConfig,
} from './multi-chain-discovery'
// Multi-chain Discovery - export everything except conflicting types
export {
  createDiscovery,
  getDiscovery,
  MultiChainDiscovery,
} from './multi-chain-discovery'
export * from './notifications'
export * from './oif-integration'
// Paymaster - export everything, but alias conflicting PaymasterOption
export type { PaymasterOption as PaymasterPaymasterOption } from './paymaster'
export * from './paymaster'
export * from './rpc'
// Re-export with explicit name to avoid conflicts
export type {
  AppPreference as TokenPaymentAppPreference,
  PaymentOption,
  PaymentRouterConfig,
} from './token-payment-router'
// Token Payment Router - export everything except conflicting types
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
