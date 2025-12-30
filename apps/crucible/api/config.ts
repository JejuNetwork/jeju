import {
  createAppConfig,
  getCurrentNetwork,
  getEnvNumber,
  getEnvVar,
  getLocalhostHost,
  getServicesConfig,
} from '@jejunetwork/config'

export interface CrucibleConfig {
  // Network
  network: 'mainnet' | 'testnet' | 'localnet'

  // API
  apiKey?: string
  apiPort: number
  requireAuth: boolean

  // Rate Limiting
  rateLimitMaxRequests: number
  corsAllowedOrigins: string

  // Private Key
  privateKey?: string

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

  // Cron
  cronSecret?: string

  // Moderation
  banManagerAddress?: string
  moderationMarketplaceAddress?: string
}

const servicesConfig = getServicesConfig()
const network = getCurrentNetwork()

const { config, configure: setCrucibleConfig } =
  createAppConfig<CrucibleConfig>({
    network,
    apiKey: getEnvVar('API_KEY'),
    apiPort: getEnvNumber('API_PORT') ?? 4021,
    requireAuth:
      getEnvVar('REQUIRE_AUTH') === 'true' ||
      (getEnvVar('REQUIRE_AUTH') !== 'false' && network !== 'localnet'),
    rateLimitMaxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS') ?? 100,
    corsAllowedOrigins: (() => {
      const host = getLocalhostHost()
      return (
        getEnvVar('CORS_ALLOWED_ORIGINS') ??
        `http://${host}:4020,http://${host}:4021`
      )
    })(),
    privateKey: getEnvVar('PRIVATE_KEY'),
    autocratTreasuryAddress: getEnvVar('AUTOCRAT_TREASURY_ADDRESS'),
    computeMarketplaceUrl: getEnvVar('COMPUTE_MARKETPLACE_URL'),
    sqlitEndpoint:
      getEnvVar('SQLIT_ENDPOINT') ?? servicesConfig.sqlit.blockProducer,
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
    cronSecret: getEnvVar('CRON_SECRET'),
    banManagerAddress: getEnvVar('MODERATION_BAN_MANAGER'),
    moderationMarketplaceAddress: getEnvVar('MODERATION_MARKETPLACE_ADDRESS'),
  })

export { config }

export function configureCrucible(updates: Partial<CrucibleConfig>): void {
  setCrucibleConfig(updates)
}
