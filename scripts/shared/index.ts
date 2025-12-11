/**
 * @title Shared Utilities Index
 * @notice Central export for all shared utilities
 */

export * from './notifications';
export * from './format';
export * from './logger';
export * from './rpc';
export * from './agent0';
export * from './x402';
export * from './x402-client';
export * from './intent-swap';
export * from './jns';
export * from './oif-integration';

// EIL exports - export everything, EILConfig is the canonical one
export * from './eil';

// EIL Hooks - export everything except conflicting types, then export them with aliases
export type { 
  ChainInfo,
  GasPaymentOption,
  CrossChainSwapParams,
  XLPPosition,
  EILStats,
  SwapStatus,
  StakeStatus
} from './eil-hooks';
export { 
  SUPPORTED_CHAINS,
  CROSS_CHAIN_PAYMASTER_ABI,
  APP_TOKEN_PREFERENCE_ABI,
  L1_STAKE_MANAGER_ABI,
  DEFAULT_EIL_CONFIG,
  calculateSwapFee,
  estimateSwapTime,
  formatSwapRoute,
  formatXLPPosition,
  getChainById,
  isCrossChainSwap,
  validateSwapParams,
  buildSwapTransaction,
  buildXLPStakeTransaction,
  buildLiquidityDepositTransaction,
  buildTokenPaymentData,
  selectBestGasToken,
  formatGasPaymentOption,
  canPayGasWithToken,
  getBestGasTokenForApp,
  buildAppAwarePaymentData
} from './eil-hooks';
// Export conflicting types with aliases
export type { EILConfig as EILHooksConfig, AppPreference as EILHooksAppPreference } from './eil-hooks';

// Paymaster - export everything, but alias conflicting PaymasterOption
export type { PaymasterOption as PaymasterPaymasterOption } from './paymaster';
export * from './paymaster';

// Gas Intent Router - export everything except conflicting types
export { GasIntentRouter, createGasRouter, createMultiChainGasRouter, formatPaymasterOption } from './gas-intent-router';
// Re-export with explicit names to avoid conflicts
export type { PaymasterOption as GasIntentPaymasterOption, TokenBalance as GasIntentTokenBalance } from './gas-intent-router';
export { generatePaymasterData as generatePaymasterDataFromGasIntent, generateCrossChainPaymasterData, generateVoucherPaymasterData, parsePaymasterData } from './gas-intent-router';

// Token Payment Router - export everything except conflicting types
export { TokenPaymentRouter, createTokenPaymentRouter, initializePayment, setUser, setUserTokens, addChain, formatPaymentOption, buildPaymasterData } from './token-payment-router';
export type { PaymentRouterConfig, PaymentOption } from './token-payment-router';
// Re-export with explicit name to avoid conflicts
export type { AppPreference as TokenPaymentAppPreference } from './token-payment-router';

// Multi-chain Discovery - export everything except conflicting types
export { MultiChainDiscovery, getDiscovery, createDiscovery } from './multi-chain-discovery';
export type { ChainConfig, TokenConfig, MultiChainBalances } from './multi-chain-discovery';
// Re-export with explicit name to avoid conflicts
export type { TokenBalance as MultiChainTokenBalance } from './multi-chain-discovery';
