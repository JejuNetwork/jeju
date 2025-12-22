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

/** Safe contract lookup - returns undefined if not found instead of throwing
 * This is a valid try/catch usage: getContract throws for missing contracts/categories
 * which is expected for optional contract deployments across different networks
 */
export function safeGetContract(
  category: string,
  name: string,
  network: NetworkType,
): Address | undefined {
  try {
    // @ts-expect-error - category names may vary by deployment
    const addr = getContract(category, name, network);
    return addr ? (addr as Address) : undefined;
  } catch {
    // Contract not deployed on this network - return undefined (not zero address)
    return undefined;
  }
}

/** Require a contract address - throws with clear error if not configured
 * Use this in modules for required contracts that must exist
 */
export function requireContract(
  category: string,
  name: string,
  network: NetworkType,
): Address {
  try {
    // @ts-expect-error - category names may vary by deployment
    const addr = getContract(category, name, network);
    if (!addr) {
      throw new Error(`Contract ${category}/${name} returned empty address for ${network}`);
    }
    return addr as Address;
  } catch {
    // Re-throw with clearer context
    throw new Error(
      `Contract ${category}/${name} not configured for ${network}. ` +
      `Deploy contracts or configure environment variables.`
    );
  }
}

/** Get all contract addresses for a network */
export function getContractAddresses(network: NetworkType): ContractAddresses {
  return {
    // Core
    identityRegistry: safeGetContract("identity", "IdentityRegistry", network),
    validationRegistry: safeGetContract("identity", "ValidationRegistry", network),
    agentRegistry: safeGetContract("identity", "AgentRegistry", network),
    computeMarketplace: safeGetContract("compute", "ComputeMarketplace", network),
    storageMarketplace: safeGetContract("storage", "StorageMarketplace", network),
    jnsRegistry: safeGetContract("names", "JNSRegistry", network),
    jnsResolver: safeGetContract("names", "JNSResolver", network),
    governor: safeGetContract("governance", "Governor", network),
    governorToken: safeGetContract("governance", "GovernorToken", network),

    // Extended
    gameIntegration: safeGetContract("games", "GameIntegration", network),
    containerRegistry: safeGetContract("containers", "ContainerRegistry", network),
    tokenLaunchpad: safeGetContract("launchpad", "TokenLaunchpad", network),
    bondingCurve: safeGetContract("launchpad", "BondingCurve", network),
    lpLocker: safeGetContract("launchpad", "LPLocker", network),
    gitRegistry: safeGetContract("developer", "GitRegistry", network),
    packageRegistry: safeGetContract("developer", "PackageRegistry", network),
    modelRegistry: safeGetContract("models", "ModelRegistry", network),
    datasetRegistry: safeGetContract("models", "DatasetRegistry", network),
    vpnRegistry: safeGetContract("vpn", "VPNRegistry", network),

    // DeFi
    routerV3: safeGetContract("defi", "RouterV3", network),
    positionManager: safeGetContract("defi", "NonfungiblePositionManager", network),
    xlpFactory: safeGetContract("defi", "XLPFactory", network),

    // Cross-chain
    inputSettler: safeGetContract("crosschain", "InputSettler", network),
    solverRegistry: safeGetContract("crosschain", "SolverRegistry", network),

    // Staking
    staking: safeGetContract("staking", "Staking", network),
    nodeStakingManager: safeGetContract("staking", "NodeStakingManager", network),
    rpcProviderRegistry: safeGetContract("rpc", "RPCProviderRegistry", network),

    // Federation
    networkRegistry: safeGetContract("federation", "NetworkRegistry", network),
    registryHub: safeGetContract("federation", "RegistryHub", network),
    federationGovernance: safeGetContract("federation", "FederationGovernance", network),
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
