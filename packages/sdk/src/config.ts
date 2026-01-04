/**
 * SDK Configuration - SDK-specific contract helpers
 */

import type { ChainConfig, ContractCategoryName } from '@jejunetwork/config'
import {
  getChainConfig as _getChainConfig,
  getContract,
  getServicesConfig,
} from '@jejunetwork/config'
import type { NetworkType } from '@jejunetwork/types'
import type { Address } from 'viem'

export { getContract, getServicesConfig }

import type { ServicesConfig } from '@jejunetwork/config'
export type { ServicesConfig }

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
  governanceBoard?: Address
  governanceDelegation?: Address

  // Moderation contracts
  moderationEvidenceRegistry?: Address
  moderationMarketplace?: Address
  moderationReputationLabelManager?: Address
  moderationBanManager?: Address
  moderationReportingSystem?: Address

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
  rpcProviderRegistry?: Address

  // Extended module contracts
  containerRegistry?: Address
  tokenLaunchpad?: Address
  bondingCurve?: Address
  lpLocker?: Address
  networkRegistry?: Address
  registryHub?: Address
  datasetRegistry?: Address
  modelRegistry?: Address
  vpnRegistry?: Address

  // VPN
  vpn?: Address

  // Agents
  agentVault?: Address
  roomRegistry?: Address

  // OTC
  otc?: Address

  // Perps
  perpetualMarket?: Address
  insuranceFund?: Address
  marginManager?: Address

  // Training
  trainingCoordinator?: Address
  trainingRewards?: Address

  // Distributor
  airdropManager?: Address
  tokenVesting?: Address
  feeDistributor?: Address
  stakingRewardDistributor?: Address

  // Sequencer
  sequencerRegistry?: Address
  forcedInclusion?: Address
  slashingContract?: Address

  // AMM
  xlpRouter?: Address
  xlpV2Factory?: Address

  // Oracle
  oracleRegistry?: Address

  // Messaging
  messageNodeRegistry?: Address
  messagingKeyRegistry?: Address

  // Bridge (Hyperlane)
  hyperlaneMailbox?: Address
  hyperlaneISM?: Address
  optimismPortal?: Address
  l1StandardBridge?: Address
  nftBridge?: Address

  // CDN
  cdnRegistry?: Address
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
    governanceBoard: safeGetContract('governance', 'board', network),
    governanceDelegation: safeGetContract('governance', 'delegation', network),

    // Moderation (lowercase to match contracts.json)
    moderationEvidenceRegistry: safeGetContract(
      'moderation',
      'evidenceRegistry',
      network,
    ),
    moderationMarketplace: safeGetContract(
      'moderation',
      'moderationMarketplace',
      network,
    ),
    moderationReputationLabelManager: safeGetContract(
      'moderation',
      'reputationLabelManager',
      network,
    ),
    moderationBanManager: safeGetContract('moderation', 'banManager', network),
    moderationReportingSystem: safeGetContract(
      'moderation',
      'reportingSystem',
      network,
    ),

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
    containerRegistry: safeGetContract('registry', 'container', network),
    tokenLaunchpad: safeGetContract('defi', 'launchpad', network),
    bondingCurve: safeGetContract('defi', 'bondingCurve', network),
    lpLocker: safeGetContract('defi', 'lpLocker', network),
    networkRegistry: safeGetContract('registry', 'network', network),
    registryHub: safeGetContract('registry', 'hub', network),
    datasetRegistry: safeGetContract('registry', 'dataset', network),
    modelRegistry: safeGetContract('registry', 'model', network),
    vpnRegistry: safeGetContract('vpn', 'registry', network),

    // VPN
    vpn: safeGetContract('vpn', 'registry', network),

    // Agents
    agentVault: safeGetContract('agents', 'vault', network),
    roomRegistry: safeGetContract('agents', 'roomRegistry', network),

    // OTC
    otc: safeGetContract('otc', 'contract', network),

    // Staking (additional)
    rpcProviderRegistry: safeGetContract('staking', 'rpcProviderRegistry', network),

    // Perps
    perpetualMarket: safeGetContract('perps', 'market', network),
    insuranceFund: safeGetContract('perps', 'insuranceFund', network),
    marginManager: safeGetContract('perps', 'marginManager', network),

    // Training
    trainingCoordinator: safeGetContract('training', 'coordinator', network),
    trainingRewards: safeGetContract('training', 'rewards', network),

    // Distributor
    airdropManager: safeGetContract('distributor', 'airdropManager', network),
    tokenVesting: safeGetContract('distributor', 'tokenVesting', network),
    feeDistributor: safeGetContract('distributor', 'feeDistributor', network),
    stakingRewardDistributor: safeGetContract('distributor', 'stakingRewardDistributor', network),

    // Sequencer
    sequencerRegistry: safeGetContract('sequencer', 'registry', network),
    forcedInclusion: safeGetContract('sequencer', 'forcedInclusion', network),
    slashingContract: safeGetContract('sequencer', 'slashing', network),

    // AMM
    xlpRouter: safeGetContract('amm', 'router', network),
    xlpV2Factory: safeGetContract('amm', 'factory', network),

    // Oracle
    oracleRegistry: safeGetContract('oracle', 'registry', network),

    // Messaging
    messageNodeRegistry: safeGetContract('messaging', 'nodeRegistry', network),
    messagingKeyRegistry: safeGetContract('messaging', 'keyRegistry', network),

    // Bridge (Hyperlane)
    hyperlaneMailbox: safeGetContract('bridge', 'hyperlaneMailbox', network),
    hyperlaneISM: safeGetContract('bridge', 'hyperlaneISM', network),
    optimismPortal: safeGetContract('bridge', 'optimismPortal', network),
    l1StandardBridge: safeGetContract('bridge', 'l1StandardBridge', network),
    nftBridge: safeGetContract('bridge', 'nftBridge', network),

    // CDN
    cdnRegistry: safeGetContract('dws', 'cdnRegistry', network),
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
