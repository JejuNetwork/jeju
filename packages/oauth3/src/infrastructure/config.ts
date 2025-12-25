/**
 * Shared configuration for OAuth3 infrastructure
 *
 * Environments:
 * - localnet: Local development with anvil (chain 420691)
 * - testnet: Jeju Testnet for staging (chain 420690)
 * - mainnet: Jeju Mainnet for production (chain 420692)
 */

import { getEnv } from '@jejunetwork/shared'
import { type NetworkType, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

export type { NetworkType }
export type TEEMode = 'dstack' | 'phala' | 'simulated' | 'auto'

export const CHAIN_IDS = {
  localnet: 420691,
  localnetAnvil: 31337, // Standard anvil/hardhat chain ID
  testnet: 420690,
  mainnet: 420692,
} as const

export const RPC_URLS: Record<NetworkType, string> = {
  localnet: 'http://localhost:6546',
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
    base: 'http://localhost:4030',
    api: 'http://localhost:4030/storage/api/v0',
    gateway: 'http://localhost:4030/storage/ipfs',
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

// Localnet addresses (from local anvil deployment)
const LOCALNET_CONTRACTS = {
  jnsRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
  jnsResolver: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address,
  appRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address,
  identityRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707' as Address,
  teeVerifier: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address,
} as const

// Testnet addresses (Jeju Testnet deployment)
const TESTNET_CONTRACTS = {
  jnsRegistry: '0x4B0897b0513fdC7C541B6d9D7E929C4e5364D2dB' as Address,
  jnsResolver: '0x14dc79964da2C08b23698B3D3cc7Ca32193d9955' as Address,
  appRegistry: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f' as Address,
  identityRegistry: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720' as Address,
  teeVerifier: '0xBcd4042DE499D14e55001CcbB24a551F3b954096' as Address,
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

  // Fail fast if mainnet contracts not deployed
  if (network === 'mainnet' && contracts.jnsRegistry === ZERO_ADDRESS) {
    throw new Error(
      'Mainnet contracts not yet deployed. Use testnet or localnet.',
    )
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
