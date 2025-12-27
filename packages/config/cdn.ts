/**
 * CDN Configuration
 *
 * Config-first approach for decentralized CDN settings.
 * All public values in config, secrets via wallet/signer.
 *
 * Architecture:
 * - Permissionless: Anyone can run a CDN edge node
 * - Decentralized: Nodes discover each other via on-chain registry + P2P
 * - Financialized: Staking, earnings, settlements via smart contracts
 *
 * Integration:
 * - Node App: Uses these configs for CDN edge node operation
 * - DWS: Uses these configs for CDN coordination and routing
 */

import { z } from 'zod'
import { getContract, getCurrentNetwork, getServiceUrl } from './index'

// CDN Regions - matches on-chain enum
export const CDN_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'sa-east-1',
  'af-south-1',
  'me-south-1',
  'global',
] as const

export type CDNRegionType = (typeof CDN_REGIONS)[number]

// P2P Coordination Regions (libp2p)
export const P2P_REGIONS = [
  'na-east',
  'na-west',
  'eu-west',
  'eu-central',
  'apac-east',
  'apac-south',
  'sa',
  'global',
] as const

export type P2PRegionType = (typeof P2P_REGIONS)[number]

// Region mapping between CDN and P2P
export const CDN_TO_P2P_REGION: Record<CDNRegionType, P2PRegionType> = {
  'us-east-1': 'na-east',
  'us-east-2': 'na-east',
  'us-west-1': 'na-west',
  'us-west-2': 'na-west',
  'eu-west-1': 'eu-west',
  'eu-west-2': 'eu-west',
  'eu-central-1': 'eu-central',
  'ap-northeast-1': 'apac-east',
  'ap-northeast-2': 'apac-east',
  'ap-southeast-1': 'apac-south',
  'ap-southeast-2': 'apac-south',
  'ap-south-1': 'apac-south',
  'sa-east-1': 'sa',
  'af-south-1': 'global',
  'me-south-1': 'global',
  global: 'global',
}

// ============================================================================
// Edge Cache Configuration
// ============================================================================

export const EdgeCacheConfigSchema = z.object({
  /** Max cache size in bytes */
  maxSizeBytes: z
    .number()
    .int()
    .positive()
    .default(512 * 1024 * 1024), // 512MB
  /** Max number of cache entries */
  maxEntries: z.number().int().positive().default(100000),
  /** Default TTL in seconds */
  defaultTTL: z.number().int().nonnegative().default(3600), // 1 hour
  /** Enable compression */
  enableCompression: z.boolean().default(true),
  /** Min size to compress (bytes) */
  compressionThreshold: z.number().int().nonnegative().default(1024),
  /** Stale-while-revalidate window (seconds) */
  staleWhileRevalidate: z.number().int().nonnegative().default(60),
  /** Stale-if-error window (seconds) */
  staleIfError: z.number().int().nonnegative().default(300),
})

export type EdgeCacheConfig = z.infer<typeof EdgeCacheConfigSchema>

// ============================================================================
// P2P Configuration (WebTorrent/BitTorrent integration)
// ============================================================================

export const P2PConfigSchema = z.object({
  /** Enable P2P content distribution */
  enabled: z.boolean().default(true),
  /** Min access count before enabling P2P for content */
  threshold: z.number().int().positive().default(10),
  /** Min content size for P2P (bytes) */
  minSize: z
    .number()
    .int()
    .nonnegative()
    .default(10 * 1024), // 10KB
  /** Max content size for P2P (bytes) */
  maxSize: z
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024), // 100MB
  /** Auto-seed popular content */
  autoSeedPopular: z.boolean().default(true),
  /** Popularity threshold for auto-seeding */
  popularityThreshold: z.number().int().positive().default(50),
  /** Max concurrent seeding torrents */
  maxSeedingTorrents: z.number().int().positive().default(100),
  /** Target seed ratio */
  seedRatioTarget: z.number().positive().default(2.0),
  /** Percent of bandwidth for P2P */
  bandwidthPercent: z.number().int().min(0).max(100).default(50),
  /** Prioritize system content seeding */
  systemContentPriority: z.boolean().default(true),
  /** Max time to wait for P2P (ms) */
  timeout: z.number().int().positive().default(10000),
  /** Fallback to origin if P2P fails */
  fallbackToOrigin: z.boolean().default(true),
  /** WebTorrent trackers */
  trackers: z
    .array(z.string())
    .default([
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.btorrent.xyz',
      'wss://tracker.fastcast.nz',
      'udp://tracker.openbittorrent.com:80',
      'udp://tracker.opentrackr.org:31337',
    ]),
})

export type P2PConfig = z.infer<typeof P2PConfigSchema>

// ============================================================================
// Coordination Configuration (libp2p GossipSub)
// ============================================================================

export const CoordinationConfigSchema = z.object({
  /** Node ID (auto-generated if not provided) */
  nodeId: z.string().optional(),
  /** P2P region for mesh networking */
  region: z.enum(P2P_REGIONS).default('global'),
  /** HTTP endpoint for this node */
  endpoint: z.string().url().optional(),
  /** Bootstrap peer multiaddrs */
  bootstrapPeers: z.array(z.string()).default([]),
  /** Enable metrics broadcasting */
  broadcastMetrics: z.boolean().default(true),
  /** Metrics broadcast interval (ms) */
  metricsInterval: z.number().int().positive().default(30000),
  /** Enable hot content detection */
  enableHotContentDetection: z.boolean().default(true),
  /** Hot content threshold (requests/minute) */
  hotContentThreshold: z.number().int().positive().default(100),
  /** GossipSub mesh size */
  meshSize: z.number().int().positive().default(6),
  /** Sign messages */
  signMessages: z.boolean().default(false),
})

export type CoordinationConfig = z.infer<typeof CoordinationConfigSchema>

// ============================================================================
// Edge Node Configuration (for node operators)
// ============================================================================

export const EdgeNodeConfigSchema = z.object({
  /** Node operator region */
  region: z.enum(CDN_REGIONS).default('global'),
  /** Edge node HTTP port */
  port: z.number().int().positive().default(4020),
  /** Public endpoint URL */
  endpoint: z.string().url().optional(),
  /** Edge cache config */
  cache: EdgeCacheConfigSchema.default({}),
  /** P2P config */
  p2p: P2PConfigSchema.default({}),
  /** Coordination config */
  coordination: CoordinationConfigSchema.default({}),
  /** Max concurrent connections */
  maxConnections: z.number().int().positive().default(10000),
  /** Request timeout (ms) */
  requestTimeout: z.number().int().positive().default(30000),
  /** Enable HTTP/2 */
  enableHTTP2: z.boolean().default(true),
  /** IPFS gateway URL */
  ipfsGateway: z.string().url().optional(),
  /** Arweave gateway URL */
  arweaveGateway: z.string().url().default('https://arweave.net'),
})

export type EdgeNodeConfig = z.infer<typeof EdgeNodeConfigSchema>

// ============================================================================
// Staking & Billing Configuration (on-chain integration)
// ============================================================================

export const StakingConfigSchema = z.object({
  /** Minimum stake required (wei) */
  minStake: z.bigint().default(BigInt('100000000000000000')), // 0.1 ETH
  /** Settlement interval (ms) */
  settlementInterval: z.number().int().positive().default(3600000), // 1 hour
  /** Min amount for settlement (wei) */
  minSettlementAmount: z.bigint().default(BigInt('1000000000000000')), // 0.001 ETH
  /** Auto-claim earnings */
  autoClaim: z.boolean().default(false),
  /** Auto-compound earnings */
  autoCompound: z.boolean().default(false),
})

export type StakingConfig = z.infer<typeof StakingConfigSchema>

// ============================================================================
// Full CDN Configuration
// ============================================================================

export const CDNConfigSchema = z.object({
  /** Edge node config */
  edge: EdgeNodeConfigSchema.default({}),
  /** Staking config */
  staking: StakingConfigSchema.default({}),
})

export type CDNConfig = z.infer<typeof CDNConfigSchema>

// ============================================================================
// Config Getters (Config-First with minimal env overrides)
// ============================================================================

let cachedConfig: CDNConfig | null = null

/**
 * Get CDN configuration.
 * Uses config-first approach with contract addresses from config.
 */
export function getCDNConfig(overrides?: Partial<CDNConfig>): CDNConfig {
  if (cachedConfig && !overrides) return cachedConfig

  const network = getCurrentNetwork()

  // Get service URLs from config
  const dwsApiUrl = getServiceUrl('dws', 'api')
  const _nodeApiUrl = getServiceUrl('node', 'api')
  const nodeCdnUrl = getServiceUrl('node', 'cdn')
  const ipfsGatewayUrl = getServiceUrl('storage', 'ipfsGateway')

  // Build default config from services.json
  const defaultConfig: CDNConfig = {
    edge: {
      region: 'global',
      port: 4020,
      endpoint: nodeCdnUrl ?? undefined,
      cache: {
        maxSizeBytes: 512 * 1024 * 1024,
        maxEntries: 100000,
        defaultTTL: 3600,
        enableCompression: true,
        compressionThreshold: 1024,
        staleWhileRevalidate: 60,
        staleIfError: 300,
      },
      p2p: {
        enabled: true,
        threshold: 10,
        minSize: 10 * 1024,
        maxSize: 100 * 1024 * 1024,
        autoSeedPopular: true,
        popularityThreshold: 50,
        maxSeedingTorrents: 100,
        seedRatioTarget: 2.0,
        bandwidthPercent: 50,
        systemContentPriority: true,
        timeout: 10000,
        fallbackToOrigin: true,
        trackers: [
          'wss://tracker.openwebtorrent.com',
          'wss://tracker.btorrent.xyz',
          'wss://tracker.fastcast.nz',
          'udp://tracker.openbittorrent.com:80',
          'udp://tracker.opentrackr.org:31337',
        ],
      },
      coordination: {
        nodeId: undefined, // Auto-generated
        region: 'global',
        endpoint: dwsApiUrl ?? undefined,
        bootstrapPeers: getBootstrapPeers(network),
        broadcastMetrics: true,
        metricsInterval: 30000,
        enableHotContentDetection: true,
        hotContentThreshold: 100,
        meshSize: 6,
        signMessages: false,
      },
      maxConnections: 10000,
      requestTimeout: 30000,
      enableHTTP2: true,
      ipfsGateway: ipfsGatewayUrl ?? undefined,
      arweaveGateway: 'https://arweave.net',
    },
    staking: {
      minStake: BigInt('100000000000000000'),
      settlementInterval: 3600000,
      minSettlementAmount: BigInt('1000000000000000'),
      autoClaim: false,
      autoCompound: false,
    },
  }

  // Merge with overrides
  const config = overrides
    ? CDNConfigSchema.parse(deepMerge(defaultConfig, overrides))
    : CDNConfigSchema.parse(defaultConfig)

  cachedConfig = config
  return config
}

/**
 * Get CDN contract addresses from config.
 */
export function getCDNContracts(): {
  cdnRegistry: string
  cdnBilling: string
  cdnCoordinator: string
  contentRegistry: string
} {
  return {
    cdnRegistry: getContract('cdn', 'cdnRegistry') ?? '',
    cdnBilling: getContract('cdn', 'cdnBilling') ?? '',
    cdnCoordinator: getContract('cdn', 'cdnCoordinator') ?? '',
    contentRegistry: getContract('cdn', 'contentRegistry') ?? '',
  }
}

/**
 * Get JNS contract addresses from config.
 */
export function getJNSContracts(): {
  jnsRegistry: string
  jnsResolver: string
} {
  return {
    jnsRegistry: getContract('jns', 'jnsRegistry') ?? '',
    jnsResolver: getContract('jns', 'jnsResolver') ?? '',
  }
}

/**
 * Get bootstrap peers for P2P coordination.
 */
function getBootstrapPeers(network: string): string[] {
  // Bootstrap peers per network
  const peers: Record<string, string[]> = {
    localnet: [],
    testnet: [
      '/dns4/cdn-bootstrap-1.testnet.jejunetwork.org/tcp/4001/p2p/12D3KooWGqVkVPQBk8Gq4E5jQhWKYqFrLJFQfA9tSqLXvH5v8vQB',
      '/dns4/cdn-bootstrap-2.testnet.jejunetwork.org/tcp/4001/p2p/12D3KooWGqVkVPQBk8Gq4E5jQhWKYqFrLJFQfA9tSqLXvH5v8vQC',
    ],
    mainnet: [
      '/dns4/cdn-bootstrap-1.jejunetwork.org/tcp/4001/p2p/12D3KooWGqVkVPQBk8Gq4E5jQhWKYqFrLJFQfA9tSqLXvH5v8vQD',
      '/dns4/cdn-bootstrap-2.jejunetwork.org/tcp/4001/p2p/12D3KooWGqVkVPQBk8Gq4E5jQhWKYqFrLJFQfA9tSqLXvH5v8vQE',
      '/dns4/cdn-bootstrap-3.jejunetwork.org/tcp/4001/p2p/12D3KooWGqVkVPQBk8Gq4E5jQhWKYqFrLJFQfA9tSqLXvH5v8vQF',
    ],
  }
  return peers[network] ?? []
}

/**
 * Reset cached config (for testing).
 */
export function resetCDNConfig(): void {
  cachedConfig = null
}

// ============================================================================
// Utility
// ============================================================================

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sourceVal = source[key as keyof T]
    const targetVal = target[key as keyof T]
    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      ;(result as Record<string, unknown>)[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      )
    } else if (sourceVal !== undefined) {
      ;(result as Record<string, unknown>)[key] = sourceVal
    }
  }
  return result
}
