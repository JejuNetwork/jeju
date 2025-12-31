/**
 * Shared configuration for OAuth3 infrastructure
 *
 * Environments:
 * - localnet: Local development with anvil (chain 420691)
 * - testnet: Jeju Testnet for staging (chain 420690)
 * - mainnet: Jeju Mainnet for production (chain 420692)
 */

import {
  getContract,
  getDWSUrl,
  getL2RpcUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import { getEnv } from '@jejunetwork/shared'
import { type NetworkType, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

// Safe wrapper that returns ZERO_ADDRESS if contract not found
function safeGetContract(
  category: 'jns' | 'registry',
  name: string,
  network: NetworkType,
): Address {
  try {
    const addr = getContract(category, name, network)
    return (addr || ZERO_ADDRESS) as Address
  } catch {
    return ZERO_ADDRESS
  }
}

export type { NetworkType }
export type TEEMode = 'dstack' | 'phala' | 'simulated' | 'auto'

export const CHAIN_IDS = {
  localnet: 420691,
  localnetAnvil: 31337, // Standard anvil/hardhat chain ID
  testnet: 420690,
  mainnet: 420692,
} as const

export const RPC_URLS: Record<NetworkType, string> = {
  localnet: getL2RpcUrl(),
  testnet: 'https://testnet.jejunetwork.org',
  mainnet: 'https://mainnet.jejunetwork.org',
} as const

export const DEFAULT_RPC = getEnv('JEJU_RPC_URL') || RPC_URLS.localnet

// DWS Storage endpoints - all environments use DWS for storage
// DWS exposes IPFS-compatible API at /storage/api/v0/* and /storage/ipfs/*
export const DWS_ENDPOINTS: Record<
  NetworkType,
  { base: string; api: string; gateway: string }
> = {
  localnet: {
    base: getDWSUrl() ?? `http://${getLocalhostHost()}:4030`,
    api: `${getDWSUrl() ?? `http://${getLocalhostHost()}:4030`}/storage/api/v0`,
    gateway: `${getDWSUrl() ?? `http://${getLocalhostHost()}:4030`}/storage/ipfs`,
  },
  testnet: {
    base: 'https://dws.testnet.jejunetwork.org',
    api: 'https://dws.testnet.jejunetwork.org/storage/api/v0',
    gateway: 'https://dws.testnet.jejunetwork.org/storage/ipfs',
  },
  mainnet: {
    base: 'https://dws.jejunetwork.org',
    api: 'https://dws.jejunetwork.org/storage/api/v0',
    gateway: 'https://dws.jejunetwork.org/storage/ipfs',
  },
} as const

// Alias for backwards compatibility
export const IPFS_ENDPOINTS = DWS_ENDPOINTS

export const DEFAULT_IPFS_API =
  getEnv('IPFS_API_ENDPOINT') || IPFS_ENDPOINTS.localnet.api
export const DEFAULT_IPFS_GATEWAY =
  getEnv('IPFS_GATEWAY_ENDPOINT') || IPFS_ENDPOINTS.localnet.gateway

// Localnet addresses - read from @jejunetwork/config or environment overrides
function getLocalnetContracts() {
  return {
    jnsRegistry: (getEnv('JNS_REGISTRY_ADDRESS') ||
      getEnv('PUBLIC_JNS_REGISTRY_ADDRESS') ||
      safeGetContract('jns', 'registry', 'localnet')) as Address,
    jnsResolver: (getEnv('JNS_RESOLVER_ADDRESS') ||
      getEnv('PUBLIC_JNS_RESOLVER_ADDRESS') ||
      safeGetContract('jns', 'resolver', 'localnet')) as Address,
    appRegistry: (getEnv('APP_REGISTRY_ADDRESS') ||
      getEnv('PUBLIC_APP_REGISTRY_ADDRESS') ||
      safeGetContract('registry', 'app', 'localnet')) as Address,
    identityRegistry: (getEnv('IDENTITY_REGISTRY_ADDRESS') ||
      getEnv('PUBLIC_IDENTITY_REGISTRY_ADDRESS') ||
      safeGetContract('registry', 'identity', 'localnet')) as Address,
    teeVerifier: (getEnv('TEE_VERIFIER_ADDRESS') ||
      getEnv('PUBLIC_TEE_VERIFIER_ADDRESS') ||
      ZERO_ADDRESS) as Address,
  }
}

const LOCALNET_CONTRACTS = getLocalnetContracts()

// Testnet addresses (Jeju Testnet deployment - deployed 2025-12-30)
const TESTNET_CONTRACTS = {
  jnsRegistry: '0xD8a5a9b31c3C0232E196d518E89Fd8bF83AcAd43' as Address,
  jnsResolver: '0xDC11f7E700A4c898AE5CAddB1082cFfa76512aDD' as Address,
  appRegistry: '0x0000000000000000000000000000000000000000' as Address, // TODO: Deploy OAuth3 app registry
  identityRegistry: '0x0000000000000000000000000000000000000000' as Address, // TODO: Deploy identity registry
  teeVerifier: '0x0000000000000000000000000000000000000000' as Address, // TODO: Deploy TEE verifier
} as const

// Mainnet addresses (Jeju Mainnet - PENDING DEPLOYMENT)
const MAINNET_CONTRACTS = {
  jnsRegistry: '0x0000000000000000000000000000000000000000' as Address,
  jnsResolver: '0x0000000000000000000000000000000000000000' as Address,
  appRegistry: '0x0000000000000000000000000000000000000000' as Address,
  identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
  teeVerifier: '0x0000000000000000000000000000000000000000' as Address,
} as const

export const CONTRACTS = {
  localnet: LOCALNET_CONTRACTS,
  testnet: TESTNET_CONTRACTS,
  mainnet: MAINNET_CONTRACTS,
} as const

export const MIN_STAKE = BigInt(1e18) // 1 ETH
export const ATTESTATION_VALIDITY_MS = 24 * 60 * 60 * 1000 // 24 hours
export const CACHE_EXPIRY_MS = 60000 // 1 minute

export function getNetworkType(chainId: number): NetworkType {
  if (chainId === CHAIN_IDS.localnet || chainId === CHAIN_IDS.localnetAnvil)
    return 'localnet'
  if (chainId === CHAIN_IDS.testnet) return 'testnet'
  return 'mainnet'
}

export function getContracts(chainId: number) {
  const network = getNetworkType(chainId)
  const contracts = CONTRACTS[network]

  // Fail fast if contracts not deployed
  if (contracts.jnsRegistry === ZERO_ADDRESS) {
    if (network === 'mainnet') {
      throw new Error(
        'Mainnet contracts not yet deployed. Use testnet or localnet.',
      )
    }
    if (network === 'localnet') {
      // Log warning but don't fail - OAuth3 will fall back to centralized mode
      console.warn(
        '[OAuth3] JNS contracts not configured for localnet. Set JNS_REGISTRY_ADDRESS env var or run bootstrap.',
      )
    }
  }

  return contracts
}

export function getRpcUrl(chainId: number): string {
  const network = getNetworkType(chainId)
  return getEnv('JEJU_RPC_URL') || RPC_URLS[network]
}

export function getIPFSEndpoints(chainId: number) {
  const network = getNetworkType(chainId)
  return {
    api: getEnv('IPFS_API_ENDPOINT') || IPFS_ENDPOINTS[network].api,
    gateway: getEnv('IPFS_GATEWAY_ENDPOINT') || IPFS_ENDPOINTS[network].gateway,
  }
}

export function getEnvironmentConfig(chainId?: number) {
  const cid = chainId || Number(getEnv('CHAIN_ID')) || CHAIN_IDS.localnet
  const network = getNetworkType(cid)
  const contracts = getContracts(cid)
  const ipfs = getIPFSEndpoints(cid)

  return {
    chainId: cid,
    network,
    rpcUrl: getRpcUrl(cid),
    contracts,
    ipfs,
    teeMode: (getEnv('TEE_MODE') || 'simulated') as TEEMode,
  }
}

// MPC Configuration
export const MPC_DEFAULTS = {
  threshold: 2,
  totalParties: 3,
  sessionTimeout: 60000, // 1 minute
} as const

// OAuth3 Agent Configuration
export interface OAuth3AgentConfig {
  nodeId: string
  clusterId: string
  port: number
  chainId: number
  teeMode: TEEMode
  mpcEnabled: boolean
  mpcThreshold: number
  mpcTotalParties: number
}

export function getAgentConfig(): OAuth3AgentConfig {
  return {
    nodeId: getEnv('OAUTH3_NODE_ID') || `oauth3-${Date.now()}`,
    clusterId: getEnv('OAUTH3_CLUSTER_ID') || 'oauth3-local-cluster',
    port: Number(getEnv('OAUTH3_PORT')) || 4200,
    chainId: Number(getEnv('CHAIN_ID')) || CHAIN_IDS.localnet,
    teeMode: (getEnv('TEE_MODE') || 'simulated') as TEEMode,
    mpcEnabled: getEnv('MPC_ENABLED') === 'true',
    mpcThreshold: Number(getEnv('MPC_THRESHOLD')) || MPC_DEFAULTS.threshold,
    mpcTotalParties:
      Number(getEnv('MPC_TOTAL_PARTIES')) || MPC_DEFAULTS.totalParties,
  }
}
