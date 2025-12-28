/**
 * Leaderboard Configuration
 *
 * SECURITY: This module no longer stores private keys.
 * Oracle signing is delegated to the KMS service (MPC or TEE).
 */

import { getDWSUrl, getEQLiteUrl, getLocalhostHost } from '@jejunetwork/config'
import { CHAIN_ID, CONTRACTS, NETWORK } from '../../lib/config'
import { CHAIN_IDS } from '../../lib/config/networks'
import { config } from '../config'

export const LEADERBOARD_DB = {
  databaseId: config.leaderboardEqliteDatabaseId,
  endpoint: getEQLiteUrl(),
  timeout: 30000,
  debug: config.leaderboardDebug,
} as const

export const LEADERBOARD_CHAIN = {
  chainId: CHAIN_ID,
  caip2ChainId: `eip155:${CHAIN_ID}`,
  network: NETWORK,
  supportedChains: Object.values(CHAIN_IDS),
} as const

export const LEADERBOARD_CONTRACTS = {
  githubReputationProvider: CONTRACTS.githubReputationProvider,
  identityRegistry: CONTRACTS.identityRegistry,
} as const

/**
 * Oracle configuration for attestation signing.
 *
 * SECURITY: No private key stored. Uses KMS service ID instead.
 * Set LEADERBOARD_ORACLE_ENABLED=true to enable oracle attestations.
 */
export const LEADERBOARD_ORACLE = {
  /** KMS service ID for signing attestations */
  serviceId: process.env.LEADERBOARD_ORACLE_SERVICE_ID ?? 'leaderboard-oracle',
  /** Whether oracle attestations are enabled */
  get isEnabled(): boolean {
    // Enabled if explicitly set, or if reputation provider is configured
    const explicitlyEnabled = process.env.LEADERBOARD_ORACLE_ENABLED === 'true'
    const providerConfigured =
      LEADERBOARD_CONTRACTS.githubReputationProvider !==
      '0x0000000000000000000000000000000000000000'
    return explicitlyEnabled || providerConfigured
  },
} as const

export const LEADERBOARD_DOMAIN = {
  get domain(): string {
    return config.leaderboardDomain || getDomainDefault()
  },
  tokenIssuer: 'jeju:leaderboard',
  tokenAudience: 'gateway',
} as const

function getDomainDefault(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'leaderboard.jejunetwork.org'
    case 'testnet':
      return 'testnet-leaderboard.jejunetwork.org'
    default:
      return `${getLocalhostHost()}:4013`
  }
}

export const LEADERBOARD_RATE_LIMITS = {
  attestation: { requests: 10, windowMs: 60000 },
  walletVerify: { requests: 5, windowMs: 60000 },
  agentLink: { requests: 10, windowMs: 60000 },
  general: { requests: 100, windowMs: 60000 },
  a2a: { requests: 50, windowMs: 60000 },
} as const

export const LEADERBOARD_TOKENS = {
  expirySeconds: 86400,
  maxMessageAgeMs: 10 * 60 * 1000,
} as const

export const LEADERBOARD_GITHUB = {
  get token(): string | undefined {
    return config.githubToken
  },
  get repositories(): string[] {
    return config.leaderboardRepositories.split(',')
  },
} as const

export const LEADERBOARD_STORAGE = {
  get dwsApiUrl(): string {
    return config.dwsApiUrl || getDWSUrl()
  },
  get dataDir(): string {
    return config.leaderboardDataDir
  },
} as const

export const LEADERBOARD_LLM = {
  get openRouterApiKey(): string | undefined {
    return config.openrouterApiKey
  },
  get model(): string {
    return config.leaderboardLlmModel
  },
} as const

export const LEADERBOARD_CONFIG = {
  db: LEADERBOARD_DB,
  chain: LEADERBOARD_CHAIN,
  contracts: LEADERBOARD_CONTRACTS,
  oracle: LEADERBOARD_ORACLE,
  domain: LEADERBOARD_DOMAIN,
  rateLimits: LEADERBOARD_RATE_LIMITS,
  tokens: LEADERBOARD_TOKENS,
  github: LEADERBOARD_GITHUB,
  storage: LEADERBOARD_STORAGE,
  llm: LEADERBOARD_LLM,
} as const
