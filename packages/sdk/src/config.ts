/**
 * SDK Configuration - SDK-specific contract helpers
 */

import type { ContractCategoryName, ChainConfig } from '@jejunetwork/config'
import {
  getChainConfig as _getChainConfig,
  getContract,
  getServicesConfig as _getServicesConfig,
  type ServicesConfig,
} from '@jejunetwork/config'
import type { NetworkType } from '@jejunetwork/types'
import type { Address } from 'viem'

// Re-export from @jejunetwork/config for SDK consumers
export { getServicesConfig } from '@jejunetwork/config'
export type { ServicesConfig } from '@jejunetwork/config'

/** Get chain configuration for a network */
export function getChainConfig(network: NetworkType): ChainConfig {
  return _getChainConfig(network)
}

/** Contract addresses for SDK modules - maps to contracts.json structure */
export interface ContractAddresses {
  // Core contracts (registry category)
  identityRegistry?: Address
  validationRegistry?: Address
  agentRegistry?: Address

  // Compute contracts
  computeMarketplace?: Address
  storageMarketplace?: Address

  // JNS contracts
  jnsRegistry?: Address
  jnsResolver?: Address

  // Governance contracts
  governor?: Address
  governorToken?: Address

  // DeFi contracts
  routerV3?: Address
  positionManager?: Address
  xlpFactory?: Address

  // Cross-chain contracts (OIF)
  inputSettler?: Address
  solverRegistry?: Address

  // Staking contracts
  staking?: Address
  nodeStakingManager?: Address

  // Extended module contracts
  gameIntegration?: Address
  containerRegistry?: Address
  tokenLaunchpad?: Address
  bondingCurve?: Address
  lpLocker?: Address
  networkRegistry?: Address
  registryHub?: Address
  datasetRegistry?: Address
  modelRegistry?: Address
  vpnRegistry?: Address
}

/** Safe contract lookup - returns undefined if not found instead of throwing
 * This is a valid try/catch usage: getContract throws for missing contracts/categories
 * which is expected for optional contract deployments across different networks
 */
export function safeGetContract(
  category: ContractCategoryName,
  name: string,
  network: NetworkType,
): Address | undefined {
  try {
    const addr = getContract(category, name, network)
    return addr ? (addr as Address) : undefined
  } catch {
    // Contract not deployed on this network - return undefined (not zero address)
    return undefined
  }
}

/** Require a contract address - throws with clear error if not configured
 * Use this in modules for required contracts that must exist
 */
export function requireContract(
  category: ContractCategoryName,
  name: string,
  network: NetworkType,
): Address {
  const addr = getContract(category, name, network)
  if (!addr) {
    throw new Error(
      `Contract ${category}/${name} returned empty address for ${network}`,
    )
  }
  return addr as Address
}

/** Get all contract addresses for a network */
export function getContractAddresses(network: NetworkType): ContractAddresses {
  return {
    // Core - registry category contains identity contracts
    identityRegistry: safeGetContract('registry', 'identity', network),
    validationRegistry: safeGetContract('registry', 'validation', network),
    agentRegistry: safeGetContract('registry', 'app', network),
    computeMarketplace: safeGetContract('compute', 'registry', network),
    storageMarketplace: safeGetContract('compute', 'ledgerManager', network),
    jnsRegistry: safeGetContract('jns', 'registry', network),
    jnsResolver: safeGetContract('jns', 'resolver', network),
    governor: safeGetContract('governance', 'governor', network),
    governorToken: safeGetContract('tokens', 'jeju', network),

    // DeFi
    routerV3: safeGetContract('defi', 'swapRouter', network),
    positionManager: safeGetContract('defi', 'positionManager', network),
    xlpFactory: safeGetContract('defi', 'poolManager', network),

    // Cross-chain (OIF)
    inputSettler: safeGetContract('oif', 'inputSettler', network),
    solverRegistry: safeGetContract('oif', 'solverRegistry', network),

    // Staking
    staking: safeGetContract('compute', 'staking', network),
    nodeStakingManager: safeGetContract('nodeStaking', 'manager', network),

    // Extended module contracts
    gameIntegration: safeGetContract('registry', 'gameIntegration', network),
    containerRegistry: safeGetContract('registry', 'container', network),
    tokenLaunchpad: safeGetContract('defi', 'launchpad', network),
    bondingCurve: safeGetContract('defi', 'bondingCurve', network),
    lpLocker: safeGetContract('defi', 'lpLocker', network),
    networkRegistry: safeGetContract('registry', 'network', network),
    registryHub: safeGetContract('registry', 'hub', network),
    datasetRegistry: safeGetContract('registry', 'dataset', network),
    modelRegistry: safeGetContract('registry', 'model', network),
    vpnRegistry: safeGetContract('registry', 'vpn', network),
  }
}

export interface SDKConfig {
  network: NetworkType
  rpcUrl?: string
  bundlerUrl?: string
  indexerUrl?: string
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
  }
}
