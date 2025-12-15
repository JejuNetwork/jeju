/**
 * SDK Configuration - Re-exports from @jejunetwork/config with SDK-specific helpers
 */

import type { NetworkType } from "@jejunetwork/types";

// Re-export all config utilities
export {
  getConfig,
  getChainConfig,
  getContract,
  getConstant,
  getServicesConfig,
  getServiceUrl,
  getCurrentNetwork,
  getEILConfig,
  getEILChains,
  getEILChainById,
  getFederationConfig,
  getFederatedNetworks,
  getNetworkName,
  type NetworkConfig,
  type NetworkContracts,
  type ServicesConfig,
  type ContractCategoryName,
} from "@jejunetwork/config";

export interface SDKConfig {
  network: NetworkType;
  rpcUrl?: string;
  bundlerUrl?: string;
  indexerUrl?: string;
}

export function resolveConfig(
  network: NetworkType,
  overrides?: Partial<SDKConfig>,
): SDKConfig {
  return {
    network,
    rpcUrl: overrides?.rpcUrl,
    bundlerUrl: overrides?.bundlerUrl,
    indexerUrl: overrides?.indexerUrl,
  };
}
