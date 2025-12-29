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
 * - infrastructure.json  Node infrastructure (for deployment)
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

// JSON imports with type assertions for Node ESM compatibility (Playwright)
import localnetChainRaw from './chain/localnet.json' with { type: 'json' }
import mainnetChainRaw from './chain/mainnet.json' with { type: 'json' }
import testnetChainRaw from './chain/testnet.json' with { type: 'json' }
// Direct JSON imports for browser compatibility (bundlers inline these)
import contractsJsonRaw from './contracts.json' with { type: 'json' }
import eilJsonRaw from './eil.json' with { type: 'json' }
import federationJsonRaw from './federation.json' with { type: 'json' }
import {
  type ChainConfig,
  ChainConfigSchema,
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
  NetworkSchema,
  type NetworkType,
  ServicesConfigSchema,
  type ServicesNetworkConfig,
  type VendorAppConfig,
  VendorAppsConfigSchema,
} from './schemas'
import servicesJsonRaw from './services.json' with { type: 'json' }
import vendorAppsJsonRaw from './vendor-apps.json' with { type: 'json' }

export * from './dev-proxy'
// Network utilities
// Note: Some of these use fs and are Node.js-only (loadDeployedContracts, getNetworkInfo)
// They will throw in browser builds if called, but won't break the import
export {
  checkHasBalance,
  checkRpcReachable,
  type DeployedContracts,
  ENTRYPOINT_V07,
  getContractAddress,
  getDeployerConfig,
  getNetworkInfo,
  L2_PREDEPLOYS,
  loadDeployedContracts,
  type NetworkInfo,
  TEST_ACCOUNTS,
} from './network'
export * from './ports'
export * from './rpc-chains'

import { getBridgeRelayerUrl } from './ports'

export * from './schemas'

// Types from schemas.ts

// ContractCategory is exported from schemas.ts, alias for backwards compatibility
export type ContractCategoryName = ContractCategory

type NetworkContracts = ContractsConfig['localnet']

// Chain Configs (from direct imports - browser safe)

const chainConfigs: Record<NetworkType, ChainConfig> = {
  localnet: ChainConfigSchema.parse(localnetChainRaw),
  testnet: ChainConfigSchema.parse(testnetChainRaw),
  mainnet: ChainConfigSchema.parse(mainnetChainRaw),
}

// Loaders (using direct imports - browser safe)

let contractsCache: ContractsConfig | null = null
let servicesCache: Record<NetworkType, ServicesNetworkConfig> | null = null

function loadContracts(): ContractsConfig {
  if (!contractsCache) {
    contractsCache = ContractsConfigSchema.parse(contractsJsonRaw)
  }
  return contractsCache
}

function loadServices(): Record<NetworkType, ServicesNetworkConfig> {
  if (!servicesCache) {
    servicesCache = ServicesConfigSchema.parse(servicesJsonRaw)
  }
  return servicesCache
}

/**
 * Get chain config - browser safe (uses pre-imported JSON)
 */
export function getChainConfig(network?: NetworkType): ChainConfig {
  return chainConfigs[network ?? getCurrentNetwork()]
}

/**
 * Load chain config (alias for getChainConfig for backwards compatibility)
 */
export function loadChainConfig(network: NetworkType): ChainConfig {
  return getChainConfig(network)
}

/**
 * Get the current network based on environment or default
 * Browser safe - doesn't use fs
 */
export function getCurrentNetwork(): NetworkType {
  // Browser check - look for Vite env vars
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>
    const importMeta = g.import as
      | { meta?: { env?: Record<string, string> } }
      | undefined
    if (importMeta?.meta?.env?.VITE_NETWORK) {
      const result = NetworkSchema.safeParse(importMeta.meta.env.VITE_NETWORK)
      if (result.success) return result.data
    }
  }

  // Node.js check
  const envNetwork =
    typeof process !== 'undefined' ? process.env.JEJU_NETWORK : undefined
  if (!envNetwork) return 'localnet'

  const result = NetworkSchema.safeParse(envNetwork)
  if (!result.success) {
    throw new Error(
      `Invalid JEJU_NETWORK: ${envNetwork}. Must be one of: localnet, testnet, mainnet`,
    )
  }
  return result.data
}

// Core Functions

/** Get chain ID */
export function getChainId(network?: NetworkType): number {
  return getChainConfig(network).chainId
}

/**
 * Get the localhost host address for building local service URLs
 * Respects environment variables: HOST, RPC_HOST, LOCALHOST_HOST
 * Defaults to '127.0.0.1' for consistency with existing codebase
 *
 * @example
 * ```ts
 * const host = getLocalhostHost() // '127.0.0.1' or env override
 * const url = `http://${host}:${port}`
 * ```
 */
export function getLocalhostHost(): string {
  return (
    process.env.HOST ||
    process.env.RPC_HOST ||
    process.env.LOCALHOST_HOST ||
    '127.0.0.1'
  )
}

// Contracts

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
 * Checks: VITE_{NAME}_ADDRESS, PUBLIC_{NAME}_ADDRESS, then config
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

  // Check PUBLIC_ format (for Next.js apps)
  const nextKey = `PUBLIC_${envName}_ADDRESS`
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

/**
 * Try to get contract address, returns empty string if not found
 * Useful for optional contracts that may not be deployed
 */
export function tryGetContract(
  category: ContractCategoryName,
  name: string,
  network?: NetworkType,
): string {
  try {
    return getContract(category, name, network)
  } catch {
    return ''
  }
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

// Proof-of-Cloud (PoC) Configuration

export interface PoCConfig {
  validatorAddress: string
  identityRegistryAddress: string
  rpcUrl: string
  chainId: number
}

/** Get PoC configuration for the default chain (Base Sepolia for testnet) */
export function getPoCConfig(network?: NetworkType): PoCConfig {
  const net = network ?? getCurrentNetwork()
  const chain = net === 'mainnet' ? 'base' : 'base-sepolia'
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

// Services

/**
 * Get env var with VITE_ or PUBLIC_ prefix support
 * Checks: process.env.{key}, VITE_{key}, PUBLIC_{key}
 */
function getEnvService(key: string): string | undefined {
  return (
    process.env[key] ||
    process.env[`VITE_${key}`] ||
    process.env[`PUBLIC_${key}`]
  )
}

/** Get services config with env overrides. Network-specific env vars take priority. */
export function getServicesConfig(
  network?: NetworkType,
): ServicesNetworkConfig {
  const net = network ?? getCurrentNetwork()
  const config = loadServices()[net]
  const networkPrefix = `JEJU_${net.toUpperCase()}_`

  return {
    ...config,
    rpc: {
      l1:
        getEnvService(`${networkPrefix}L1_RPC_URL`) ??
        getEnvService('JEJU_L1_RPC_URL') ??
        getEnvService('L1_RPC_URL') ??
        config.rpc.l1,
      l2:
        getEnvService(`${networkPrefix}RPC_URL`) ??
        getEnvService('JEJU_RPC_URL') ??
        getEnvService('RPC_URL') ??
        config.rpc.l2,
      ws:
        getEnvService(`${networkPrefix}WS_URL`) ??
        getEnvService('JEJU_WS_URL') ??
        getEnvService('WS_URL') ??
        config.rpc.ws,
    },
    explorer:
      getEnvService(`${networkPrefix}EXPLORER_URL`) ??
      getEnvService('JEJU_EXPLORER_URL') ??
      config.explorer,
    indexer: {
      api: getEnvService('INDEXER_API_URL') ?? config.indexer.api,
      graphql:
        getEnvService('INDEXER_URL') ??
        getEnvService('INDEXER_GRAPHQL_URL') ??
        config.indexer.graphql,
      websocket: getEnvService('INDEXER_WS_URL') ?? config.indexer.websocket,
      rest: getEnvService('INDEXER_REST_URL') ?? config.indexer.rest,
      dws: getEnvService('INDEXER_DWS_URL') ?? config.indexer.dws,
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
    eqlite: {
      blockProducer:
        getEnvService('EQLITE_BLOCK_PRODUCER_ENDPOINT') ??
        getEnvService('EQLITE_URL') ??
        config.eqlite.blockProducer,
      miner: getEnvService('EQLITE_MINER_ENDPOINT') ?? config.eqlite.miner,
    },
    dws: {
      api:
        getEnvService('DWS_URL') ??
        getEnvService('DWS_API_URL') ??
        config.dws.api,
      cache: getEnvService('DWS_CACHE_URL') ?? config.dws.cache,
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
    training: config.training
      ? {
          api:
            getEnvService('TRAINING_ENDPOINT') ??
            getEnvService('TRAINING_API_URL') ??
            config.training.api,
          atropos: getEnvService('ATROPOS_URL') ?? config.training.atropos,
          psyche: getEnvService('PSYCHE_URL') ?? config.training.psyche,
        }
      : undefined,
    ipfs: config.ipfs
      ? {
          api:
            getEnvService('IPFS_API_URL') ??
            getEnvService('IPFS_API_ENDPOINT') ??
            config.ipfs.api,
          gateway:
            getEnvService('IPFS_GATEWAY') ??
            getEnvService('IPFS_GATEWAY_URL') ??
            config.ipfs.gateway,
        }
      : undefined,
    agents: config.agents
      ? {
          api: getEnvService('AGENTS_API_URL') ?? config.agents.api,
          agent0:
            getEnvService('AGENT0_API_URL') ??
            getEnvService('JEJU_API_URL') ??
            config.agents.agent0,
        }
      : undefined,
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
    | 'explorer'
    | 'monitoring',
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

// Convenience

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

// Decentralized Services (EQLite, DWS, Autocrat)

/** Get EQLite block producer URL - for decentralized database */
export function getEQLiteUrl(network?: NetworkType): string {
  return getServicesConfig(network).eqlite.blockProducer
}

/** Get EQLite miner URL */
export function getEQLiteMinerUrl(network?: NetworkType): string {
  return getServicesConfig(network).eqlite.miner
}

/** Get DWS (Decentralized Web Services) API URL */
export function getDWSUrl(network?: NetworkType): string {
  return getServicesConfig(network).dws.api
}

/** Get DWS cache service URL */
export function getDWSCacheUrl(network?: NetworkType): string {
  return getServicesConfig(network).dws.cache
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

/** Get OAuth3 (decentralized identity) API URL */
export function getOAuth3Url(network?: NetworkType): string {
  const config = getServicesConfig(network)
  if (!config.oauth3?.api) {
    throw new Error(
      `OAuth3 API not configured for ${network ?? getCurrentNetwork()}. Set OAUTH3_URL or add oauth3.api to services.json`,
    )
  }
  return config.oauth3.api
}

/** Get Oracle API URL */
export function getOracleUrl(network?: NetworkType): string {
  const config = getServicesConfig(network)
  if (!config.oracle?.api) {
    throw new Error(
      `Oracle API not configured for ${network ?? getCurrentNetwork()}. Set ORACLE_URL or add oracle.api to services.json`,
    )
  }
  return config.oracle.api
}

/** Get Node API URL */
export function getNodeUrl(network?: NetworkType): string {
  const config = getServicesConfig(network)
  if (!config.node?.api) {
    throw new Error(
      `Node API not configured for ${network ?? getCurrentNetwork()}. Set NODE_URL or add node.api to services.json`,
    )
  }
  return config.node.api
}

/** Get external bundler URL */
export function getBundlerUrl(network?: NetworkType): string {
  const config = getServicesConfig(network)
  if (!config.external?.bundler) {
    throw new Error(
      `Bundler URL not configured for ${network ?? getCurrentNetwork()}. Set BUNDLER_URL or add external.bundler to services.json`,
    )
  }
  return config.external.bundler
}

/** Get Farcaster hub URL */
export function getFarcasterHubUrl(network?: NetworkType): string {
  const config = getServicesConfig(network)
  if (!config.external?.farcaster?.hub) {
    throw new Error(
      `Farcaster hub not configured for ${network ?? getCurrentNetwork()}. Set FARCASTER_HUB_URL or add external.farcaster.hub to services.json`,
    )
  }
  return config.external.farcaster.hub
}

/** Get Farcaster API URL (Neynar) */
export function getFarcasterApiUrl(network?: NetworkType): string {
  const config = getServicesConfig(network)
  if (!config.external?.farcaster?.api) {
    throw new Error(
      `Farcaster API not configured for ${network ?? getCurrentNetwork()}. Set FARCASTER_API_URL or add external.farcaster.api to services.json`,
    )
  }
  return config.external.farcaster.api
}

// TEE Configuration

export type TeeMode = 'simulated' | 'phala' | 'gcp' | 'aws'
export type TeePlatform = 'local' | 'phala' | 'gcp-confidential' | 'aws-nitro'

export interface TeeConfig {
  mode: TeeMode
  platform: TeePlatform
  region: string
  endpoint?: string
}

/** Get TEE configuration for current network */
export function getTeeConfig(network?: NetworkType): TeeConfig {
  const config = getServicesConfig(network)
  const net = network ?? getCurrentNetwork()

  if (!config.tee) {
    throw new Error(
      `TEE config not configured for ${net}. Set TEE_MODE/TEE_PLATFORM env vars or add tee config to services.json`,
    )
  }

  const tee = config.tee

  // Allow env overrides
  const mode = (process.env.TEE_MODE as TeeMode | undefined) ?? tee.mode
  const platform =
    (process.env.TEE_PLATFORM as TeePlatform | undefined) ?? tee.platform
  const region = process.env.TEE_REGION ?? tee.region
  const endpoint = process.env.TEE_ENDPOINT ?? tee.endpoint

  if (!mode || !platform) {
    throw new Error(
      `TEE mode and platform required for ${net}. Configure tee.mode and tee.platform in services.json`,
    )
  }

  return { mode, platform, region: region ?? 'local', endpoint }
}

/** Get TEE mode - simulated, phala, gcp, or aws */
export function getTeeMode(network?: NetworkType): TeeMode {
  return getTeeConfig(network).mode
}

/** Get TEE platform - local, phala, gcp-confidential, or aws-nitro */
export function getTeePlatform(network?: NetworkType): TeePlatform {
  return getTeeConfig(network).platform
}

/** Get TEE endpoint URL */
export function getTeeEndpoint(network?: NetworkType): string | undefined {
  return getTeeConfig(network).endpoint
}

/** Check if TEE is in simulated mode */
export function isTeeSimulated(network?: NetworkType): boolean {
  return getTeeConfig(network).mode === 'simulated'
}

/** Check if real TEE attestation is required */
export function requiresTeeAttestation(network?: NetworkType): boolean {
  const config = getTeeConfig(network)
  return config.mode !== 'simulated' && config.platform !== 'local'
}

// Environment Helpers

/** Check if running in production (mainnet) */
export function isProduction(network?: NetworkType): boolean {
  return (network ?? getCurrentNetwork()) === 'mainnet'
}

/** Check if running in testnet */
export function isTestnet(network?: NetworkType): boolean {
  return (network ?? getCurrentNetwork()) === 'testnet'
}

/** Check if running in localnet (development) */
export function isLocalnet(network?: NetworkType): boolean {
  return (network ?? getCurrentNetwork()) === 'localnet'
}

/** Check if NODE_ENV is production */
export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production'
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

// Config

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
    chain: getChainConfig(net),
    services: getServicesConfig(net),
    contracts: getContractsConfig(net),
  }
}

// Frontend Helpers

/**
 * Get all contracts needed for frontend apps
 * Returns addresses with env override support for VITE_ and PUBLIC_
 */
export function getFrontendContracts(network?: NetworkType) {
  const net = network ?? getCurrentNetwork()
  return {
    // Tokens
    jeju: getContract('tokens', 'jeju', net),
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

    // OAuth3
    oauth3TeeVerifier: tryGetContract('oauth3', 'teeVerifier', net),
    oauth3IdentityRegistry: tryGetContract('oauth3', 'identityRegistry', net),
    oauth3AppRegistry: tryGetContract('oauth3', 'appRegistry', net),

    // DWS (Decentralized Web Services)
    dwsStorageManager: tryGetContract('dws', 'storageManager', net),
    dwsWorkerRegistry: tryGetContract('dws', 'workerRegistry', net),
    cdnRegistry: tryGetContract('cdn', 'registry', net),

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

// EIL (Cross-Chain Liquidity)

let eilCache: EILConfig | null = null

function loadEILConfig(): EILConfig {
  if (!eilCache) {
    eilCache = EILConfigSchema.parse(eilJsonRaw)
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

// Vendor Apps (for setup scripts)

export function loadVendorAppsConfig(): { apps: VendorAppConfig[] } {
  return VendorAppsConfigSchema.parse(vendorAppsJsonRaw)
}

// Federation Config

let federationCache: FederationFullConfig | null = null

function loadFederationConfig(): FederationFullConfig {
  if (!federationCache) {
    federationCache = FederationFullConfigSchema.parse(federationJsonRaw)
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

// Training Configuration

/** Training service configuration */
export interface TrainingConfig {
  api: string
  atropos: string
  psyche?: string
}

/** Get training service configuration */
export function getTrainingConfig(network?: NetworkType): TrainingConfig {
  const config = getServicesConfig(network)
  if (!config.training) {
    throw new Error(
      `Training services not configured for ${network ?? getCurrentNetwork()}. Add training section to services.json`,
    )
  }
  return config.training
}

/** Get training API endpoint */
export function getTrainingApiUrl(network?: NetworkType): string {
  return getTrainingConfig(network).api
}

/** Get Atropos (GRPO trainer) URL */
export function getAtroposUrl(network?: NetworkType): string {
  return getTrainingConfig(network).atropos
}

/** Get Psyche coordinator URL */
export function getPsycheUrl(network?: NetworkType): string | undefined {
  return getTrainingConfig(network).psyche
}

// IPFS Configuration

/** IPFS service configuration */
export interface IpfsConfig {
  api: string
  gateway: string
}

/** Get IPFS configuration */
export function getIpfsConfig(network?: NetworkType): IpfsConfig {
  const config = getServicesConfig(network)
  if (!config.ipfs) {
    // Fall back to storage config for backwards compatibility
    return {
      api: config.storage.api,
      gateway: config.storage.ipfsGateway,
    }
  }
  return config.ipfs
}

/** Get IPFS API URL */
export function getIpfsApiUrl(network?: NetworkType): string {
  return getIpfsConfig(network).api
}

/** Get IPFS gateway URL */
export function getIpfsGatewayUrl(network?: NetworkType): string {
  return getIpfsConfig(network).gateway
}

// Agents Configuration

/** Agents service configuration */
export interface AgentsConfig {
  api: string
  agent0?: string
}

/** Get agents configuration */
export function getAgentsConfig(network?: NetworkType): AgentsConfig {
  const config = getServicesConfig(network)
  if (!config.agents) {
    throw new Error(
      `Agents services not configured for ${network ?? getCurrentNetwork()}. Add agents section to services.json`,
    )
  }
  return config.agents
}

/** Get agents API URL */
export function getAgentsApiUrl(network?: NetworkType): string {
  return getAgentsConfig(network).api
}

/** Get Agent0 API URL */
export function getAgent0ApiUrl(network?: NetworkType): string | undefined {
  return getAgentsConfig(network).agent0
}

// Agent0 Environment Configuration

/** Check if Agent0 is enabled */
export function isAgent0Enabled(): boolean {
  return process.env.AGENT0_ENABLED === 'true'
}

/** Get Agent0 private key (secret - env var only) */
export function getAgent0PrivateKey(): string | undefined {
  return process.env.AGENT0_PRIVATE_KEY
}

/** Get Agent0 IPFS provider */
export function getAgent0IpfsProvider(): 'node' | 'filecoinPin' | 'pinata' {
  const ipfsEnv = process.env.AGENT0_IPFS_PROVIDER ?? 'node'
  if (ipfsEnv === 'node' || ipfsEnv === 'filecoinPin' || ipfsEnv === 'pinata') {
    return ipfsEnv
  }
  return 'node'
}

/** Get Pinata JWT (secret - env var only) */
export function getPinataJwt(): string | undefined {
  return process.env.PINATA_JWT
}

/** Get Filecoin private key (secret - env var only) */
export function getFilecoinPrivateKey(): string | undefined {
  return process.env.FILECOIN_PRIVATE_KEY
}

/** Get Agent0 subgraph URL */
export function getAgent0SubgraphUrl(): string | undefined {
  return process.env.AGENT0_SUBGRAPH_URL
}

/** Get Jeju API key (secret - env var only) */
export function getJejuApiKey(): string {
  return process.env.JEJU_API_KEY ?? ''
}

/** Get Jeju Compute API URL override */
export function getJejuComputeApiUrl(): string | undefined {
  return process.env.JEJU_COMPUTE_API_URL
}

/** Get Jeju user address */
export function getJejuUserAddress(): string | undefined {
  return process.env.JEJU_USER_ADDRESS
}

/** Get agent wallet address */
export function getAgentWalletAddress(): string | undefined {
  return process.env.AGENT_WALLET_ADDRESS
}

// Feature Flags

/** Check if dev mode is enabled */
export function isDevMode(): boolean {
  return (
    process.env.DEV_MODE === 'true' ||
    process.env.NODE_ENV === 'development' ||
    process.env.JEJU_DEV === 'true'
  )
}

/** Check if this is a deploy preview */
export function isDeployPreview(): boolean {
  return process.env.DEPLOY_PREVIEW === 'true'
}

/** Check if this is a staging deploy */
export function isDeployStaging(): boolean {
  return process.env.DEPLOY_STAGING === 'true'
}

/** Check if test mode */
export function isTestMode(): boolean {
  return process.env.NODE_ENV === 'test'
}

// Bridge Configuration

import {
  type BridgeConfig,
  BridgeConfigSchema,
  type BridgeMode,
} from './schemas'
export type { BridgeConfig, BridgeMode }

/** Bridge config cache keyed by mode */
let bridgeConfigCache: Map<BridgeMode, BridgeConfig> | null = null

/**
 * Resolve environment variable placeholders in a string.
 * Replaces ${VAR_NAME} with the value of process.env.VAR_NAME.
 * Falls back to empty string if env var is not set.
 */
function resolveEnvPlaceholders(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
    return process.env[envVar] ?? ''
  })
}

/**
 * Recursively resolve environment variable placeholders in an object.
 * Handles nested objects and arrays.
 */
function resolveEnvInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return resolveEnvPlaceholders(obj) as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvInObject(item)) as T
  }
  if (typeof obj === 'object' && obj !== null) {
    const resolved: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveEnvInObject(value)
    }
    return resolved as T
  }
  return obj
}

/**
 * Load bridge config for a specific mode.
 * Resolves ${ENV_VAR} placeholders in the config using process.env.
 *
 * @param mode - Bridge mode: 'local', 'testnet', or 'mainnet'
 * @returns Validated and env-resolved bridge configuration
 *
 * @example
 * ```ts
 * const config = await loadBridgeConfig('testnet');
 * console.log(config.chains.evm[0].rpcUrl); // Resolved from ${BASE_SEPOLIA_RPC}
 * ```
 */
export async function loadBridgeConfig(
  mode: BridgeMode,
): Promise<BridgeConfig> {
  if (!bridgeConfigCache) {
    bridgeConfigCache = new Map()
  }

  const cached = bridgeConfigCache.get(mode)
  if (cached) {
    return cached
  }

  // Import the JSON file dynamically based on mode
  const configPath = `@jejunetwork/bridge/config/${mode}.json`
  let rawConfig: unknown

  // Try to load from bridge package config, fall back to inline defaults
  try {
    const mod = await import(configPath)
    rawConfig = mod.default ?? mod
  } catch {
    // If bridge package isn't available, use default configs
    rawConfig = getDefaultBridgeConfig(mode)
  }

  // Resolve environment variable placeholders
  const resolvedConfig = resolveEnvInObject(rawConfig)

  // Validate with Zod schema
  const config = BridgeConfigSchema.parse(resolvedConfig)
  bridgeConfigCache.set(mode, config)

  return config
}

/**
 * Get default bridge config for a mode (used when bridge package config not found).
 * These match the JSON files in packages/bridge/config/.
 */
function getDefaultBridgeConfig(mode: BridgeMode): unknown {
  const baseConfig = {
    components: {
      relayer: true,
      prover: true,
      healthMonitor: true,
    },
    ports: {
      relayer: 8081,
      prover: 8082,
      health: 8083,
    },
  }

  if (mode === 'local') {
    return {
      ...baseConfig,
      mode: 'local',
      components: { ...baseConfig.components, beaconWatcher: false },
      chains: {
        evm: [
          {
            chainId: 31337,
            name: 'Local EVM (Anvil)',
            rpcUrl: getL1RpcUrl(),
            bridgeAddress: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
            lightClientAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
          },
        ],
        solana: {
          rpcUrl: getSolanaRpcUrl() || `http://${getLocalhostHost()}:8899`,
          bridgeProgramId: 'TokenBridge11111111111111111111111111111111',
          evmLightClientProgramId: 'EVMLightClient1111111111111111111111111111',
        },
      },
      tee: {
        endpoint: `http://${getLocalhostHost()}:8080`,
        maxBatchSize: 10,
        batchTimeoutMs: 30000,
      },
      prover: {
        mode: 'self-hosted',
        workers: 2,
        maxMemoryMb: 8192,
        timeoutMs: 300000,
        useMockProofs: true,
      },
    }
  }

  if (mode === 'testnet') {
    return {
      ...baseConfig,
      mode: 'testnet',
      components: { ...baseConfig.components, beaconWatcher: true },
      chains: {
        evm: [
          {
            chainId: 84532,
            name: 'Base Sepolia',
            rpcUrl: process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org',
            beaconUrl:
              process.env.BEACON_URL ?? 'https://lodestar-sepolia.chainsafe.io',
            bridgeAddress: process.env.BASE_BRIDGE_ADDRESS ?? '',
            lightClientAddress: process.env.BASE_LIGHT_CLIENT_ADDRESS ?? '',
          },
        ],
        solana: {
          network: 'devnet',
          rpcUrl:
            process.env.SOLANA_DEVNET_RPC ?? 'https://api.devnet.solana.com',
          bridgeProgramId: process.env.BRIDGE_PROGRAM_ID ?? '',
          evmLightClientProgramId:
            process.env.EVM_LIGHT_CLIENT_PROGRAM_ID ?? '',
        },
      },
      tee: {
        endpoint: process.env.TEE_ENDPOINT ?? '',
        maxBatchSize: 20,
        batchTimeoutMs: 60000,
      },
      prover: {
        mode: 'self-hosted',
        workers: 4,
        maxMemoryMb: 16384,
        timeoutMs: 600000,
        useMockProofs: false,
      },
    }
  }

  // mainnet
  return {
    ...baseConfig,
    mode: 'mainnet',
    components: { ...baseConfig.components, beaconWatcher: true },
    chains: {
      evm: [
        {
          chainId: 1,
          name: 'Ethereum',
          rpcUrl: process.env.ETH_RPC ?? '',
          beaconUrl: process.env.BEACON_URL ?? '',
          bridgeAddress: process.env.ETH_BRIDGE_ADDRESS ?? '',
          lightClientAddress: process.env.ETH_LIGHT_CLIENT_ADDRESS ?? '',
        },
        {
          chainId: 8453,
          name: 'Base',
          rpcUrl: process.env.BASE_RPC ?? 'https://mainnet.base.org',
          bridgeAddress: process.env.BASE_BRIDGE_ADDRESS ?? '',
          lightClientAddress: process.env.BASE_LIGHT_CLIENT_ADDRESS ?? '',
        },
      ],
      solana: {
        network: 'mainnet-beta',
        rpcUrl: process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com',
        bridgeProgramId: process.env.BRIDGE_PROGRAM_ID ?? '',
        evmLightClientProgramId: process.env.EVM_LIGHT_CLIENT_PROGRAM_ID ?? '',
      },
    },
    tee: {
      endpoint: process.env.TEE_ENDPOINT ?? '',
      maxBatchSize: 50,
      batchTimeoutMs: 120000,
      requireRealTEE: true,
    },
    prover: {
      mode: 'self-hosted',
      workers: 8,
      maxMemoryMb: 32768,
      timeoutMs: 900000,
      useMockProofs: false,
    },
    security: {
      multisigRequired: true,
      minValidators: 3,
      validatorThreshold: 2,
    },
  }
}

/**
 * Get bridge mode from environment or CLI argument.
 * Checks BRIDGE_MODE env var first, defaults to 'local'.
 */
export function getBridgeMode(): BridgeMode {
  const mode = process.env.BRIDGE_MODE
  if (mode === 'local' || mode === 'testnet' || mode === 'mainnet') {
    return mode
  }
  // Default to local for development
  return 'local'
}

/**
 * Clear bridge config cache (useful for testing).
 */
export function clearBridgeConfigCache(): void {
  bridgeConfigCache = null
}

/**
 * Get bridge private key for relayer transactions.
 * - Local mode: Uses well-known Anvil test key (safe for local development only)
 * - Testnet/Mainnet: Requires PRIVATE_KEY environment variable
 *
 * @param mode - Bridge mode
 * @throws Error if PRIVATE_KEY not set for testnet/mainnet
 */
export function getBridgePrivateKey(mode: BridgeMode): string {
  const envKey = process.env.PRIVATE_KEY

  if (envKey) {
    return envKey
  }

  // SECURITY: Only allow default test key in local mode
  if (mode === 'local') {
    // This is the well-known first Anvil/Hardhat test key
    // NEVER use this in testnet or mainnet
    return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  }

  throw new Error(
    `PRIVATE_KEY environment variable is required for ${mode} mode. ` +
      `Set it in your .env file or environment. ` +
      `NEVER commit private keys to source control.`,
  )
}

/** Get XLP private key (secret - env var only) */
export function getXlpPrivateKey(): string | undefined {
  return process.env.XLP_PRIVATE_KEY
}

/** Get 1inch API key (secret - env var only) */
export function getOneInchApiKey(): string | undefined {
  return process.env.ONEINCH_API_KEY
}

/** Get GCP project */
export function getGcpProject(): string | undefined {
  return process.env.GCP_PROJECT
}

/** Get GCP zone */
export function getGcpZone(): string {
  return process.env.GCP_ZONE ?? 'us-central1-a'
}

/** Check if GCP confidential simulate mode */
export function isGcpConfidentialSimulate(): boolean {
  return process.env.GCP_CONFIDENTIAL_SIMULATE === 'true'
}

/** Get home directory */
export function getHomeDir(): string {
  return process.env.HOME ?? ''
}

/** Get relayer port */
export function getRelayerPort(): number {
  return parseInt(process.env.RELAYER_PORT ?? '8081', 10)
}

/** Get EVM chain ID */
export function getEvmChainId(): number {
  return parseInt(process.env.EVM_CHAIN_ID ?? '31337', 10)
}

/** Get SP1 prover URL */
export function getSp1ProverUrl(): string | undefined {
  return process.env.SP1_PROVER_URL
}

/** Get Succinct API key (secret - env var only) */
export function getSuccinctApiKey(): string | undefined {
  return process.env.SUCCINCT_API_KEY
}

/** Get Phala endpoint */
export function getPhalaEndpoint(): string | undefined {
  return process.env.PHALA_ENDPOINT
}

/** Get Phala API key (secret - env var only) */
export function getPhalaApiKey(): string | undefined {
  return process.env.PHALA_API_KEY
}

/** Check if AWS Nitro simulate mode */
export function isAwsNitroSimulate(): boolean {
  return process.env.AWS_NITRO_SIMULATE === 'true'
}

/** Get AWS Enclave ID */
export function getAwsEnclaveId(): string | undefined {
  return process.env.AWS_ENCLAVE_ID
}

/** Get AWS region */
export function getAwsRegion(): string {
  return process.env.AWS_REGION ?? 'us-east-1'
}

/** Check if real proofs required */
export function isRequireRealProofs(): boolean {
  return process.env.REQUIRE_REAL_PROOFS === 'true'
}

/** Check if real TEE required */
export function isRequireRealTee(): boolean {
  return process.env.REQUIRE_REAL_TEE === 'true'
}

/** Get beacon URL */
export function getBeaconUrl(): string | undefined {
  return process.env.BEACON_URL
}

/** Get beacon RPC URL */
export function getBeaconRpcUrl(): string {
  return process.env.BEACON_RPC_URL ?? `http://${getLocalhostHost()}:5052`
}

/** Get execution RPC URL */
export function getExecutionRpcUrl(): string {
  return process.env.EXECUTION_RPC_URL ?? getL1RpcUrl()
}

/** Get relayer endpoint */
export function getRelayerEndpoint(): string {
  return process.env.RELAYER_ENDPOINT ?? getBridgeRelayerUrl()
}

/** Get Solana RPC URL */
export function getSolanaRpcUrl(): string | undefined {
  return process.env.SOLANA_RPC
}

/** Get Solana keypair path */
export function getSolanaKeypairPath(): string {
  return process.env.SOLANA_KEYPAIR ?? '~/.config/solana/id.json'
}

/** Get bridge-related addresses */
export function getBaseBridgeAddress(): string | undefined {
  return process.env.BASE_BRIDGE_ADDRESS
}

export function getBaseLightClientAddress(): string | undefined {
  return process.env.BASE_LIGHT_CLIENT_ADDRESS
}

export function getBridgeProgramId(): string | undefined {
  return process.env.BRIDGE_PROGRAM_ID
}

export function getEvmLightClientProgramId(): string | undefined {
  return process.env.EVM_LIGHT_CLIENT_PROGRAM_ID
}

export function getEthBridgeAddress(): string | undefined {
  return process.env.ETH_BRIDGE_ADDRESS
}

export function getEthLightClientAddress(): string | undefined {
  return process.env.ETH_LIGHT_CLIENT_ADDRESS
}

/** Get Base RPC URL */
export function getBaseRpcUrl(): string {
  return process.env.BASE_RPC ?? 'https://mainnet.base.org'
}

/** Get ETH RPC URL */
export function getEthRpcUrl(): string | undefined {
  return process.env.ETH_RPC
}

/** Get private key (secret - env var only) */
export function getPrivateKey(): string | undefined {
  return process.env.PRIVATE_KEY
}

// Training Configuration

/** Get storage provider */
export function getStorageProvider(): string {
  return process.env.STORAGE_PROVIDER ?? 'auto'
}

/** Get Jeju storage API key (secret - env var only) */
export function getJejuStorageApiKey(): string | undefined {
  return process.env.JEJU_STORAGE_API_KEY
}

/** Get worker code hash */
export function getWorkerCodeHash(): string {
  return (
    process.env.WORKER_CODE_HASH ??
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  )
}

/** Get training orchestrator address */
export function getTrainingOrchestratorAddress(): string {
  return (
    process.env.TRAINING_ORCHESTRATOR_ADDRESS ??
    '0x0000000000000000000000000000000000000000'
  )
}

/** Get model registry address */
export function getModelRegistryAddress(): string {
  return (
    process.env.MODEL_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000'
  )
}

/** Get AI CEO address */
export function getAiCeoAddress(): string {
  return (
    process.env.AI_CEO_ADDRESS ?? '0x0000000000000000000000000000000000000000'
  )
}

/** Get TEE registry address */
export function getTeeRegistryAddress(): string {
  return (
    process.env.TEE_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000'
  )
}

/** Get minimum TEE stake in USD */
export function getMinTeeStakeUsd(): number {
  return parseFloat(process.env.MIN_TEE_STAKE_USD ?? '1000')
}

/** Check if MPC encryption is enabled */
export function isUseMpcEncryption(): boolean {
  return process.env.USE_MPC_ENCRYPTION === 'true'
}

/** Get MPC threshold */
export function getMpcThreshold(): number {
  return parseInt(process.env.MPC_THRESHOLD ?? '3', 10)
}

/** Get MPC parties count */
export function getMpcParties(): number {
  return parseInt(process.env.MPC_PARTIES ?? '5', 10)
}

/** Get EVM private key (secret - env var only) */
export function getEvmPrivateKey(): string | undefined {
  return process.env.EVM_PRIVATE_KEY
}

/** Get bridge address */
export function getBridgeAddress(): string | undefined {
  return process.env.BRIDGE_ADDRESS
}

/** Get LLM judge URL */
export function getLlmJudgeUrl(): string | undefined {
  return process.env.LLM_JUDGE_URL
}

/** Get LLM judge model */
export function getLlmJudgeModel(): string | undefined {
  return process.env.LLM_JUDGE_MODEL
}

/** Get HuggingFace token (secret - env var only) */
export function getHuggingFaceToken(): string | undefined {
  return process.env.HUGGING_FACE_TOKEN ?? process.env.HF_TOKEN
}

/** Get Psyche coordinator program ID */
export function getPsycheCoordinatorProgramId(): string | undefined {
  return process.env.PSYCHE_COORDINATOR_PROGRAM_ID
}

/** Get Psyche mining pool program ID */
export function getPsycheMiningPoolProgramId(): string | undefined {
  return process.env.PSYCHE_MINING_POOL_PROGRAM_ID
}

/** Get fundamental dataset URL */
export function getFundamentalDatasetUrl(): string | undefined {
  return process.env.FUNDAMENTAL_DATASET_URL
}

/** Get deployer address */
export function getDeployerAddress(): string | undefined {
  return process.env.DEPLOYER_ADDRESS
}

/** Get training endpoint */
export function getTrainingEndpoint(): string {
  return (
    process.env.TRAINING_ENDPOINT ??
    `http://${getLocalhostHost()}:8001/train_step`
  )
}

/** Get model name */
export function getModelName(): string {
  return process.env.MODEL_NAME ?? 'Qwen/Qwen2.5-1.5B-Instruct'
}

/** Get training steps */
export function getTrainingSteps(): number {
  return parseInt(process.env.TRAINING_STEPS ?? '20', 10)
}

/** Get vLLM restart interval */
export function getVllmRestartInterval(): number {
  return parseInt(process.env.VLLM_RESTART_INTERVAL ?? '3', 10)
}

/** Get run project */
export function getRunProject(): string | undefined {
  return process.env.RUN_PROJECT
}

/** Get run group */
export function getRunGroup(): string | undefined {
  return process.env.RUN_GROUP
}

/** Get Atropos URL */
export function getAtroposLocalUrl(): string {
  return process.env.ATROPOS_URL ?? `http://${getLocalhostHost()}:8000`
}

/** Get Atropos port */
export function getAtroposPort(): number {
  return parseInt(process.env.ATROPOS_PORT ?? '8000', 10)
}

// Shared/Infrastructure Configuration

/** Get DWS API URL */
export function getDwsApiUrl(): string {
  return process.env.DWS_API_URL ?? 'https://dws.jejunetwork.io'
}

/** Get DWS API key (secret - env var only) */
export function getDwsApiKey(): string | undefined {
  return process.env.DWS_API_KEY
}

/** Get DWS gateway URL */
export function getDwsGatewayUrl(): string {
  return (
    process.env.DWS_GATEWAY_URL ??
    `http://${getLocalhostHost()}:3000/api/marketplace`
  )
}

/** Get DWS cache endpoint */
export function getDwsCacheEndpoint(): string | undefined {
  return process.env.DWS_CACHE_ENDPOINT ?? process.env.COMPUTE_CACHE_ENDPOINT
}

// Bot/Simulation API Keys

/** Get Alchemy API key (secret - env var only) */
export function getAlchemyApiKey(): string | undefined {
  return process.env.ALCHEMY_API_KEY
}

/** Get Helius API key (secret - env var only) */
export function getHeliusApiKey(): string | undefined {
  return process.env.HELIUS_API_KEY
}

/** Get DefiLlama API key (secret - env var only) */
export function getDefiLlamaApiKey(): string | undefined {
  return process.env.DEFILLAMA_API_KEY
}

/** Get Codex API key (secret - env var only) */
export function getCodexApiKey(): string | undefined {
  return process.env.CODEX_API_KEY
}

/** Get CoinGecko API key (secret - env var only) */
export function getCoinGeckoApiKey(): string | undefined {
  return process.env.COINGECKO_API_KEY
}

/** Get test private key (secret - env var only) */
export function getTestPrivateKey(): string | undefined {
  return process.env.TEST_PRIVATE_KEY
}

// Messaging Configuration

/** Get allowed origins for CORS */
export function getAllowedOrigins(): string[] {
  const origins = process.env.ALLOWED_ORIGINS
  return origins ? origins.split(',') : ['*']
}

/** Get node ID */
export function getNodeId(): string | undefined {
  return process.env.NODE_ID
}

/** Get IPFS URL */
export function getIpfsUrlEnv(): string | undefined {
  return process.env.IPFS_URL
}

/** Get port */
export function getPortEnv(): number | undefined {
  const port = process.env.PORT
  return port ? parseInt(port, 10) : undefined
}

/** Get source chain RPC URL */
export function getSourceChainRpcUrl(): string | undefined {
  return process.env.SOURCE_CHAIN_RPC_URL
}

/** Get Jeju bridge address */
export function getJejuBridgeAddressEnv(): string | undefined {
  return process.env.JEJU_BRIDGE_ADDRESS
}

/** Get source bridge address */
export function getSourceBridgeAddress(): string | undefined {
  return process.env.SOURCE_BRIDGE_ADDRESS
}

/** Get Jeju key registry address */
export function getJejuKeyRegistryAddress(): string | undefined {
  return process.env.JEJU_KEY_REGISTRY_ADDRESS
}

/** Get relay node URL */
export function getRelayNodeUrl(): string {
  return process.env.RELAY_NODE_URL ?? `http://${getLocalhostHost()}:3400`
}

/** Get cache namespace */
export function getCacheNamespace(): string {
  return process.env.CACHE_NAMESPACE ?? 'default'
}

/** Get cache API key (secret - env var only) */
export function getCacheApiKey(): string | undefined {
  return process.env.CACHE_API_KEY
}

/** Get paymaster factory address */
export function getPaymasterFactoryAddress(): string {
  return (
    process.env.PAYMASTER_FACTORY_ADDRESS ??
    '0x0000000000000000000000000000000000000000'
  )
}

/** Get minimum paymaster stake in ETH */
export function getMinPaymasterStake(): string {
  return process.env.MIN_PAYMASTER_STAKE ?? '1.0'
}

/** Get Jeju storage endpoint */
export function getJejuStorageEndpoint(): string | undefined {
  return process.env.JEJU_STORAGE_ENDPOINT
}

/** Get Jeju storage provider */
export function getJejuStorageProviderType(): 'ipfs' | 'arweave' {
  return (process.env.JEJU_STORAGE_PROVIDER as 'ipfs' | 'arweave') ?? 'ipfs'
}

/** Get Jeju storage replication */
export function getJejuStorageReplication(): string {
  return process.env.JEJU_STORAGE_REPLICATION ?? '3'
}

/** Get HSM provider */
export function getHsmProvider(): string {
  return process.env.HSM_PROVIDER ?? 'local-dev'
}

/** Get HSM endpoint */
export function getHsmEndpoint(): string {
  return process.env.HSM_ENDPOINT ?? `http://${getLocalhostHost()}:8080`
}

/** Get HSM API key (secret - env var only) */
export function getHsmApiKey(): string | undefined {
  return process.env.HSM_API_KEY
}

/** Get HSM username (secret - env var only) */
export function getHsmUsername(): string | undefined {
  return process.env.HSM_USERNAME
}

/** Get HSM password (secret - env var only) */
export function getHsmPassword(): string | undefined {
  return process.env.HSM_PASSWORD
}

/** Check if HSM audit logging is enabled */
export function isHsmAuditLoggingEnabled(): boolean {
  return process.env.HSM_AUDIT_LOGGING !== 'false'
}

/** Get worker ID */
export function getWorkerId(): number | undefined {
  const workerId = process.env.WORKER_ID
  return workerId ? parseInt(workerId, 10) : undefined
}

/** Get gateway API endpoint */
export function getGatewayApiEndpoint(): string | undefined {
  return process.env.GATEWAY_API
}

// Database Configuration

/** Get log level */
export function getLogLevel(): string {
  return process.env.LOG_LEVEL ?? 'info'
}

/** Get EQLite KMS key ID for signing */
export function getEqliteKeyId(): string | undefined {
  return process.env.EQLITE_KEY_ID
}

/** Get EQLite database ID */
export function getEqliteDatabaseId(): string | undefined {
  return process.env.EQLITE_DATABASE_ID
}

/** Get EQLite timeout */
export function getEqliteTimeout(): string | undefined {
  return process.env.EQLITE_TIMEOUT
}

/** Check if EQLite debug is enabled */
export function isEqliteDebug(): boolean {
  return process.env.EQLITE_DEBUG === 'true'
}

/** Get EQLite port */
export function getEqlitePort(): number {
  return parseInt(process.env.EQLITE_PORT ?? process.env.PORT ?? '4400', 10)
}

/** Get EQLite data directory */
export function getEqliteDataDir(): string {
  return process.env.EQLITE_DATA_DIR ?? './.data/eqlite'
}

// Auth Configuration

/** Get SMTP host */
export function getSmtpHost(): string | undefined {
  return process.env.SMTP_HOST
}

/** Get SMTP port */
export function getSmtpPort(): number {
  return parseInt(process.env.SMTP_PORT ?? '587', 10)
}

/** Get SMTP user (secret - env var only) */
export function getSmtpUser(): string | undefined {
  return process.env.SMTP_USER
}

/** Get SMTP password (secret - env var only) */
export function getSmtpPassword(): string | undefined {
  return process.env.SMTP_PASSWORD
}

/** Get SendGrid API key (secret - env var only) */
export function getSendgridApiKey(): string | undefined {
  return process.env.SENDGRID_API_KEY
}

/** Get Mailgun API key (secret - env var only) */
export function getMailgunApiKey(): string | undefined {
  return process.env.MAILGUN_API_KEY
}

/** Get Mailgun domain */
export function getMailgunDomain(): string | undefined {
  return process.env.MAILGUN_DOMAIN
}

/** Get Resend API key (secret - env var only) */
export function getResendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY
}

/** Get SMTP relay URL */
export function getSmtpRelayUrl(): string | undefined {
  return process.env.SMTP_RELAY_URL
}

/** Get Twilio account SID (secret - env var only) */
export function getTwilioAccountSid(): string | undefined {
  return process.env.TWILIO_ACCOUNT_SID
}

/** Get Twilio auth token (secret - env var only) */
export function getTwilioAuthToken(): string | undefined {
  return process.env.TWILIO_AUTH_TOKEN
}

/** Get Twilio phone number */
export function getTwilioPhoneNumber(): string | undefined {
  return process.env.TWILIO_PHONE_NUMBER
}

/** Get AWS access key ID (secret - env var only) */
export function getAwsAccessKeyId(): string | undefined {
  return process.env.AWS_ACCESS_KEY_ID
}

/** Get AWS secret access key (secret - env var only) */
export function getAwsSecretAccessKey(): string | undefined {
  return process.env.AWS_SECRET_ACCESS_KEY
}

/** Get AWS SNS sender ID */
export function getAwsSnsSenderId(): string {
  return process.env.AWS_SNS_SENDER_ID ?? 'Jeju'
}

/** Get IPFS API endpoint */
export function getIpfsApiEndpointEnv(): string | undefined {
  return process.env.IPFS_API_ENDPOINT
}

/** Get IPFS gateway */
export function getIpfsGatewayEnv(): string | undefined {
  return process.env.IPFS_GATEWAY
}

/** Get Neynar API key (secret - env var only) */
export function getNeynarApiKey(): string {
  return process.env.NEYNAR_API_KEY ?? ''
}

/** Get IPFS API URL (for IPNS) */
export function getIpfsApiUrlEnv(): string {
  return process.env.IPFS_API_URL ?? getIpfsApiUrl()
}

/** Get KMS endpoint */
export function getKmsEndpoint(): string | undefined {
  return process.env.KMS_ENDPOINT
}

/** Get KMS service URL - uses services.json with env override */
export function getKmsServiceUrl(network?: NetworkType): string {
  // Environment variable override takes precedence
  if (process.env.KMS_SERVICE_URL) {
    return process.env.KMS_SERVICE_URL
  }
  if (process.env.JEJU_KMS_SERVICE_URL) {
    return process.env.JEJU_KMS_SERVICE_URL
  }
  // Fall back to services.json configuration
  return getServicesConfig(network).kms.api
}

/** KMS threshold configuration per network */
export interface KMSThresholdConfig {
  /** Minimum signers required (t of n) */
  threshold: number
  /** Total number of MPC parties */
  totalParties: number
  /** Whether attestation verification is required */
  requireAttestation: boolean
  /** Signing timeout in milliseconds */
  signingTimeoutMs: number
}

/**
 * Get KMS threshold configuration for a network.
 *
 * SECURITY: Mainnet requires higher thresholds and mandatory attestation.
 * - Localnet: 1-of-1 (development mode, no attestation)
 * - Testnet: 2-of-3 (production-like, attestation recommended)
 * - Mainnet: 3-of-5 (high security, attestation required)
 */
export function getKmsThresholdConfig(
  network?: NetworkType,
): KMSThresholdConfig {
  const resolvedNetwork = network ?? getCurrentNetwork()

  switch (resolvedNetwork) {
    case 'mainnet':
      return {
        threshold: 3,
        totalParties: 5,
        requireAttestation: true,
        signingTimeoutMs: 60000,
      }
    case 'testnet':
      return {
        threshold: 2,
        totalParties: 3,
        requireAttestation: true, // Recommended but may fallback
        signingTimeoutMs: 30000,
      }
    default:
      return {
        threshold: 1,
        totalParties: 1,
        requireAttestation: false,
        signingTimeoutMs: 10000,
      }
  }
}

/** HSM provider type for MPC party key shares */
export type HSMProviderType =
  | 'software' // Software-only (localnet/testing)
  | 'aws_cloudhsm' // AWS CloudHSM
  | 'gcp_kms' // Google Cloud KMS
  | 'azure_hsm' // Azure Dedicated HSM
  | 'yubihsm' // YubiHSM 2
  | 'nitrokey' // Nitrokey HSM 2
  | 'hashicorp_vault' // HashiCorp Vault with HSM backend

/** HSM configuration for MPC key shares */
export interface HSMConfig {
  /** HSM provider type */
  provider: HSMProviderType
  /** Whether HSM is required (fail if unavailable) */
  required: boolean
  /** Provider-specific endpoint */
  endpoint?: string
  /** Region for cloud HSM providers */
  region?: string
  /** Key wrapping algorithm */
  keyWrapAlgorithm: 'AES256_GCM' | 'RSA_OAEP'
  /** Maximum key operations before rotation */
  maxOperationsBeforeRotation: number
}

/**
 * Get HSM configuration for MPC party key shares.
 *
 * SECURITY: HSM backing ensures that even TEE compromise cannot
 * extract the raw key shares. Key shares are:
 * 1. Generated inside the HSM
 * 2. Never leave the HSM in plaintext
 * 3. Used for signing via HSM APIs
 *
 * Environment variables:
 * - HSM_PROVIDER: Override provider type
 * - HSM_ENDPOINT: Override HSM endpoint
 * - HSM_REGION: Override region for cloud HSMs
 */
export function getHSMConfig(network?: NetworkType): HSMConfig {
  const resolvedNetwork = network ?? getCurrentNetwork()

  // Environment overrides
  const envProvider = process.env.HSM_PROVIDER as HSMProviderType | undefined
  const envEndpoint = process.env.HSM_ENDPOINT
  const envRegion = process.env.HSM_REGION

  switch (resolvedNetwork) {
    case 'mainnet':
      return {
        provider: envProvider ?? 'aws_cloudhsm',
        required: true,
        endpoint: envEndpoint,
        region: envRegion ?? 'us-east-1',
        keyWrapAlgorithm: 'AES256_GCM',
        maxOperationsBeforeRotation: 1000000,
      }
    case 'testnet':
      return {
        provider: envProvider ?? 'aws_cloudhsm',
        required: false, // Fallback to software if unavailable
        endpoint: envEndpoint,
        region: envRegion ?? 'us-west-2',
        keyWrapAlgorithm: 'AES256_GCM',
        maxOperationsBeforeRotation: 100000,
      }
    default:
      return {
        provider: envProvider ?? 'software',
        required: false,
        endpoint: envEndpoint,
        region: envRegion,
        keyWrapAlgorithm: 'AES256_GCM',
        maxOperationsBeforeRotation: 10000,
      }
  }
}

/**
 * Check if HSM is available and properly configured.
 * Returns provider info or null if unavailable.
 */
export async function checkHSMAvailability(
  network?: NetworkType,
): Promise<{ available: boolean; provider: HSMProviderType; error?: string }> {
  const config = getHSMConfig(network)

  if (config.provider === 'software') {
    return { available: true, provider: 'software' }
  }

  // For cloud HSMs, we'd check connectivity here
  // This is a placeholder that would be implemented with actual HSM SDKs
  try {
    // AWS CloudHSM check would use @aws-sdk/client-cloudhsm-v2
    // GCP KMS check would use @google-cloud/kms
    // Azure HSM check would use @azure/keyvault-keys
    return { available: true, provider: config.provider }
  } catch (err) {
    return {
      available: false,
      provider: config.provider,
      error: String(err),
    }
  }
}

/** Get cron endpoint */
export function getCronEndpoint(): string | undefined {
  return process.env.CRON_ENDPOINT
}

/** Get storage API endpoint */
export function getStorageApiEndpoint(): string | undefined {
  return process.env.STORAGE_API_ENDPOINT
}

/** Get JNS resolver address */
export function getJnsResolverAddressEnv(): string | undefined {
  return process.env.JNS_RESOLVER_ADDRESS
}

// ==================== OAuth3 Functions ====================

/** Get OAuth3 TEE Verifier address */
export function getOAuth3TeeVerifierAddress(network?: NetworkType): string {
  return (
    process.env.OAUTH3_TEE_VERIFIER_ADDRESS ??
    tryGetContract('oauth3', 'teeVerifier', network)
  )
}

/** Get OAuth3 Identity Registry address */
export function getOAuth3IdentityRegistryAddress(
  network?: NetworkType,
): string {
  return (
    process.env.OAUTH3_IDENTITY_REGISTRY_ADDRESS ??
    tryGetContract('oauth3', 'identityRegistry', network)
  )
}

/** Get OAuth3 App Registry address */
export function getOAuth3AppRegistryAddress(network?: NetworkType): string {
  return (
    process.env.OAUTH3_APP_REGISTRY_ADDRESS ??
    tryGetContract('oauth3', 'appRegistry', network)
  )
}

// ==================== DWS Functions ====================

/** Get DWS Storage Manager address */
export function getDWSStorageManagerAddress(network?: NetworkType): string {
  return (
    process.env.DWS_STORAGE_MANAGER_ADDRESS ??
    tryGetContract('dws', 'storageManager', network)
  )
}

/** Get DWS Worker Registry address */
export function getDWSWorkerRegistryAddress(network?: NetworkType): string {
  return (
    process.env.DWS_WORKER_REGISTRY_ADDRESS ??
    tryGetContract('dws', 'workerRegistry', network)
  )
}

/** Get CDN Registry address */
export function getCDNRegistryAddress(network?: NetworkType): string {
  return (
    process.env.CDN_REGISTRY_ADDRESS ??
    tryGetContract('cdn', 'registry', network)
  )
}

/** Get IPFS gateway URL (for versioning) */
export function getIpfsGatewayUrlEnv(): string | undefined {
  return process.env.IPFS_GATEWAY_URL
}

/** Get public API URL */
export function getPublicApiUrl(): string | undefined {
  return process.env.PUBLIC_API_URL
}

// Council Configuration

/** Get Jeju Council OAuth3 app address */
export function getCouncilJejuOauth3App(): string {
  return process.env.COUNCIL_JEJU_OAUTH3_APP ?? '0x'
}

/** Get Eliza Council OAuth3 app address */
export function getCouncilElizaOauth3App(): string {
  return process.env.COUNCIL_ELIZA_OAUTH3_APP ?? '0x'
}

// Hyperlane Configuration

/** Get Jeju Hyperlane mailbox address */
export function getJejuHyperlaneMailbox(): string {
  return process.env.JEJU_HYPERLANE_MAILBOX ?? ''
}

/** Get Jeju Hyperlane IGP address */
export function getJejuHyperlaneIgp(): string {
  return process.env.JEJU_HYPERLANE_IGP ?? ''
}

/** Get Jeju mainnet Hyperlane mailbox address */
export function getJejuMainnetHyperlaneMailbox(): string {
  return process.env.JEJU_MAINNET_HYPERLANE_MAILBOX ?? ''
}

/** Get Jeju mainnet Hyperlane IGP address */
export function getJejuMainnetHyperlaneIgp(): string {
  return process.env.JEJU_MAINNET_HYPERLANE_IGP ?? ''
}

// Branding Config

// App Config Injection
export {
  createAppConfig,
  getEnvBool,
  getEnvNumber,
  getEnvVar,
  getNodeEnv,
  isDevelopmentEnv,
  isTestEnv,
} from './app-config'
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

// API Keys (browser-safe - uses env vars)

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

// Chainlink Configuration
export type {
  AutomationConfig,
  ChainlinkFeed,
  VRFConfig,
} from './chainlink'
export {
  getAutomationConfig,
  getChainlinkFeed,
  getChainlinkFeeds,
  getVRFConfig,
  hasChainlinkSupport,
} from './chainlink'

// Node.js-only modules (internal, not exported)
// These modules use node:fs and are internal implementation details.
// They are exported from their source files but not from the barrel:
//   - secrets.ts - getSecret, requireSecret
//   - test-keys.ts - getTestKeys, getKeyByRole
//   - update.ts - updateContracts, saveDeploymentArtifact
