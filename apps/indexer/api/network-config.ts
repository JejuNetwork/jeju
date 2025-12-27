/**
 * Network configuration - uses centralized config package (browser-safe)
 */

import {
  getChainId as getConfigChainId,
  getConstant,
  getContract,
  getCurrentNetwork,
  getRpcUrl,
} from '@jejunetwork/config'
import type { NetworkType } from '@jejunetwork/types'
import { config } from './config'

export type { NetworkType }

export interface NetworkConfig {
  network: NetworkType
  chainId: number
  rpcUrl: string
  contracts: ContractAddresses
}

export interface ContractAddresses {
  feedRegistry: string | null
  reportVerifier: string | null
  committeeManager: string | null
  oracleFeeRouter: string | null
  disputeGame: string | null
  oracleNetworkConnector: string | null
  entryPoint: string | null
  priceOracle: string | null
  serviceRegistry: string | null
  creditManager: string | null
  tokenRegistry: string | null
  paymasterFactory: string | null
  liquidityPaymaster: string | null
  multiTokenPaymaster: string | null
  identityRegistry: string | null
  reputationRegistry: string | null
  validationRegistry: string | null
  registryGovernance: string | null
  liquidityVault: string | null
  feeDistributor: string | null
  poolManager: string | null
  swapRouter: string | null
  nodeStakingManager: string | null
  nodePerformanceOracle: string | null
  autoSlasher: string | null
  multiOracleConsensus: string | null
  banManager: string | null
  reputationLabelManager: string | null
  reportingSystem: string | null
  computeRegistry: string | null
  computeRental: string | null
  ledgerManager: string | null
  inferenceServing: string | null
  computeStaking: string | null
  solverRegistry: string | null
  inputSettler: string | null
  outputSettler: string | null
  oifOracle: string | null
  l1StakeManager: string | null
  crossChainPaymaster: string | null
  bazaarMarketplace: string | null
  goldToken: string | null
  itemsNFT: string | null
  predictionMarket: string | null
  predictionOracle: string | null
  playerTradeEscrow: string | null
  contest: string | null
  weth: string | null
  usdc: string | null
  jeju: string | null
  otc: string | null
}

const DEFAULT_RPC: Record<NetworkType, string> = {
  localnet: getRpcUrl('localnet'),
  testnet: getRpcUrl('testnet'),
  mainnet: getRpcUrl('mainnet'),
}

/** Safely get a contract address, returning null if not found */
function safeGetContract(
  category: string,
  name: string,
  network: NetworkType,
): string | null {
  try {
    const addr = getContract(category as 'tokens', name, network)
    return addr || null
  } catch {
    return null
  }
}

export function getNetworkFromEnv(): NetworkType {
  // Use centralized config which handles env vars and defaults
  return getCurrentNetwork()
}

/**
 * Get the chain ID for the current network from environment
 */
export function getChainId(): number {
  const network = getNetworkFromEnv()
  return getConfigChainId(network)
}

export function loadNetworkConfig(network?: NetworkType): NetworkConfig {
  const net = network || getNetworkFromEnv()
  const chainId = getConfigChainId(net)

  // Build contracts from centralized config
  const contracts: ContractAddresses = {
    // Oracle contracts
    feedRegistry: safeGetContract('oracle', 'feedRegistry', net),
    reportVerifier: safeGetContract('oracle', 'reportVerifier', net),
    committeeManager: null, // Not in central config yet
    oracleFeeRouter: null, // Not in central config yet
    disputeGame: null, // Not in central config yet
    oracleNetworkConnector: null, // Not in central config yet

    // Infrastructure/constants
    entryPoint: getConstant('entryPoint'),
    priceOracle: safeGetContract('payments', 'priceOracle', net),
    serviceRegistry: safeGetContract('payments', 'serviceRegistry', net),
    creditManager: safeGetContract('payments', 'creditManager', net),
    tokenRegistry: safeGetContract('payments', 'tokenRegistry', net),
    paymasterFactory: safeGetContract('payments', 'paymasterFactory', net),
    liquidityPaymaster: safeGetContract('eil', 'liquidityPaymaster', net),
    multiTokenPaymaster: safeGetContract(
      'payments',
      'multiTokenPaymaster',
      net,
    ),

    // Registry contracts
    identityRegistry: safeGetContract('registry', 'identity', net),
    reputationRegistry: safeGetContract('registry', 'reputation', net),
    validationRegistry: safeGetContract('registry', 'validation', net),
    registryGovernance: safeGetContract(
      'governance',
      'registryGovernance',
      net,
    ),

    // Liquidity/DeFi contracts
    liquidityVault: safeGetContract('liquidity', 'liquidityVault', net),
    feeDistributor: safeGetContract('fees', 'feeDistributor', net),
    poolManager: safeGetContract('defi', 'poolManager', net),
    swapRouter: safeGetContract('defi', 'swapRouter', net),

    // Node staking contracts
    nodeStakingManager: safeGetContract('nodeStaking', 'manager', net),
    nodePerformanceOracle: safeGetContract(
      'nodeStaking',
      'performanceOracle',
      net,
    ),
    autoSlasher: null, // Not in central config yet
    multiOracleConsensus: null, // Not in central config yet

    // Moderation contracts
    banManager: safeGetContract('moderation', 'banManager', net),
    reputationLabelManager: safeGetContract(
      'moderation',
      'reputationLabelManager',
      net,
    ),
    reportingSystem: safeGetContract('moderation', 'reportingSystem', net),

    // Compute contracts
    computeRegistry: safeGetContract('compute', 'registry', net),
    computeRental: null, // Not in central config yet
    ledgerManager: safeGetContract('compute', 'ledgerManager', net),
    inferenceServing: safeGetContract('compute', 'inferenceServing', net),
    computeStaking: safeGetContract('compute', 'staking', net),

    // OIF contracts
    solverRegistry: safeGetContract('oif', 'solverRegistry', net),
    inputSettler: safeGetContract('oif', 'inputSettler', net),
    outputSettler: safeGetContract('oif', 'outputSettler', net),
    oifOracle: safeGetContract('oif', 'oracleAdapter', net),

    // EIL contracts
    l1StakeManager: safeGetContract('eil', 'l1StakeManager', net),
    crossChainPaymaster: safeGetContract('eil', 'crossChainPaymaster', net),

    // Bazaar/games contracts
    bazaarMarketplace: safeGetContract('bazaar', 'marketplace', net),
    goldToken: null, // Game-specific, not in central config
    itemsNFT: null, // Game-specific, not in central config
    predictionMarket: safeGetContract('bazaar', 'predictionMarket', net),
    predictionOracle: null, // Not in central config yet
    playerTradeEscrow: null, // Not in central config yet
    contest: null, // Not in central config yet

    // Tokens
    weth: getConstant('weth'),
    usdc: safeGetContract('tokens', 'usdc', net),
    jeju: safeGetContract('tokens', 'jeju', net),
    otc: null, // Not in central config yet
  }

  return {
    network: net,
    chainId,
    rpcUrl: config.rpcEthHttp || DEFAULT_RPC[net],
    contracts,
  }
}

export function getContractAddressSet(config: NetworkConfig): Set<string> {
  const addresses = new Set<string>()
  for (const [, value] of Object.entries(config.contracts)) {
    if (value && typeof value === 'string') {
      addresses.add(value.toLowerCase())
    }
  }
  return addresses
}

export function getContractName(
  config: NetworkConfig,
  address: string,
): string | null {
  const lowerAddress = address.toLowerCase()
  for (const [name, value] of Object.entries(config.contracts)) {
    if (
      value &&
      typeof value === 'string' &&
      value.toLowerCase() === lowerAddress
    ) {
      return name
    }
  }
  return null
}

let _networkConfig: NetworkConfig | null = null

export function getNetworkConfig(): NetworkConfig {
  if (!_networkConfig) {
    _networkConfig = loadNetworkConfig()
  }
  return _networkConfig
}
