export {
  type NetworkContextValue,
  NetworkProvider,
  NetworkProvider as JejuProvider,
  type NetworkProviderProps,
  useNetworkContext,
} from './context'
export {
  IERC20_ABI,
  LIQUIDITY_VAULT_ABI,
  PAYMASTER_FACTORY_ABI,
  TOKEN_REGISTRY_ABI,
  ZERO_ADDRESS,
  ZERO_BYTES32,
} from './contracts'
export {
  calculateSharePercent,
  parseLPPosition,
  parsePositionFromBalance,
  parsePositionFromTuple,
  type RawPositionTuple,
} from './hooks/liquidity-utils'
export { type UseBalanceResult, useBalance } from './hooks/useBalance'
export { type UseComputeResult, useCompute } from './hooks/useCompute'
export { type UseCrossChainResult, useCrossChain } from './hooks/useCrossChain'
export { type UseDefiResult, useDefi } from './hooks/useDefi'
export { type UseGovernanceResult, useGovernance } from './hooks/useGovernance'
export { type UseIdentityResult, useIdentity } from './hooks/useIdentity'
export { type JejuState, useJeju } from './hooks/useJeju'
export {
  type LPPosition,
  type UseLiquidityVaultResult,
  useLiquidityVault,
} from './hooks/useLiquidityVaultContract'
export { type UseNamesResult, useNames } from './hooks/useNames'
export {
  type PaymasterDeployment,
  type UsePaymasterDeploymentResult,
  type UsePaymasterFactoryResult,
  usePaymasterDeployment,
  usePaymasterFactory,
} from './hooks/usePaymasterFactoryContract'
export { type UsePaymentsResult, usePayments } from './hooks/usePayments'
export { type UseStorageResult, useStorage } from './hooks/useStorage'
export {
  type TokenConfig,
  type TokenInfo,
  type UseTokenConfigResult,
  type UseTokenRegistryResult,
  useTokenConfig,
  useTokenRegistry,
} from './hooks/useTokenRegistryContract'
export { type AsyncState, requireClient, useAsyncState } from './hooks/utils'

// Decentralized wallet module (no WalletConnect dependency)
export {
  type ChainConfig,
  type CreateWagmiConfigOptions,
  createDecentralizedWagmiConfig,
  ETHEREUM_MAINNET,
  JEJU_CHAINS,
  useWallet,
  WalletButton,
  type WalletButtonProps,
} from './wallet'

// Miniapp SDK for Telegram and Farcaster
export {
  applyMiniappTheme,
  createFrameResponse,
  createMiniappStorage,
  detectMiniappPlatform,
  generateFrameMetaTags,
  getFarcasterContext,
  getMiniappThemeVars,
  getTelegramTheme,
  getTelegramUser,
  haptic,
  initTelegram,
  isTelegramDarkMode,
  type FarcasterFrameContext,
  type FrameMetadata,
  type MiniappPlatform,
  type MiniappStorage,
  type TelegramWebApp,
} from './miniapp'
