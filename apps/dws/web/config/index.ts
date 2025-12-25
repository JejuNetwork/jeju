/**
 * DWS Web Frontend Configuration
 *
 * Uses @jejunetwork/config for defaults with PUBLIC_ env overrides.
 * All public env vars use PUBLIC_ prefix (not VITE_).
 */

import {
  CORE_PORTS,
  getChainId as getConfigChainId,
  getContractsConfig,
  getCurrentNetwork,
  getDWSUrl as getConfigDwsUrl,
  getOAuth3Url as getConfigOAuth3Url,
  getRpcUrl as getConfigRpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

/** Get env var from import.meta.env (browser) */
function getEnv(key: string): string | undefined {
  if (typeof import.meta?.env === 'object') {
    return import.meta.env[key] as string | undefined
  }
  return undefined
}

// Network detection from PUBLIC_NETWORK or config
export const NETWORK: NetworkType = (() => {
  const envNetwork = getEnv('PUBLIC_NETWORK')
  if (
    envNetwork === 'localnet' ||
    envNetwork === 'testnet' ||
    envNetwork === 'mainnet'
  ) {
    return envNetwork
  }
  return getCurrentNetwork()
})()

// Chain configuration - prefer PUBLIC_ env, fall back to config
export const CHAIN_ID = parseInt(
  getEnv('PUBLIC_CHAIN_ID') || String(getConfigChainId(NETWORK)),
  10,
)

export const RPC_URL =
  getEnv('PUBLIC_RPC_URL') || getConfigRpcUrl(NETWORK)

export const DWS_API_URL =
  getEnv('PUBLIC_DWS_API_URL') || getConfigDwsUrl(NETWORK)

export const OAUTH3_AGENT_URL =
  getEnv('PUBLIC_OAUTH3_AGENT_URL') || getConfigOAuth3Url(NETWORK)

// WalletConnect project ID - for local dev, this can be empty
// The error "origin not on allowlist" is expected without a configured project
export const WALLETCONNECT_PROJECT_ID =
  getEnv('PUBLIC_WALLETCONNECT_PROJECT_ID') ||
  (NETWORK === 'localnet' ? '' : 'YOUR_PROJECT_ID')

// Contract addresses from config with PUBLIC_ env overrides
const contracts = getContractsConfig(NETWORK)

/** Parse env var as Address or return fallback */
function parseAddress(envKey: string, fallback?: string): Address {
  const envValue = getEnv(envKey)
  if (envValue && envValue.startsWith('0x') && envValue.length === 42) {
    return envValue as Address
  }
  return (fallback || ZERO_ADDRESS) as Address
}

export const CONTRACTS = {
  identityRegistry: parseAddress(
    'PUBLIC_IDENTITY_REGISTRY_ADDRESS',
    contracts.registry?.IdentityRegistry,
  ),
  banManager: parseAddress(
    'PUBLIC_BAN_MANAGER_ADDRESS',
    contracts.moderation?.BanManager,
  ),
  moderationMarketplace: parseAddress(
    'PUBLIC_MODERATION_MARKETPLACE_ADDRESS',
    contracts.moderation?.ModerationMarketplace,
  ),
  reportingSystem: parseAddress(
    'PUBLIC_REPORTING_SYSTEM_ADDRESS',
    contracts.moderation?.ReportingSystem,
  ),
  computeRegistry: parseAddress(
    'PUBLIC_COMPUTE_REGISTRY_ADDRESS',
    contracts.compute?.ComputeRegistry,
  ),
  fileStorageManager: parseAddress(
    'PUBLIC_FILE_STORAGE_MANAGER_ADDRESS',
    contracts.storage?.FileStorageManager,
  ),
  jnsRegistry: parseAddress('PUBLIC_JNS_REGISTRY', contracts.jns?.JNSRegistry),
  jnsResolver: parseAddress(
    'PUBLIC_JNS_RESOLVER',
    contracts.jns?.PublicResolver,
  ),
  x402Facilitator: parseAddress(
    'PUBLIC_X402_FACILITATOR_ADDRESS',
    contracts.payments?.X402Facilitator,
  ),
} as const

export const API_ENDPOINTS = {
  health: '/health',
  storage: '/storage',
  compute: '/compute',
  containers: '/containers',
  workers: '/workers',
  cdn: '/cdn',
  git: '/git',
  pkg: '/pkg',
  ci: '/ci',
  kms: '/kms',
  vpn: '/vpn',
  rpc: '/rpc',
  api: '/api',
  oauth3: '/oauth3',
  rlaif: '/rlaif',
  scraping: '/scraping',
} as const
