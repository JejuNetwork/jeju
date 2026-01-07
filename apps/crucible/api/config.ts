import {
  createAppConfig,
  getCurrentNetwork,
  getEnvNumber,
  getEnvVar,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'

/**
 * Crucible Configuration
 *
 * SECURITY: Secrets are NOT stored in this config.
 * Use the secrets module (./sdk/secrets.ts) for:
 * - PRIVATE_KEY
 * - API_KEY
 * - CRON_SECRET
 * - AI provider keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
 *
 * NOTE: privateKey removed for security - use KMS signer via @jejunetwork/kms instead
 */
export interface CrucibleConfig {
  // Network
  network: 'mainnet' | 'testnet' | 'localnet'

  // API (auth is handled via secrets module)
  apiPort: number
  requireAuth: boolean

  // Rate Limiting
  rateLimitMaxRequests: number
  corsAllowedOrigins: string

  // Contracts
  autocratTreasuryAddress?: string
  computeMarketplaceUrl?: string
  sqlitEndpoint?: string
  dexCacheUrl?: string

  // Bots
  botsEnabled: boolean

  // Autonomous
  autonomousEnabled: boolean
  enableBuiltinCharacters: boolean
  defaultTickIntervalMs: number
  maxConcurrentAgents: number

  // Messaging
  farcasterHubUrl: string

  // DWS
  dwsUrl?: string
  ipfsGateway?: string

  // Moderation
  banManagerAddress?: string
  moderationMarketplaceAddress?: string
}

// IMPORTANT: Do NOT call getCurrentNetwork() at module level!
// In DWS worker context, env vars are set AFTER module evaluation begins.
// Use lazy getter functions instead.
function getNetwork(): 'mainnet' | 'testnet' | 'localnet' {
  return getCurrentNetwork()
}

const { config, configure: setCrucibleConfig } =
  createAppConfig<CrucibleConfig>({
    network: getNetwork(),
    apiPort: getEnvNumber('API_PORT') ?? 4021,
    requireAuth:
      getEnvVar('REQUIRE_AUTH') === 'true' ||
      (getEnvVar('REQUIRE_AUTH') !== 'false' && getNetwork() !== 'localnet'),
    rateLimitMaxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS') ?? 100,
    corsAllowedOrigins: (() => {
      const host = getLocalhostHost()
      const envOrigins = getEnvVar('CORS_ALLOWED_ORIGINS')
      if (envOrigins) return envOrigins

      // Default origins based on network
      const net = getNetwork()
      const localOrigins = `http://${host}:4020,http://${host}:4021`
      if (net === 'localnet') return localOrigins

      // Testnet/mainnet: include deployed origins
      const deployedOrigins =
        net === 'testnet'
          ? 'https://crucible.testnet.jejunetwork.org,https://dws.testnet.jejunetwork.org'
          : 'https://crucible.jejunetwork.org,https://dws.jejunetwork.org'

      return `${deployedOrigins},${localOrigins}`
    })(),
    autocratTreasuryAddress: getEnvVar('AUTOCRAT_TREASURY_ADDRESS'),
    computeMarketplaceUrl: getEnvVar('COMPUTE_MARKETPLACE_URL'),
    sqlitEndpoint: getEnvVar('SQLIT_ENDPOINT') ?? getSQLitBlockProducerUrl(),
    dexCacheUrl: getEnvVar('DEX_CACHE_URL'),
    botsEnabled: getEnvVar('BOTS_ENABLED') !== 'false',
    autonomousEnabled: getEnvVar('AUTONOMOUS_ENABLED') === 'true',
    enableBuiltinCharacters: getEnvVar('ENABLE_BUILTIN_CHARACTERS') !== 'false',
    defaultTickIntervalMs: getEnvNumber('TICK_INTERVAL_MS') ?? 60_000,
    maxConcurrentAgents: getEnvNumber('MAX_CONCURRENT_AGENTS') ?? 10,
    farcasterHubUrl:
      getEnvVar('FARCASTER_HUB_URL') ?? 'https://hub.pinata.cloud',
    dwsUrl: getEnvVar('DWS_URL'),
    ipfsGateway: getEnvVar('IPFS_GATEWAY'),
    banManagerAddress: getEnvVar('MODERATION_BAN_MANAGER'),
    moderationMarketplaceAddress: getEnvVar('MODERATION_MARKETPLACE_ADDRESS'),
  })

export { config }

export function configureCrucible(updates: Partial<CrucibleConfig>): void {
  setCrucibleConfig(updates)
}
