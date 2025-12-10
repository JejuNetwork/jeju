/**
 * @fileoverview Jeju Network Configuration
 * @module config
 * 
 * Config-First Architecture:
 * - All public values in JSON files
 * - Environment variables only for secrets and overrides
 * 
 * Config Files:
 * - chain/*.json     Network settings (RPC, chain ID, bridge contracts)
 * - contracts.json   All contract addresses (Jeju + external chains)
 * - services.json    API URLs per network
 * - tokens.json      Token metadata
 * - chains.json      Node infrastructure (for deployment)
 * - ports.ts         Port allocations (local dev)
 * 
 * @example
 * ```ts
 * import { getConfig, getContract, getServiceUrl } from '@jejunetwork/config';
 * 
 * const config = getConfig();
 * const solver = getContract('oif', 'solverRegistry');
 * const indexer = getServiceUrl('indexer', 'graphql');
 * ```
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ChainConfigSchema, type ChainConfig, type NetworkType } from '../types/src/chain';

export * from './network';
export * from './ports';
export type { ChainConfig, NetworkType } from '../types/src/chain';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_DIR = __dirname;

// ============================================================================
// Types
// ============================================================================

export interface ContractCategory {
  [key: string]: string;
}

export interface NetworkContracts {
  chainId: number;
  tokens: ContractCategory;
  registry: ContractCategory;
  moderation: ContractCategory;
  nodeStaking: ContractCategory;
  jns: ContractCategory;
  payments: ContractCategory;
  defi: ContractCategory;
  compute: ContractCategory;
  governance: ContractCategory;
  oif: ContractCategory;
  eil: ContractCategory;
}

export type ContractCategoryName = 
  | 'tokens' | 'registry' | 'moderation' | 'nodeStaking' | 'jns'
  | 'payments' | 'defi' | 'compute' | 'governance' | 'oif' | 'eil';

export interface ExternalChainContracts {
  chainId: number;
  rpcUrl: string;
  oif?: ContractCategory;
  eil?: ContractCategory;
  tokens?: ContractCategory;
}

export interface ContractsConfig {
  version: string;
  constants: {
    entryPoint: string;
    entryPointV07: string;
    l2Messenger: string;
    l2StandardBridge: string;
    weth: string;
  };
  localnet: NetworkContracts;
  testnet: NetworkContracts;
  mainnet: NetworkContracts;
  external: Record<string, ExternalChainContracts>;
}

export interface ServicesConfig {
  rpc: { l1: string; l2: string; ws: string };
  explorer: string;
  indexer: { graphql: string; websocket: string };
  gateway: { ui: string; api: string; a2a: string; ws: string };
  rpcGateway: string;
  bazaar: string;
  storage: { api: string; ipfsGateway: string };
  compute: { marketplace: string; nodeApi: string };
  oif: { aggregator: string };
  leaderboard: { api: string; ui: string };
  monitoring: { prometheus: string; grafana: string };
  externalRpcs?: Record<string, string>;
}

// ============================================================================
// Loaders
// ============================================================================

function loadJson<T>(filename: string): T {
  const path = resolve(CONFIG_DIR, filename);
  if (!existsSync(path)) throw new Error(`Config not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

let contractsCache: ContractsConfig | null = null;
let servicesCache: Record<string, ServicesConfig> | null = null;

function loadContracts(): ContractsConfig {
  if (!contractsCache) contractsCache = loadJson<ContractsConfig>('contracts.json');
  return contractsCache;
}

function loadServices(): Record<string, ServicesConfig> {
  if (!servicesCache) servicesCache = loadJson<Record<string, ServicesConfig>>('services.json');
  return servicesCache;
}

// ============================================================================
// Core Functions
// ============================================================================

/** Get current network from JEJU_NETWORK env or default to localnet */
export function getCurrentNetwork(): NetworkType {
  return (process.env.JEJU_NETWORK as NetworkType) || 'localnet';
}

/** Load chain config for a network */
export function loadChainConfig(network: NetworkType): ChainConfig {
  const path = resolve(CONFIG_DIR, `chain/${network}.json`);
  return ChainConfigSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
}

/** Get chain config with env override support */
export function getChainConfig(network?: NetworkType): ChainConfig {
  return loadChainConfig(network || getCurrentNetwork());
}

/** Get chain ID */
export function getChainId(network?: NetworkType): number {
  return getChainConfig(network).chainId;
}

// ============================================================================
// Contracts
// ============================================================================

/**
 * Convert camelCase to SCREAMING_SNAKE_CASE
 * e.g., banManager -> BAN_MANAGER
 */
function toEnvKey(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
}

/** 
 * Get contract address with env override support
 * Checks: VITE_{NAME}_ADDRESS, NEXT_PUBLIC_{NAME}_ADDRESS, then config
 * e.g., getContract('moderation', 'banManager') checks VITE_BAN_MANAGER_ADDRESS
 */
export function getContract(
  category: ContractCategoryName,
  name: string,
  network?: NetworkType
): string {
  // Build possible env keys
  const envName = toEnvKey(name);
  
  // Check VITE_ format (for Vite apps)
  const viteKey = `VITE_${envName}_ADDRESS`;
  if (process.env[viteKey]) return process.env[viteKey]!;
  
  // Check NEXT_PUBLIC_ format (for Next.js apps)
  const nextKey = `NEXT_PUBLIC_${envName}_ADDRESS`;
  if (process.env[nextKey]) return process.env[nextKey]!;
  
  // Check category-prefixed format (for scripts)
  const categoryKey = `${category.toUpperCase()}_${envName}`;
  if (process.env[categoryKey]) return process.env[categoryKey]!;
  
  const net = network || getCurrentNetwork();
  const contracts = loadContracts();
  const netContracts = contracts[net as keyof Pick<ContractsConfig, 'localnet' | 'testnet' | 'mainnet'>];
  return netContracts?.[category]?.[name] || '';
}

/** Get constant contract address (EntryPoint, L2Messenger, etc.) */
export function getConstant(name: keyof ContractsConfig['constants']): string {
  return loadContracts().constants[name];
}

/** Get external chain contract */
export function getExternalContract(
  chain: string,
  category: 'oif' | 'eil' | 'tokens',
  name: string
): string {
  const contracts = loadContracts();
  return contracts.external[chain]?.[category]?.[name] || '';
}

/** Get external chain RPC URL */
export function getExternalRpc(chain: string): string {
  const envKey = `${chain.toUpperCase()}_RPC_URL`;
  if (process.env[envKey]) return process.env[envKey]!;
  return loadContracts().external[chain]?.rpcUrl || '';
}

/** Get all contracts for current network */
export function getContractsConfig(network?: NetworkType): NetworkContracts {
  const net = network || getCurrentNetwork();
  return loadContracts()[net as keyof Pick<ContractsConfig, 'localnet' | 'testnet' | 'mainnet'>];
}

// ============================================================================
// Services
// ============================================================================

/**
 * Get env var with VITE_ or NEXT_PUBLIC_ prefix support
 * Checks: process.env.{key}, VITE_{key}, NEXT_PUBLIC_{key}
 */
function getEnvService(key: string): string | undefined {
  return process.env[key] 
    || process.env[`VITE_${key}`] 
    || process.env[`NEXT_PUBLIC_${key}`];
}

/** Get services config with env overrides */
export function getServicesConfig(network?: NetworkType): ServicesConfig {
  const net = network || getCurrentNetwork();
  const config = loadServices()[net];
  
  return {
    ...config,
    rpc: {
      l1: getEnvService('JEJU_L1_RPC_URL') || getEnvService('L1_RPC_URL') || config.rpc.l1,
      l2: getEnvService('JEJU_RPC_URL') || getEnvService('RPC_URL') || config.rpc.l2,
      ws: getEnvService('JEJU_WS_URL') || getEnvService('WS_URL') || config.rpc.ws,
    },
    explorer: getEnvService('JEJU_EXPLORER_URL') || config.explorer,
    indexer: {
      graphql: getEnvService('INDEXER_URL') || getEnvService('INDEXER_GRAPHQL_URL') || config.indexer.graphql,
      websocket: getEnvService('INDEXER_WS_URL') || config.indexer.websocket,
    },
    gateway: {
      ui: getEnvService('GATEWAY_URL') || config.gateway.ui,
      api: getEnvService('GATEWAY_API_URL') || config.gateway.api,
      a2a: getEnvService('GATEWAY_A2A_URL') || config.gateway.a2a,
      ws: getEnvService('GATEWAY_WS_URL') || config.gateway.ws,
    },
    rpcGateway: getEnvService('RPC_GATEWAY_URL') || config.rpcGateway,
    bazaar: getEnvService('BAZAAR_URL') || config.bazaar,
    storage: {
      api: getEnvService('STORAGE_API_URL') || getEnvService('JEJU_IPFS_API') || config.storage.api,
      ipfsGateway: getEnvService('IPFS_GATEWAY_URL') || getEnvService('JEJU_IPFS_GATEWAY') || config.storage.ipfsGateway,
    },
    compute: {
      marketplace: getEnvService('COMPUTE_URL') || config.compute.marketplace,
      nodeApi: getEnvService('COMPUTE_API_URL') || config.compute.nodeApi,
    },
    oif: {
      aggregator: getEnvService('OIF_AGGREGATOR_URL') || config.oif.aggregator,
    },
    leaderboard: {
      api: getEnvService('LEADERBOARD_API_URL') || config.leaderboard.api,
      ui: getEnvService('LEADERBOARD_URL') || config.leaderboard.ui,
    },
    monitoring: config.monitoring,
  };
}

/** Get a service URL */
export function getServiceUrl(
  service: 'rpc' | 'indexer' | 'gateway' | 'storage' | 'compute' | 'oif' | 'leaderboard' | 'rpcGateway' | 'bazaar' | 'explorer',
  subService?: string,
  network?: NetworkType
): string {
  const config = getServicesConfig(network);
  
  // Handle direct string services
  if (service === 'rpcGateway') return config.rpcGateway;
  if (service === 'bazaar') return config.bazaar;
  if (service === 'explorer') return config.explorer;
  
  if (service === 'rpc') {
    return subService === 'l1' ? config.rpc.l1 : subService === 'ws' ? config.rpc.ws : config.rpc.l2;
  }
  
  const svc = config[service];
  if (typeof svc === 'string') return svc;
  if (subService && typeof svc === 'object') return (svc as Record<string, string>)[subService] || '';
  // Return first value if no subservice specified
  if (typeof svc === 'object') return Object.values(svc)[0] || '';
  return '';
}

// ============================================================================
// Convenience
// ============================================================================

export function getRpcUrl(network?: NetworkType): string {
  return getServicesConfig(network).rpc.l2;
}

export function getWsUrl(network?: NetworkType): string {
  return getServicesConfig(network).rpc.ws;
}

export function getL1RpcUrl(network?: NetworkType): string {
  return getServicesConfig(network).rpc.l1;
}

export function getExplorerUrl(network?: NetworkType): string {
  return getServicesConfig(network).explorer;
}

export function getBridgeContractAddress(
  network: NetworkType,
  layer: 'l1' | 'l2',
  contractName: string
): string {
  const config = loadChainConfig(network);
  const contracts = layer === 'l1' ? config.contracts.l1 : config.contracts.l2;
  const address = contracts[contractName as keyof typeof contracts];
  if (!address) throw new Error(`Contract ${contractName} not found on ${layer} for ${network}`);
  return address;
}

// ============================================================================
// Unified Config
// ============================================================================

export interface JejuConfig {
  network: NetworkType;
  chain: ChainConfig;
  services: ServicesConfig;
  contracts: NetworkContracts;
}

/** Get full config for current network */
export function getConfig(network?: NetworkType): JejuConfig {
  const net = network || getCurrentNetwork();
  return {
    network: net,
    chain: getChainConfig(net),
    services: getServicesConfig(net),
    contracts: getContractsConfig(net),
  };
}

// ============================================================================
// Frontend Helpers
// ============================================================================

/**
 * Get all contracts needed for frontend apps
 * Returns addresses with env override support for VITE_ and NEXT_PUBLIC_
 */
export function getFrontendContracts(network?: NetworkType) {
  const net = network || getCurrentNetwork();
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
    moderationMarketplace: getContract('moderation', 'moderationMarketplace', net),
    reportingSystem: getContract('moderation', 'reportingSystem', net),
    reputationLabelManager: getContract('moderation', 'reputationLabelManager', net),
    
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
  };
}

/**
 * Get all service URLs needed for frontend apps
 */
export function getFrontendServices(network?: NetworkType) {
  const config = getServicesConfig(network);
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
  };
}

// ============================================================================
// EIL (Cross-Chain Liquidity)
// ============================================================================

export interface EILChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  crossChainPaymaster: string;
  l1StakeManager?: string;
  status: 'active' | 'planned';
  tokens: Record<string, string>;
}

export interface EILNetworkConfig {
  hub: {
    chainId: number;
    name: string;
    rpcUrl: string;
    l1StakeManager: string;
    crossChainPaymaster: string;
    status: 'active' | 'planned';
  };
  chains: Record<string, EILChainConfig>;
}

export interface EILConfig {
  version: string;
  entryPoint: string;
  l2Messenger: string;
  supportedTokens: string[];
  localnet: EILNetworkConfig;
  testnet: EILNetworkConfig;
  mainnet: EILNetworkConfig;
}

let eilCache: EILConfig | null = null;

function loadEILConfig(): EILConfig {
  if (!eilCache) eilCache = loadJson<EILConfig>('eil.json');
  return eilCache;
}

/** Get EIL config for a network */
export function getEILConfig(network?: NetworkType): EILNetworkConfig {
  const net = network || getCurrentNetwork();
  return loadEILConfig()[net];
}

/** Get all supported EIL chains for a network */
export function getEILChains(network?: NetworkType): Record<string, EILChainConfig> {
  return getEILConfig(network).chains;
}

/** Get EIL chain config by chain name */
export function getEILChain(chainName: string, network?: NetworkType): EILChainConfig | undefined {
  return getEILConfig(network).chains[chainName];
}

/** Get EIL chain by chain ID */
export function getEILChainById(chainId: number, network?: NetworkType): EILChainConfig | undefined {
  const chains = getEILChains(network);
  return Object.values(chains).find(c => c.chainId === chainId);
}

/** Get all EIL supported chain IDs */
export function getEILChainIds(network?: NetworkType): number[] {
  return Object.values(getEILChains(network)).map(c => c.chainId);
}

/** Get EIL hub config */
export function getEILHub(network?: NetworkType) {
  return getEILConfig(network).hub;
}

/** Get cross-chain paymaster address for a specific chain */
export function getCrossChainPaymaster(chainNameOrId: string | number, network?: NetworkType): string {
  const chain = typeof chainNameOrId === 'number' 
    ? getEILChainById(chainNameOrId, network)
    : getEILChain(chainNameOrId, network);
  return chain?.crossChainPaymaster || '';
}

/** Get supported token address on a specific chain */
export function getEILToken(chainNameOrId: string | number, tokenSymbol: string, network?: NetworkType): string {
  const chain = typeof chainNameOrId === 'number'
    ? getEILChainById(chainNameOrId, network)
    : getEILChain(chainNameOrId, network);
  return chain?.tokens[tokenSymbol] || '';
}

// ============================================================================
// Vendor Apps (for setup scripts)
// ============================================================================

export interface VendorAppConfig {
  name: string;
  url: string;
  path: string;
  description?: string;
  private: boolean;
  optional: boolean;
  branch: string;
}

export function loadVendorAppsConfig(): { apps: VendorAppConfig[] } {
  return loadJson<{ apps: VendorAppConfig[] }>('vendor-apps.json');
}
