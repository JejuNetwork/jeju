/**
 * @fileoverview Network Configuration
 * @module config
 *
 * Config-First Architecture:
 * - All public values in JSON files
 * - Environment variables only for secrets and overrides
 *
 * Config Files:
 * - chain/*.json     Network settings (RPC, chain ID, bridge contracts)
 * - contracts.json   All contract addresses (network + external chains)
 * - services.json    API URLs per network
 * - tokens.json      Token metadata
 * - chains.json      Node infrastructure (for deployment)
 * - ports.ts         Port allocations (local dev)
 * - branding.json    Network branding (name, colors, URLs)
 *
 * @example
 * ```ts
 * import { getConfig, getContract, getServiceUrl, getNetworkName } from '@jejunetwork/config';
 *
 * const config = getConfig();
 * const solver = getContract('oif', 'solverRegistry');
 * const indexer = getServiceUrl('indexer', 'graphql');
 * const name = getNetworkName(); // Returns network name from branding.json
 * ```
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Maximum config file size (10MB) - prevents DoS via large files */
const MAX_CONFIG_FILE_SIZE = 10 * 1024 * 1024

// Import for internal use - these are also re-exported via 'export * from ./network'
import {
  getChainConfig as _getChainConfig,
  getCurrentNetwork,
  loadChainConfig,
} from './network'
import {
  type ChainConfig,
  type ContractCategory,
  type ContractsConfig,
  ContractsConfigSchema,
  type EILChainConfig,
  type EILConfig,
  EILConfigSchema,
  type EILNetworkConfig,
  type FederationFullConfig,
  FederationFullConfigSchema,
  type FederationHubConfig,
  type FederationNetworkConfig,
  type NetworkType,
  ServicesConfigSchema,
  type ServicesNetworkConfig,
  type TestnetConfig,
  TestnetConfigSchema,
  type VendorAppConfig,
  VendorAppsConfigSchema,
} from './schemas'

export * from './network'
export * from './ports'
export * from './schemas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CONFIG_DIR = __dirname

// ============================================================================
// Types (re-exported from schemas.ts for convenience)
// ============================================================================

// ContractCategory is exported from schemas.ts
// Alias for backwards compatibility
export type ContractCategoryName = ContractCategory

type NetworkContracts = ContractsConfig['localnet']

// ============================================================================
// Loaders
// ============================================================================

function loadJsonRaw(filename: string): unknown {
  const path = resolve(CONFIG_DIR, filename)
  if (!existsSync(path)) throw new Error(`Config not found: ${path}`)

  // Check file size to prevent DoS via large config files
  const stats = statSync(path)
  if (stats.size > MAX_CONFIG_FILE_SIZE) {
    throw new Error(
      `Config file ${filename} exceeds maximum size limit (${MAX_CONFIG_FILE_SIZE} bytes)`,
    )
  }

  return JSON.parse(readFileSync(path, 'utf-8'))
}

let contractsCache: ContractsConfig | null = null
let servicesCache: Record<NetworkType, ServicesNetworkConfig> | null = null

function loadContracts(): ContractsConfig {
  if (!contractsCache) {
    contractsCache = ContractsConfigSchema.parse(loadJsonRaw('contracts.json'))
  }
  return contractsCache
}

function loadServices(): Record<NetworkType, ServicesNetworkConfig> {
  if (!servicesCache) {
    const parsed = ServicesConfigSchema.parse(loadJsonRaw('services.json'))
    servicesCache = parsed
  }
  return servicesCache
}

// ============================================================================
// Core Functions
// ============================================================================

// Note: getCurrentNetwork, loadChainConfig, and getChainConfig are imported from './network'
// and re-exported via 'export * from './network'' above

/** Get chain ID */
export function getChainId(network?: NetworkType): number {
  return _getChainConfig(network).chainId
}

// ============================================================================
// Contracts
// ============================================================================

/**
 * Convert camelCase to SCREAMING_SNAKE_CASE
 * e.g., banManager -> BAN_MANAGER
 */
function toEnvKey(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '')
}

/**
 * Get contract address with env override support
 * Checks: VITE_{NAME}_ADDRESS, NEXT_PUBLIC_{NAME}_ADDRESS, then config
 * e.g., getContract('moderation', 'banManager') checks VITE_BAN_MANAGER_ADDRESS
 */
export function getContract(
  category: ContractCategoryName,
  name: string,
  network?: NetworkType,
): string {
  // Build possible env keys
  const envName = toEnvKey(name)

  // Check VITE_ format (for Vite apps)
  const viteKey = `VITE_${envName}_ADDRESS`
  const viteVal = process.env[viteKey]
  if (viteVal) return viteVal

  // Check NEXT_PUBLIC_ format (for Next.js apps)
  const nextKey = `NEXT_PUBLIC_${envName}_ADDRESS`
  const nextVal = process.env[nextKey]
  if (nextVal) return nextVal

  // Check category-prefixed format (for scripts)
  const categoryKey = `${category.toUpperCase()}_${envName}`
  const categoryVal = process.env[categoryKey]
  if (categoryVal) return categoryVal

  const net = network ?? getCurrentNetwork()
  const contracts = loadContracts()
  const netContracts =
    contracts[
      net as keyof Pick<ContractsConfig, 'localnet' | 'testnet' | 'mainnet'>
    ]
  if (!netContracts) {
    throw new Error(`No contracts configured for network: ${net}`)
  }
  const categoryContracts = netContracts[category]
  if (!categoryContracts) {
    throw new Error(`Contract category ${category} not found for ${net}`)
  }
  const address = categoryContracts[name]
  if (!address) {
    throw new Error(
      `Contract ${category}.${name} not found for ${net}. Set ${category.toUpperCase()}_${toEnvKey(name)} or add to contracts.json`,
    )
  }
  return address
}

/** Get constant contract address (EntryPoint, L2Messenger, etc.) */
export function getConstant(name: keyof ContractsConfig['constants']): string {
  return loadContracts().constants[name]
}

/** Get external chain contract */
export function getExternalContract(
  chain: string,
  category: 'oif' | 'eil' | 'tokens' | 'poc' | 'payments',
  name: string,
): string {
  const contracts = loadContracts()
  const chainContracts = contracts.external[chain]
  if (!chainContracts) {
    throw new Error(`External chain ${chain} not configured in contracts.json`)
  }
  const categoryContracts =
    chainContracts[category as keyof typeof chainContracts]
  if (!categoryContracts || typeof categoryContracts !== 'object') {
    throw new Error(
      `Category ${category} not configured for external chain ${chain}`,
    )
  }
  const address = (categoryContracts as Record<string, string>)[name]
  if (!address) {
    throw new Error(
      `Contract ${name} not found in external.${chain}.${category}`,
    )
  }
  return address
}

// ============================================================================
// Proof-of-Cloud (PoC) Configuration
// ============================================================================

export interface PoCConfig {
  validatorAddress: string
  identityRegistryAddress: string
  rpcUrl: string
  chainId: number
}

/** Get PoC configuration for the default chain (Base Sepolia for testnet) */
export function getPoCConfig(network?: NetworkType): PoCConfig {
  const net = network ?? getCurrentNetwork()
  const chain = net === 'mainnet' ? 'base' : 'baseSepolia'
  const contracts = loadContracts()
  const chainConfig = contracts.external[chain]

  if (!chainConfig) {
    throw new Error(`External chain ${chain} not configured for PoC on ${net}`)
  }

  const pocContracts = chainConfig.poc as Record<string, string> | undefined
  if (!pocContracts) {
    throw new Error(`PoC contracts not configured for ${chain}`)
  }

  if (!chainConfig.rpcUrl) {
    throw new Error(`RPC URL not configured for ${chain}`)
  }

  const validatorAddress = pocContracts.validator
  const identityRegistryAddress = pocContracts.identityRegistry
  if (!validatorAddress || !identityRegistryAddress) {
    throw new Error(
      `PoC validator or identityRegistry not configured for ${chain}`,
    )
  }

  return {
    validatorAddress,
    identityRegistryAddress,
    rpcUrl: chainConfig.rpcUrl,
    chainId: chainConfig.chainId,
  }
}

/** Get PoC validator address */
export function getPoCValidatorAddress(network?: NetworkType): string {
  return getPoCConfig(network).validatorAddress
}

/** Get PoC identity registry address */
export function getPoCIdentityRegistryAddress(network?: NetworkType): string {
  return getPoCConfig(network).identityRegistryAddress
}

/** Get PoC RPC URL (Base Sepolia or Base mainnet) */
export function getPoCRpcUrl(network?: NetworkType): string {
  return getPoCConfig(network).rpcUrl
}

/** Get external chain RPC URL */
export function getExternalRpc(chain: string): string {
  const envKey = `${chain.toUpperCase()}_RPC_URL`
  const envValue = process.env[envKey]
  if (envValue) return envValue

  const contracts = loadContracts()
  const chainConfig = contracts.external[chain]
  if (!chainConfig) {
    throw new Error(
      `External chain ${chain} not configured. Set ${envKey} or add to contracts.json`,
    )
  }
  if (!chainConfig.rpcUrl) {
    throw new Error(`RPC URL not configured for external chain ${chain}`)
  }
  return chainConfig.rpcUrl
}

/** Get all contracts for current network */
export function getContractsConfig(network?: NetworkType): NetworkContracts {
  const net = network ?? getCurrentNetwork()
  const contracts =
    loadContracts()[
      net as keyof Pick<ContractsConfig, 'localnet' | 'testnet' | 'mainnet'>
    ]
  if (!contracts) {
    throw new Error(`No contracts configured for network: ${net}`)
  }
  return contracts
}

// ============================================================================
// Services
// ============================================================================

/**
 * Get env var with VITE_ or NEXT_PUBLIC_ prefix support
 * Checks: process.env.{key}, VITE_{key}, NEXT_PUBLIC_{key}
 */
function getEnvService(key: string): string | undefined {
  return (
    process.env[key] ||
    process.env[`VITE_${key}`] ||
    process.env[`NEXT_PUBLIC_${key}`]
  )
}

/** Get services config with env overrides */
export function getServicesConfig(
  network?: NetworkType,
): ServicesNetworkConfig {
  const net = network ?? getCurrentNetwork()
  const config = loadServices()[net]

  return {
    ...config,
    rpc: {
      l1:
        getEnvService('JEJU_L1_RPC_URL') ??
        getEnvService('L1_RPC_URL') ??
        config.rpc.l1,
      l2:
        getEnvService('JEJU_RPC_URL') ??
        getEnvService('RPC_URL') ??
        config.rpc.l2,
      ws:
        getEnvService('JEJU_WS_URL') ??
        getEnvService('WS_URL') ??
        config.rpc.ws,
    },
    explorer: getEnvService('JEJU_EXPLORER_URL') ?? config.explorer,
    indexer: {
      graphql:
        getEnvService('INDEXER_URL') ??
        getEnvService('INDEXER_GRAPHQL_URL') ??
        config.indexer.graphql,
      websocket: getEnvService('INDEXER_WS_URL') ?? config.indexer.websocket,
    },
    gateway: {
      ui: getEnvService('GATEWAY_URL') ?? config.gateway.ui,
      api: getEnvService('GATEWAY_API_URL') ?? config.gateway.api,
      a2a: getEnvService('GATEWAY_A2A_URL') ?? config.gateway.a2a,
      mcp: getEnvService('GATEWAY_MCP_URL') ?? config.gateway.mcp,
      ws: getEnvService('GATEWAY_WS_URL') ?? config.gateway.ws,
    },
    rpcGateway: getEnvService('RPC_GATEWAY_URL') ?? config.rpcGateway,
    bazaar: getEnvService('BAZAAR_URL') ?? config.bazaar,
    storage: {
      api:
        getEnvService('STORAGE_API_URL') ??
        getEnvService('JEJU_IPFS_API') ??
        config.storage.api,
      ipfsGateway:
        getEnvService('IPFS_GATEWAY_URL') ??
        getEnvService('JEJU_IPFS_GATEWAY') ??
        config.storage.ipfsGateway,
    },
    compute: {
      marketplace: getEnvService('COMPUTE_URL') ?? config.compute.marketplace,
      nodeApi: getEnvService('COMPUTE_API_URL') ?? config.compute.nodeApi,
    },
    oif: {
      aggregator: getEnvService('OIF_AGGREGATOR_URL') ?? config.oif.aggregator,
    },
    leaderboard: {
      api: getEnvService('LEADERBOARD_API_URL') ?? config.leaderboard.api,
      ui: getEnvService('LEADERBOARD_URL') ?? config.leaderboard.ui,
    },
    monitoring: config.monitoring,
    crucible: config.crucible,
    cql: {
      blockProducer:
        getEnvService('CQL_BLOCK_PRODUCER_ENDPOINT') ??
        getEnvService('CQL_URL') ??
        config.cql.blockProducer,
      miner: getEnvService('CQL_MINER_ENDPOINT') ?? config.cql.miner,
    },
    dws: {
      api:
        getEnvService('DWS_URL') ??
        getEnvService('DWS_API_URL') ??
        config.dws.api,
      compute: getEnvService('DWS_COMPUTE_URL') ?? config.dws.compute,
    },
    autocrat: {
      api:
        getEnvService('AUTOCRAT_URL') ??
        getEnvService('AUTOCRAT_API_URL') ??
        config.autocrat.api,
      a2a: getEnvService('AUTOCRAT_A2A_URL') ?? config.autocrat.a2a,
    },
    kms: {
      api:
        getEnvService('KMS_URL') ??
        getEnvService('KMS_API_URL') ??
        config.kms.api,
      mpc: getEnvService('KMS_MPC_URL') ?? config.kms.mpc,
    },
    factory: {
      ui: getEnvService('FACTORY_URL') ?? config.factory.ui,
      api: getEnvService('FACTORY_API_URL') ?? config.factory.api,
      mcp: getEnvService('FACTORY_MCP_URL') ?? config.factory.mcp,
    },
  }
}

/** Get a service URL */
export function getServiceUrl(
  service:
    | 'rpc'
    | 'indexer'
    | 'gateway'
    | 'storage'
    | 'compute'
    | 'oif'
    | 'leaderboard'
    | 'rpcGateway'
    | 'bazaar'
    | 'explorer',
  subService?: string,
  network?: NetworkType,
): string {
  const config = getServicesConfig(network)

  // Handle direct string services
  if (service === 'rpcGateway') return config.rpcGateway
  if (service === 'bazaar') return config.bazaar
  if (service === 'explorer') return config.explorer

  if (service === 'rpc') {
    if (subService === 'l1') return config.rpc.l1
    if (subService === 'ws') return config.rpc.ws
    return config.rpc.l2
  }

  const svc = config[service]
  if (typeof svc === 'string') return svc

  if (typeof svc === 'object') {
    if (subService) {
      const url = (svc as Record<string, string>)[subService]
      if (!url) {
        throw new Error(`Service ${service}.${subService} not configured`)
      }
      return url
    }
    // Return first value if no subservice specified
    const values = Object.values(svc)
    if (values.length === 0) {
      throw new Error(`Service ${service} has no URLs configured`)
    }
    return values[0] as string
  }

  throw new Error(`Service ${service} not configured`)
}

// ============================================================================
// Convenience
// ============================================================================

export function getRpcUrl(network?: NetworkType): string {
  return getServicesConfig(network).rpc.l2
}

export function getWsUrl(network?: NetworkType): string {
  return getServicesConfig(network).rpc.ws
}

export function getL1RpcUrl(network?: NetworkType): string {
  return getServicesConfig(network).rpc.l1
}

export function getExplorerUrl(network?: NetworkType): string {
  return getServicesConfig(network).explorer
}

// ============================================================================
// Decentralized Services (CQL, DWS, Autocrat)
// ============================================================================

/** Get CovenantSQL block producer URL - for decentralized database */
export function getCQLUrl(network?: NetworkType): string {
  return getServicesConfig(network).cql.blockProducer
}

/** Get CovenantSQL miner URL */
export function getCQLMinerUrl(network?: NetworkType): string {
  return getServicesConfig(network).cql.miner
}

/** Get DWS (Decentralized Web Services) API URL */
export function getDWSUrl(network?: NetworkType): string {
  return getServicesConfig(network).dws.api
}

/** Get DWS compute endpoint */
export function getDWSComputeUrl(network?: NetworkType): string {
  return getServicesConfig(network).dws.compute
}

/** Get Autocrat (DAO governance) API URL */
export function getAutocratUrl(network?: NetworkType): string {
  return getServicesConfig(network).autocrat.api
}

/** Get Autocrat A2A endpoint */
export function getAutocratA2AUrl(network?: NetworkType): string {
  return getServicesConfig(network).autocrat.a2a
}

/** Get MPC KMS (Key Management System) API URL - for decentralized key storage */
export function getKMSUrl(network?: NetworkType): string {
  return getServicesConfig(network).kms.api
}

/** Get MPC KMS endpoint for threshold signing */
export function getKMSMpcUrl(network?: NetworkType): string {
  return getServicesConfig(network).kms.mpc
}

/** Get Crucible (execution) API URL */
export function getCrucibleUrl(network?: NetworkType): string {
  return getServicesConfig(network).crucible.api
}

/** Get SecurityBountyRegistry contract address */
export function getSecurityBountyRegistryAddress(
  network?: NetworkType,
): string {
  return getContract('security', 'bountyRegistry', network)
}

export function getBridgeContractAddress(
  network: NetworkType,
  layer: 'l1' | 'l2',
  contractName: string,
): string {
  const config = loadChainConfig(network)
  const contracts = layer === 'l1' ? config.contracts.l1 : config.contracts.l2
  const address = contracts[contractName as keyof typeof contracts]
  if (!address)
    throw new Error(
      `Contract ${contractName} not found on ${layer} for ${network}`,
    )
  return address
}

// ============================================================================
// Config
// ============================================================================

// Alias for backwards compatibility
export type ServicesConfig = ServicesNetworkConfig

export interface NetworkConfig {
  network: NetworkType
  chain: ChainConfig
  services: ServicesNetworkConfig
  contracts: NetworkContracts
}

/** Get full config for current network */
export function getConfig(network?: NetworkType): NetworkConfig {
  const net = network ?? getCurrentNetwork()
  return {
    network: net,
    chain: _getChainConfig(net),
    services: getServicesConfig(net),
    contracts: getContractsConfig(net),
  }
}

// ============================================================================
// Frontend Helpers
// ============================================================================

/**
 * Get all contracts needed for frontend apps
 * Returns addresses with env override support for VITE_ and NEXT_PUBLIC_
 */
export function getFrontendContracts(network?: NetworkType) {
  const net = network ?? getCurrentNetwork()
  return {
    // Tokens
    jeju: getContract('tokens', 'jeju', net),
    elizaOS: getContract('tokens', 'elizaOS', net),
    usdc: getContract('tokens', 'usdc', net),
    weth: getConstant('weth'),

    // Registry
    identityRegistry: getContract('registry', 'identity', net),
    tokenRegistry: getContract('registry', 'token', net),
    appRegistry: getContract('registry', 'app', net),

    // Moderation
    banManager: getContract('moderation', 'banManager', net),
    moderationMarketplace: getContract(
      'moderation',
      'moderationMarketplace',
      net,
    ),
    reportingSystem: getContract('moderation', 'reportingSystem', net),
    reputationLabelManager: getContract(
      'moderation',
      'reputationLabelManager',
      net,
    ),

    // Node Staking
    nodeStakingManager: getContract('nodeStaking', 'manager', net),
    nodePerformanceOracle: getContract('nodeStaking', 'performanceOracle', net),

    // JNS
    jnsRegistry: getContract('jns', 'registry', net),
    jnsResolver: getContract('jns', 'resolver', net),
    jnsRegistrar: getContract('jns', 'registrar', net),
    jnsReverseRegistrar: getContract('jns', 'reverseRegistrar', net),

    // Payments
    paymasterFactory: getContract('payments', 'paymasterFactory', net),
    priceOracle: getContract('payments', 'priceOracle', net),
    x402Facilitator: getContract('payments', 'x402Facilitator', net),

    // DeFi
    poolManager: getContract('defi', 'poolManager', net),
    swapRouter: getContract('defi', 'swapRouter', net),
    positionManager: getContract('defi', 'positionManager', net),

    // Governance
    governor: getContract('governance', 'governor', net),
    futarchyGovernor: getContract('governance', 'futarchyGovernor', net),

    // OIF
    solverRegistry: getContract('oif', 'solverRegistry', net),
    inputSettler: getContract('oif', 'inputSettler', net),

    // EIL
    crossChainPaymaster: getContract('eil', 'crossChainPaymaster', net),

    // Constants
    entryPoint: getConstant('entryPoint'),
    entryPointV07: getConstant('entryPointV07'),
  }
}

/**
 * Get all service URLs needed for frontend apps
 */
export function getFrontendServices(network?: NetworkType) {
  const config = getServicesConfig(network)
  return {
    rpcUrl: config.rpc.l2,
    wsUrl: config.rpc.ws,
    explorerUrl: config.explorer,
    indexerUrl: config.indexer.graphql,
    gatewayUrl: config.gateway.ui,
    gatewayApiUrl: config.gateway.api,
    rpcGatewayUrl: config.rpcGateway,
    bazaarUrl: config.bazaar,
    ipfsApiUrl: config.storage.api,
    ipfsGatewayUrl: config.storage.ipfsGateway,
    oifAggregatorUrl: config.oif.aggregator,
    leaderboardApiUrl: config.leaderboard.api,
  }
}

// ============================================================================
// EIL (Cross-Chain Liquidity)
// ============================================================================

let eilCache: EILConfig | null = null

function loadEILConfig(): EILConfig {
  if (!eilCache) {
    eilCache = EILConfigSchema.parse(loadJsonRaw('eil.json'))
  }
  return eilCache
}

/** Get EIL config for a network */
export function getEILConfig(network?: NetworkType): EILNetworkConfig {
  const net = network ?? getCurrentNetwork()
  const config = loadEILConfig()[net]
  if (!config) {
    throw new Error(`EIL config not found for network: ${net}`)
  }
  return config
}

/** Get all supported EIL chains for a network */
export function getEILChains(
  network?: NetworkType,
): Record<string, EILChainConfig> {
  return getEILConfig(network).chains
}

/** Get EIL chain config by chain name */
export function getEILChain(
  chainName: string,
  network?: NetworkType,
): EILChainConfig | undefined {
  return getEILConfig(network).chains[chainName]
}

/** Get EIL chain by chain ID */
export function getEILChainById(
  chainId: number,
  network?: NetworkType,
): EILChainConfig | undefined {
  const chains = getEILChains(network)
  return Object.values(chains).find((c) => c.chainId === chainId)
}

/** Get all EIL supported chain IDs */
export function getEILChainIds(network?: NetworkType): number[] {
  return Object.values(getEILChains(network)).map((c) => c.chainId)
}

/** Get EIL hub config */
export function getEILHub(network?: NetworkType) {
  return getEILConfig(network).hub
}

/** Get cross-chain paymaster address for a specific chain */
export function getCrossChainPaymaster(
  chainNameOrId: string | number,
  network?: NetworkType,
): string {
  const chain =
    typeof chainNameOrId === 'number'
      ? getEILChainById(chainNameOrId, network)
      : getEILChain(chainNameOrId, network)
  if (!chain) {
    throw new Error(`EIL chain ${chainNameOrId} not configured`)
  }
  if (!chain.crossChainPaymaster) {
    throw new Error(
      `Cross-chain paymaster not configured for chain ${chainNameOrId}`,
    )
  }
  return chain.crossChainPaymaster
}

/** Get supported token address on a specific chain */
export function getEILToken(
  chainNameOrId: string | number,
  tokenSymbol: string,
  network?: NetworkType,
): string {
  const chain =
    typeof chainNameOrId === 'number'
      ? getEILChainById(chainNameOrId, network)
      : getEILChain(chainNameOrId, network)
  if (!chain) {
    throw new Error(`EIL chain ${chainNameOrId} not configured`)
  }
  const token = chain.tokens[tokenSymbol]
  if (!token) {
    throw new Error(
      `Token ${tokenSymbol} not configured for EIL chain ${chainNameOrId}`,
    )
  }
  return token
}

// ============================================================================
// Vendor Apps (for setup scripts)
// ============================================================================

export function loadVendorAppsConfig(): { apps: VendorAppConfig[] } {
  return VendorAppsConfigSchema.parse(loadJsonRaw('vendor-apps.json'))
}

// ============================================================================
// Testnet Config (quick access)
// ============================================================================

/** Load the full testnet configuration */
export function getTestnetConfig(): TestnetConfig {
  return TestnetConfigSchema.parse(loadJsonRaw('testnet.json'))
}

/** Get the testnet RPC URL */
export function getTestnetRpc(): string {
  return getTestnetConfig().jeju.rpc.http
}

/** Get the testnet chain ID */
export function getTestnetChainId(): number {
  return getTestnetConfig().jeju.chainId
}

/** Get all testnet supported chain IDs */
export function getTestnetChainIds(): number[] {
  const config = getTestnetConfig()
  return [
    config.jeju.chainId,
    config.l1.chainId,
    ...Object.values(config.supportedChains).map(() => 0), // Will need actual chain IDs
  ].filter(Boolean)
}

// ============================================================================
// Federation Config
// ============================================================================

let federationCache: FederationFullConfig | null = null

function loadFederationConfig(): FederationFullConfig {
  if (!federationCache) {
    federationCache = FederationFullConfigSchema.parse(
      loadJsonRaw('federation.json'),
    )
  }
  return federationCache
}

/** Get federation hub config for current network type */
export function getFederationHub(network?: NetworkType): FederationHubConfig {
  const net = network ?? getCurrentNetwork()
  const config = loadFederationConfig()
  return net === 'mainnet' ? config.hub.mainnet : config.hub.testnet
}

/** Get all federated networks */
export function getFederatedNetworks(): Record<
  string,
  FederationNetworkConfig
> {
  return loadFederationConfig().networks
}

/** Get a specific federated network by name */
export function getFederatedNetwork(
  name: string,
): FederationNetworkConfig | undefined {
  return loadFederationConfig().networks[name]
}

/** Get federation cross-chain config */
export function getFederationCrossChainConfig() {
  return loadFederationConfig().crossChain
}

/** Get the full federation config */
export function getFederationConfig(): FederationFullConfig {
  return loadFederationConfig()
}

/** Get federation discovery endpoints */
export function getFederationDiscoveryEndpoints(): string[] {
  return loadFederationConfig().discovery.endpoints
}

// ============================================================================
// Branding Config
// ============================================================================

export {
  clearBrandingCache,
  generateForkBranding,
  getApiUrl,
  getBranding,
  getChainBranding,
  getCliBranding,
  getExplorerUrl as getBrandingExplorerUrl,
  getFeatures,
  getGatewayUrl,
  getGovernanceToken,
  getLegal,
  getNativeToken,
  getNetworkDescription,
  getNetworkDisplayName,
  getNetworkName,
  getNetworkTagline,
  getRpcUrl as getBrandingRpcUrl,
  getSupport,
  getUrls,
  getVisualBranding,
  getWebsiteUrl,
  interpolate,
  setConfigPath,
} from './branding'

// ============================================================================
// Secrets & API Keys
// ============================================================================

export type {
  AIProviderKeys,
  ApiKeyConfig,
  ApiKeyName,
  ApiKeyStatus,
  BlockExplorerKeys,
} from './api-keys'
export {
  generateApiKeyDocs,
  getAIProviderKeys,
  getApiKey,
  getApiKeyConfig,
  getApiKeyStatus,
  getApiKeySync,
  getBlockExplorerKeys,
  getExplorerKeyForChain,
  hasAnyAIProvider,
  hasApiKey,
  printApiKeyStatus,
} from './api-keys'
export type { SecretName, SecretProvider, SecretResult } from './secrets'
export {
  getActiveProvider,
  getSecret,
  getSecretWithProvider,
  initSecretsDirectory,
  requireSecret,
  requireSecretSync,
  storeAWSSecret,
  storeLocalSecret,
  validateSecrets,
} from './secrets'

// ============================================================================
// Test Keys
// ============================================================================

export {
  ANVIL_KEYS,
  BSC_FUNDING_WARNING,
  type ChainBalance,
  formatKeyForDisplay,
  getDeployerKey,
  getKeyByRole,
  getMultisigSigners,
  getRoleDescription,
  getTestKeys,
  loadSolanaKeys,
  printKeys,
  ROLE_CONFIGS,
  type RoleConfig,
  SOLANA_ROLE_PATHS,
  saveSolanaKeys,
  saveTestnetKeys,
  solanaKeysExist,
  TEST_MNEMONIC,
  TESTNET_CHAINS,
  type TestKeySet,
  testnetKeysExist,
} from './test-keys'

// ============================================================================
// Config Updates (for deployment scripts)
// ============================================================================

export {
  applyArtifactToConfig,
  applyTerraformOutputs,
  applyTerraformOutputsFile,
  type DeploymentArtifact,
  loadLatestArtifact,
  printConfigSummary,
  saveDeploymentArtifact,
  updateChainConfig,
  updateContractAddress,
  updateContracts,
  updateEILChain,
  updateExternalContract,
  updateExternalRpc,
  updateServiceUrl,
  validateConfig,
} from './update'
