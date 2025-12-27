/**
 * CDN Coordination Types
 *
 * Types for the libp2p GossipSub-based CDN coordination protocol.
 * Enables global cache invalidation, content replication, and node coordination.
 */

import { z } from 'zod'

// Message types for CDN coordination topics
export const CDNMessageType = {
  CACHE_INVALIDATION: 'cache_invalidation',
  CONTENT_REPLICATE: 'content_replicate',
  NODE_METRICS: 'node_metrics',
  NODE_JOIN: 'node_join',
  NODE_LEAVE: 'node_leave',
  HOT_CONTENT: 'hot_content',
  MAGNET_ANNOUNCE: 'magnet_announce', // WebTorrent magnet URI announcement
} as const

export type CDNMessageType =
  (typeof CDNMessageType)[keyof typeof CDNMessageType]

// GossipSub topics
export const CDNTopics = {
  INVALIDATION: '/jeju/cdn/invalidation/1.0.0',
  REPLICATION: '/jeju/cdn/replication/1.0.0',
  METRICS: '/jeju/cdn/metrics/1.0.0',
  ANNOUNCEMENTS: '/jeju/cdn/announcements/1.0.0',
  MAGNETS: '/jeju/cdn/magnets/1.0.0', // WebTorrent magnet URIs
} as const

export type CDNTopic = (typeof CDNTopics)[keyof typeof CDNTopics]

// Region codes for geographic routing
export const CDNRegion = {
  NA_EAST: 'na-east',
  NA_WEST: 'na-west',
  EU_WEST: 'eu-west',
  EU_CENTRAL: 'eu-central',
  APAC_EAST: 'apac-east',
  APAC_SOUTH: 'apac-south',
  SA: 'sa',
  GLOBAL: 'global',
} as const

export type CDNRegion = (typeof CDNRegion)[keyof typeof CDNRegion]

// Cache invalidation request
export const CacheInvalidationSchema = z.object({
  type: z.literal(CDNMessageType.CACHE_INVALIDATION),
  requestId: z.string(),
  siteId: z.string().optional(),
  patterns: z.array(z.string()), // Glob patterns or exact paths
  regions: z.array(z.string()), // Target regions (empty = all)
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  timestamp: z.number(),
  originNode: z.string(), // Node ID that initiated
  signature: z.string().optional(), // Optional signature for verification
})

export type CacheInvalidation = z.infer<typeof CacheInvalidationSchema>

// Content replication request
export const ContentReplicateSchema = z.object({
  type: z.literal(CDNMessageType.CONTENT_REPLICATE),
  requestId: z.string(),
  contentHash: z.string(), // IPFS CID or content hash
  contentType: z.string(),
  size: z.number(), // Size in bytes
  targetRegions: z.array(z.string()),
  priority: z.enum(['low', 'normal', 'high']),
  ttl: z.number(), // TTL in seconds
  timestamp: z.number(),
  originNode: z.string(),
})

export type ContentReplicate = z.infer<typeof ContentReplicateSchema>

// Node metrics report
export const NodeMetricsSchema = z.object({
  type: z.literal(CDNMessageType.NODE_METRICS),
  nodeId: z.string(),
  region: z.string(),
  timestamp: z.number(),
  metrics: z.object({
    cacheSize: z.number(), // Bytes
    cacheCapacity: z.number(), // Bytes
    cacheHitRate: z.number(), // 0-1
    requestsPerSecond: z.number(),
    bandwidthUsed: z.number(), // Bytes per second
    bandwidthCapacity: z.number(),
    p99Latency: z.number(), // ms
    cpuUsage: z.number(), // 0-1
    memoryUsage: z.number(), // 0-1
    connections: z.number(),
    uptime: z.number(), // seconds
  }),
  topContent: z
    .array(
      z.object({
        hash: z.string(),
        requests: z.number(),
        size: z.number(),
      }),
    )
    .max(10),
})

export type NodeMetrics = z.infer<typeof NodeMetricsSchema>

// Node announcement (join/leave)
export const NodeAnnouncementSchema = z.object({
  type: z.enum([CDNMessageType.NODE_JOIN, CDNMessageType.NODE_LEAVE]),
  nodeId: z.string(),
  peerId: z.string(), // libp2p peer ID
  region: z.string(),
  endpoint: z.string(), // HTTP endpoint
  capabilities: z.array(z.string()), // e.g., ['cache', 'compute', 'gpu']
  capacity: z
    .object({
      cacheMb: z.number(),
      bandwidthMbps: z.number(),
    })
    .optional(),
  timestamp: z.number(),
  signature: z.string().optional(),
})

export type NodeAnnouncement = z.infer<typeof NodeAnnouncementSchema>

// Hot content notification
export const HotContentSchema = z.object({
  type: z.literal(CDNMessageType.HOT_CONTENT),
  nodeId: z.string(),
  region: z.string(),
  contentHash: z.string(),
  requestCount: z.number(), // Requests in last period
  period: z.number(), // Period in seconds
  size: z.number(),
  timestamp: z.number(),
})

export type HotContent = z.infer<typeof HotContentSchema>

// Magnet URI announcement (WebTorrent/BitTorrent)
export const MagnetAnnounceSchema = z.object({
  type: z.literal(CDNMessageType.MAGNET_ANNOUNCE),
  nodeId: z.string(),
  region: z.string(),
  cid: z.string(), // Content ID (IPFS CID or hash)
  magnetUri: z.string(), // WebTorrent magnet URI
  infoHash: z.string(), // BitTorrent info hash
  size: z.number(), // Content size in bytes
  name: z.string().optional(), // Content name
  tier: z.enum(['system', 'popular', 'private']).optional(),
  seederCount: z.number().optional(), // Known seeders
  timestamp: z.number(),
})

export type MagnetAnnounce = z.infer<typeof MagnetAnnounceSchema>

// Union type for all CDN messages
export type CDNMessage =
  | CacheInvalidation
  | ContentReplicate
  | NodeMetrics
  | NodeAnnouncement
  | HotContent
  | MagnetAnnounce

// Coordination configuration
export interface CDNCoordinationConfig {
  /** This node's ID (on-chain agent ID or derived) */
  nodeId: string

  /** This node's region */
  region: CDNRegion

  /** HTTP endpoint for this node */
  endpoint: string

  /** Bootstrap peer multiaddrs */
  bootstrapPeers: string[]

  /** Enable metrics broadcasting */
  broadcastMetrics: boolean

  /** Metrics broadcast interval (ms) */
  metricsInterval: number

  /** Enable hot content detection */
  enableHotContentDetection: boolean

  /** Hot content threshold (requests per minute) */
  hotContentThreshold: number

  /** Gossip mesh size (D parameter) */
  meshSize: number

  /** Enable message signing */
  signMessages: boolean

  /** Private key for signing (hex) */
  privateKey?: string
}

// Connected node info
export interface ConnectedNode {
  nodeId: string
  peerId: string
  region: CDNRegion
  endpoint: string
  capabilities: string[]
  lastSeen: number
  metrics?: NodeMetrics['metrics']
}

// Invalidation result
export interface InvalidationResult {
  requestId: string
  nodesNotified: number
  nodesAcknowledged: number
  errors: string[]
}

// Replication result
export interface ReplicationResult {
  requestId: string
  contentHash: string
  replicatedTo: string[] // Node IDs
  errors: string[]
}

// Default configuration factory
// Uses config-first approach - see packages/config/cdn.ts for config source
export function createDefaultCDNCoordinationConfig(
  overrides: Partial<CDNCoordinationConfig> = {},
): CDNCoordinationConfig {
  // Config defaults - prefer config over env vars
  // The calling code should pass in config values from getCDNConfig()
  return {
    nodeId: overrides.nodeId ?? `node-${Date.now()}`,
    region: overrides.region ?? CDNRegion.GLOBAL,
    endpoint: overrides.endpoint ?? 'http://localhost:4030',
    bootstrapPeers: overrides.bootstrapPeers ?? [],
    broadcastMetrics: overrides.broadcastMetrics ?? true,
    metricsInterval: overrides.metricsInterval ?? 30000, // 30 seconds
    enableHotContentDetection: overrides.enableHotContentDetection ?? true,
    hotContentThreshold: overrides.hotContentThreshold ?? 100, // 100 requests per minute
    meshSize: overrides.meshSize ?? 6,
    signMessages: overrides.signMessages ?? false,
  }
}
