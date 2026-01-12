/**
 * Leaderboard Configuration
 *
 * SECURITY: This module no longer stores private keys or API tokens directly.
 * - Oracle signing is delegated to the KMS service (MPC or TEE).
 * - API tokens (GitHub, OpenRouter) are stored in KMS SecretVault.
 */

import {
  getDWSUrl,
  getLocalhostHost,
  getSQLitUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { getSecretVault } from '@jejunetwork/kms'
import { zeroAddress } from 'viem'
import { CHAIN_ID, CONTRACTS, NETWORK } from '../../lib/config'
import { CHAIN_IDS } from '../../lib/config/networks'
import { config } from '../config'

/**
 * Cached API tokens from KMS vault
 */
const tokenCache = {
  github: null as string | null,
  openrouter: null as string | null,
  loaded: false,
}

/**
 * Load API tokens from KMS vault
 *
 * SECURITY: API tokens are stored encrypted in KMS SecretVault.
 * In development, falls back to environment variables for local testing only.
 */
async function loadTokensFromKMS(): Promise<void> {
  if (tokenCache.loaded) return

  try {
    const vault = getSecretVault()
    await vault.initialize()

    try {
      tokenCache.github = await vault.getSecret('github-token', zeroAddress)
    } catch {
      if (isProductionEnv()) {
        console.warn('[Leaderboard] GitHub token not found in KMS vault')
      }
    }

    try {
      tokenCache.openrouter = await vault.getSecret(
        'openrouter-api-key',
        zeroAddress,
      )
    } catch {
      if (isProductionEnv()) {
        console.warn('[Leaderboard] OpenRouter API key not found in KMS vault')
      }
    }
  } catch {
    if (isProductionEnv()) {
      console.warn('[Leaderboard] Failed to connect to KMS vault for tokens')
    }
  }

  tokenCache.loaded = true
}

/**
 * Get GitHub token from KMS vault (async)
 */
export async function getGitHubToken(): Promise<string | undefined> {
  await loadTokensFromKMS()
  return tokenCache.github ?? undefined
}

/**
 * Get OpenRouter API key from KMS vault (async)
 */
export async function getOpenRouterApiKey(): Promise<string | undefined> {
  await loadTokensFromKMS()
  return tokenCache.openrouter ?? undefined
}

export const LEADERBOARD_DB = {
  databaseId: config.leaderboardSQLitDatabaseId,
  endpoint: getSQLitUrl(),
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
