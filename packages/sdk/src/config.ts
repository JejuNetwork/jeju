/**
 * SDK Configuration - Re-exports from @jejunetwork/config with SDK-specific helpers
 */

import type { NetworkType } from "@jejunetwork/types";
import type { Address } from "viem";
import { getContract } from "@jejunetwork/config";

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

/** Contract addresses for SDK modules */
export interface ContractAddresses {
  // Core contracts
  identityRegistry?: Address;
  validationRegistry?: Address;
  agentRegistry?: Address;
  computeMarketplace?: Address;
  storageMarketplace?: Address;
  jnsRegistry?: Address;
  jnsResolver?: Address;
  governor?: Address;
  governorToken?: Address;

  // Extended contracts (may not be available on all networks)
  gameIntegration?: Address;
  containerRegistry?: Address;
  tokenLaunchpad?: Address;
  bondingCurve?: Address;
  lpLocker?: Address;
  gitRegistry?: Address;
  packageRegistry?: Address;
  modelRegistry?: Address;
  datasetRegistry?: Address;
  vpnRegistry?: Address;

  // DeFi contracts
  routerV3?: Address;
  positionManager?: Address;
  xlpFactory?: Address;

  // Cross-chain contracts
  inputSettler?: Address;
  solverRegistry?: Address;

  // Staking contracts
  staking?: Address;
  nodeStakingManager?: Address;
  rpcProviderRegistry?: Address;

  // Federation contracts
  networkRegistry?: Address;
  registryHub?: Address;
  federationGovernance?: Address;
}

/** Get all contract addresses for a network */
export function getContractAddresses(network: NetworkType): ContractAddresses {
  // Type-safe contract lookup that returns undefined if not found
  const tryGetContract = (category: string, name: string): Address | undefined => {
    try {
      // @ts-expect-error - category names may vary by deployment
      const addr = getContract(network, category, name);
      return addr as Address;
    } catch {
      return undefined;
    }
  };

  return {
    // Core
    identityRegistry: tryGetContract("identity", "IdentityRegistry"),
    validationRegistry: tryGetContract("identity", "ValidationRegistry"),
    agentRegistry: tryGetContract("identity", "AgentRegistry"),
    computeMarketplace: tryGetContract("compute", "ComputeMarketplace"),
    storageMarketplace: tryGetContract("storage", "StorageMarketplace"),
    jnsRegistry: tryGetContract("names", "JNSRegistry"),
    jnsResolver: tryGetContract("names", "JNSResolver"),
    governor: tryGetContract("governance", "Governor"),
    governorToken: tryGetContract("governance", "GovernorToken"),

    // Extended
    gameIntegration: tryGetContract("games", "GameIntegration"),
    containerRegistry: tryGetContract("containers", "ContainerRegistry"),
    tokenLaunchpad: tryGetContract("launchpad", "TokenLaunchpad"),
    bondingCurve: tryGetContract("launchpad", "BondingCurve"),
    lpLocker: tryGetContract("launchpad", "LPLocker"),
    gitRegistry: tryGetContract("developer", "GitRegistry"),
    packageRegistry: tryGetContract("developer", "PackageRegistry"),
    modelRegistry: tryGetContract("models", "ModelRegistry"),
    datasetRegistry: tryGetContract("models", "DatasetRegistry"),
    vpnRegistry: tryGetContract("vpn", "VPNRegistry"),

    // DeFi
    routerV3: tryGetContract("defi", "RouterV3"),
    positionManager: tryGetContract("defi", "NonfungiblePositionManager"),
    xlpFactory: tryGetContract("defi", "XLPFactory"),

    // Cross-chain
    inputSettler: tryGetContract("crosschain", "InputSettler"),
    solverRegistry: tryGetContract("crosschain", "SolverRegistry"),

    // Staking
    staking: tryGetContract("staking", "Staking"),
    nodeStakingManager: tryGetContract("staking", "NodeStakingManager"),
    rpcProviderRegistry: tryGetContract("rpc", "RPCProviderRegistry"),

    // Federation
    networkRegistry: tryGetContract("federation", "NetworkRegistry"),
    registryHub: tryGetContract("federation", "RegistryHub"),
    federationGovernance: tryGetContract("federation", "FederationGovernance"),
  };
}

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
