export {
  NetworkProvider,
  NetworkProvider as JejuProvider,
  useNetworkContext,
  type NetworkContextValue,
  type NetworkProviderProps,
} from "./context";

export { useAsyncState, requireClient, type AsyncState } from "./hooks/utils";

export { useJeju, type JejuState } from "./hooks/useJeju";
export { useBalance, type UseBalanceResult } from "./hooks/useBalance";
export { useCompute, type UseComputeResult } from "./hooks/useCompute";
export { useStorage, type UseStorageResult } from "./hooks/useStorage";
export { useDefi, type UseDefiResult } from "./hooks/useDefi";
export { useGovernance, type UseGovernanceResult } from "./hooks/useGovernance";
export { useNames, type UseNamesResult } from "./hooks/useNames";
export { useIdentity, type UseIdentityResult } from "./hooks/useIdentity";
export { useCrossChain, type UseCrossChainResult } from "./hooks/useCrossChain";
export { usePayments, type UsePaymentsResult } from "./hooks/usePayments";
export type { ServiceType } from "@jejunetwork/sdk";

// Contract hooks (wagmi-based)
export {
  useTokenRegistry,
  useTokenConfig,
  type TokenInfo,
  type TokenConfig,
} from "./hooks/useTokenRegistryContract";

export {
  useLiquidityVault,
  type LPPosition,
} from "./hooks/useLiquidityVaultContract";

// Liquidity calculation utilities (pure functions, useful for testing/simulations)
export {
  calculateSharePercent,
  parsePositionFromTuple,
  parsePositionFromBalance,
  parseLPPosition,
  type RawPositionTuple,
} from "./hooks/liquidity-utils";

export {
  usePaymasterFactory,
  usePaymasterDeployment,
  type PaymasterDeployment,
} from "./hooks/usePaymasterFactoryContract";

// Contract ABIs and constants
export {
  ZERO_ADDRESS,
  ZERO_BYTES32,
  TOKEN_REGISTRY_ABI,
  PAYMASTER_FACTORY_ABI,
  LIQUIDITY_VAULT_ABI,
  IERC20_ABI,
} from "./contracts";
