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
// EIL Hooks
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
