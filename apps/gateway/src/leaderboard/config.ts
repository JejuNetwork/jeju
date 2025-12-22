/**
 * Leaderboard Configuration
 *
 * Uses centralized network config - no env overrides needed for CQL.
 */

import { getCQLUrl } from '@jejunetwork/config'
import { CHAIN_ID, CONTRACTS, NETWORK } from '../config/index.js'
import { CHAIN_IDS } from '../config/networks.js'

// Database configuration - uses network-aware CQL endpoint
export const LEADERBOARD_DB = {
  /** CQL database ID */
  databaseId: process.env.LEADERBOARD_CQL_DATABASE_ID || 'leaderboard',
  /** CQL block producer endpoint - automatically from network config */
  endpoint: getCQLUrl(),
  /** Request timeout in ms */
  timeout: 30000,
  /** Enable debug logging */
  debug: process.env.NODE_ENV !== 'production',
} as const

// Chain configuration - use local Jeju chain
export const LEADERBOARD_CHAIN = {
  /** Target chain ID for attestations */
  chainId: CHAIN_ID,
  /** Chain ID in CAIP-2 format */
  caip2ChainId: `eip155:${CHAIN_ID}`,
  /** Network name */
  network: NETWORK,
  /** All supported chain IDs */
  supportedChains: Object.values(CHAIN_IDS),
} as const

// Contract addresses - use gateway contracts with defaults
export const LEADERBOARD_CONTRACTS = {
  /** GitHubReputationProvider contract address */
  githubReputationProvider: CONTRACTS.githubReputationProvider,
  /** Identity registry for ERC-8004 */
  identityRegistry: CONTRACTS.identityRegistry,
} as const

// Oracle configuration
export const LEADERBOARD_ORACLE = {
  /** Oracle private key for signing attestations (required for on-chain) */
  privateKey: process.env.ATTESTATION_ORACLE_PRIVATE_KEY as
    | `0x${string}`
    | undefined,
  /** Whether on-chain attestations are enabled */
  get isEnabled(): boolean {
    return Boolean(
      this.privateKey &&
        LEADERBOARD_CONTRACTS.githubReputationProvider !==
          '0x0000000000000000000000000000000000000000',
    )
  },
} as const

// Domain configuration
export const LEADERBOARD_DOMAIN = {
  /** Verification domain for wallet signing messages */
  domain: process.env.LEADERBOARD_DOMAIN || getDomainDefault(),
  /** Issuer for tokens */
  tokenIssuer: 'jeju:leaderboard',
  /** Audience for tokens */
  tokenAudience: 'gateway',
} as const

function getDomainDefault(): string {
  switch (NETWORK) {
    case 'mainnet':
      return 'leaderboard.jejunetwork.org'
    case 'testnet':
      return 'testnet-leaderboard.jejunetwork.org'
    default:
      return 'localhost:4001'
  }
}

// Rate limiting (requests per window)
export const LEADERBOARD_RATE_LIMITS = {
  /** Attestation endpoints */
  attestation: { requests: 10, windowMs: 60000 },
  /** Wallet verification endpoints */
  walletVerify: { requests: 5, windowMs: 60000 },
  /** Agent link endpoints */
  agentLink: { requests: 10, windowMs: 60000 },
  /** General API endpoints */
  general: { requests: 100, windowMs: 60000 },
  /** A2A endpoints */
  a2a: { requests: 50, windowMs: 60000 },
} as const

// Token configuration
export const LEADERBOARD_TOKENS = {
  /** Token expiry in seconds (24 hours) */
  expirySeconds: 86400,
  /** Maximum message age for wallet verification (10 minutes) */
  maxMessageAgeMs: 10 * 60 * 1000,
} as const

// GitHub configuration
export const LEADERBOARD_GITHUB = {
  /** GitHub token for API access (for pipelines) */
  token: process.env.GITHUB_TOKEN,
  /** Tracked repositories */
  repositories: (
    process.env.LEADERBOARD_REPOSITORIES || 'jejunetwork/jeju'
  ).split(','),
} as const

// Storage configuration (for pipeline exports)
export const LEADERBOARD_STORAGE = {
  /** DWS API URL for file storage */
  dwsApiUrl: process.env.DWS_API_URL || 'http://localhost:4030',
  /** Local data directory for exports */
  dataDir: process.env.LEADERBOARD_DATA_DIR || './data/leaderboard',
} as const

// LLM configuration (for summaries)
export const LEADERBOARD_LLM = {
  /** OpenRouter API key for AI summaries */
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  /** Model to use for summaries */
  model: process.env.LEADERBOARD_LLM_MODEL || 'anthropic/claude-3-haiku',
} as const

// Export all config as single object for convenience
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
