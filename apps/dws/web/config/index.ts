import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'

// Get environment safely
const env = typeof import.meta?.env === 'object' ? import.meta.env : {}

export const NETWORK = (env.VITE_NETWORK || 'localnet') as
  | 'localnet'
  | 'testnet'
  | 'mainnet'

function getDefaultChainId(network: string): string {
  switch (network) {
    case 'mainnet':
      return '420691'
    case 'testnet':
      return '420690'
    default:
      return '31337'
  }
}

function getDefaultRpcUrl(network: string): string {
  switch (network) {
    case 'mainnet':
      return 'https://rpc.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-rpc.jejunetwork.org'
    default:
      return 'http://127.0.0.1:6546'
  }
}

function getDefaultDwsApiUrl(network: string): string {
  switch (network) {
    case 'mainnet':
      return 'https://dws.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-dws.jejunetwork.org'
    default:
      return 'http://127.0.0.1:4030'
  }
}

function getDefaultOAuth3AgentUrl(network: string): string {
  switch (network) {
    case 'mainnet':
      return 'https://auth.jejunetwork.org'
    case 'testnet':
      return 'https://testnet-auth.jejunetwork.org'
    default:
      return 'http://127.0.0.1:4200'
  }
}

export const CHAIN_ID = parseInt(
  env.VITE_CHAIN_ID || getDefaultChainId(NETWORK),
  10,
)
export const RPC_URL = env.VITE_RPC_URL || getDefaultRpcUrl(NETWORK)
export const DWS_API_URL = env.VITE_DWS_API_URL || getDefaultDwsApiUrl(NETWORK)
export const OAUTH3_AGENT_URL =
  env.VITE_OAUTH3_AGENT_URL || getDefaultOAuth3AgentUrl(NETWORK)
// WalletConnect project ID - for local dev, this can be empty
// The error "origin not on allowlist" is expected without a configured project
export const WALLETCONNECT_PROJECT_ID =
  env.VITE_WALLETCONNECT_PROJECT_ID ||
  (NETWORK === 'localnet' ? '' : 'YOUR_PROJECT_ID')

export const CONTRACTS = {
  identityRegistry: (env.VITE_IDENTITY_REGISTRY_ADDRESS ||
    ZERO_ADDRESS) as Address,
  banManager: (env.VITE_BAN_MANAGER_ADDRESS || ZERO_ADDRESS) as Address,
  moderationMarketplace: (env.VITE_MODERATION_MARKETPLACE_ADDRESS ||
    ZERO_ADDRESS) as Address,
  reportingSystem: (env.VITE_REPORTING_SYSTEM_ADDRESS ||
    ZERO_ADDRESS) as Address,
  computeRegistry: (env.VITE_COMPUTE_REGISTRY_ADDRESS ||
    ZERO_ADDRESS) as Address,
  fileStorageManager: (env.VITE_FILE_STORAGE_MANAGER_ADDRESS ||
    ZERO_ADDRESS) as Address,
  jnsRegistry: (env.VITE_JNS_REGISTRY || ZERO_ADDRESS) as Address,
  jnsResolver: (env.VITE_JNS_RESOLVER || ZERO_ADDRESS) as Address,
  x402Facilitator: (env.VITE_X402_FACILITATOR_ADDRESS ||
    ZERO_ADDRESS) as Address,
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
