/**
 * Torrent and P2P Storage Types
 * Types for WebTorrent integration and decentralized content delivery
 */

import { z } from 'zod'
import { AddressSchema, HexSchema } from './validation'

// ============ Content Types ============

export const ContentStatus = {
  UNKNOWN: 0,
  APPROVED: 1,
  FLAGGED: 2,
  BANNED: 3,
} as const
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus]

export const ContentStatusSchema = z.enum([
  ...Object.values(ContentStatus).map(String),
] as [string, ...string[]])

export const ContentViolationType = {
  NONE: 0,
  CSAM: 1,
  ILLEGAL_MATERIAL: 2,
  COPYRIGHT: 3,
  SPAM: 4,
} as const
export type ContentViolationType =
  (typeof ContentViolationType)[keyof typeof ContentViolationType]

export const ContentViolationTypeSchema = z.enum([
  ...Object.values(ContentViolationType).map(String),
] as [string, ...string[]])

export const ContentTier = {
  NETWORK_FREE: 0,
  COMMUNITY: 1,
  STANDARD: 2,
  PRIVATE_ENCRYPTED: 3,
  PREMIUM_HOT: 4,
} as const
export type ContentTier = (typeof ContentTier)[keyof typeof ContentTier]

export const ContentTierSchema = z.enum([
  ...Object.values(ContentTier).map(String),
] as [string, ...string[]])

export const ContentRecordSchema = z.object({
  contentHash: HexSchema,
  status: ContentStatusSchema,
  violationType: ContentViolationTypeSchema,
  tier: ContentTierSchema,
  uploader: AddressSchema,
  uploadedAt: z.number(),
  size: z.number().int().nonnegative(),
  seedCount: z.number().int().nonnegative(),
  rewardPool: z.bigint(),
})
export type ContentRecord = z.infer<typeof ContentRecordSchema>

export const SeederStatsSchema = z.object({
  totalBytesServed: z.bigint(),
  pendingRewards: z.bigint(),
  activeTorrents: z.number().int().nonnegative(),
  lastReportTime: z.number(),
})
export type SeederStats = z.infer<typeof SeederStatsSchema>

// ============ Torrent Types ============

export const TorrentFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
})
export type TorrentFile = z.infer<typeof TorrentFileSchema>

export const TorrentInfoSchema = z.object({
  infohash: z.string(),
  magnetUri: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  files: z.array(TorrentFileSchema),
  createdAt: z.number(),
  contentHash: HexSchema.optional(),
})
export type TorrentInfo = z.infer<typeof TorrentInfoSchema>

export const TorrentStatsSchema = z.object({
  downloaded: z.number().nonnegative(),
  uploaded: z.number().nonnegative(),
  downloadSpeed: z.number().nonnegative(),
  uploadSpeed: z.number().nonnegative(),
  peers: z.number().int().nonnegative(),
  seeds: z.number().int().nonnegative(),
  progress: z.number().nonnegative(),
  timeRemaining: z.number().nonnegative(),
})
export type TorrentStats = z.infer<typeof TorrentStatsSchema>

export const SeedingInfoSchema = z.object({
  infohash: z.string(),
  bytesUploaded: z.number().nonnegative(),
  peersServed: z.number().int().nonnegative(),
  startedAt: z.number(),
  lastActivity: z.number(),
  estimatedRewards: z.bigint(),
})
export type SeedingInfo = z.infer<typeof SeedingInfoSchema>

// ============ Upload/Download Types ============

export const TorrentUploadOptionsSchema = z.object({
  name: z.string(),
  tier: ContentTierSchema,
  trackers: z.array(z.string()).optional(),
  comment: z.string().optional(),
  private: z.boolean().optional(),
})
export type TorrentUploadOptions = z.infer<typeof TorrentUploadOptionsSchema>

export const TorrentUploadResultSchema = z.object({
  infohash: z.string(),
  magnetUri: z.string(),
  contentHash: HexSchema,
  size: z.number().int().nonnegative(),
  tier: ContentTierSchema,
  rewardPoolRequired: z.bigint(),
})
export type TorrentUploadResult = z.infer<typeof TorrentUploadResultSchema>

// Note: TorrentDownloadOptions contains a callback function which cannot be validated with Zod
export interface TorrentDownloadOptions {
  preferTorrent?: boolean
  maxPeers?: number
  timeout?: number
  progressCallback?: (stats: TorrentStats) => void
}

// ============ Swarm Types ============

export const SwarmInfoSchema = z.object({
  infohash: z.string(),
  seeders: z.number().int().nonnegative(),
  leechers: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  lastSeen: z.number(),
})
export type SwarmInfo = z.infer<typeof SwarmInfoSchema>

export const PeerInfoSchema = z.object({
  id: z.string(),
  address: z.string(),
  port: z.number().int().positive(),
  client: z.string(),
  downloadSpeed: z.number().nonnegative(),
  uploadSpeed: z.number().nonnegative(),
  downloaded: z.number().nonnegative(),
  uploaded: z.number().nonnegative(),
})
export type PeerInfo = z.infer<typeof PeerInfoSchema>

// ============ Content Routing Types ============

export const DeliveryMethodSchema = z.enum(['torrent', 'ipfs', 'cdn', 'proxy'])
export type DeliveryMethod = z.infer<typeof DeliveryMethodSchema>

// DeliveryRoute is recursive, so we need to use z.lazy
const BaseDeliveryRouteSchema = z.object({
  method: DeliveryMethodSchema,
  endpoint: z.string(),
  latencyEstimate: z.number().nonnegative(),
  cost: z.bigint(),
})

export const DeliveryRouteSchema: z.ZodType<DeliveryRoute> =
  BaseDeliveryRouteSchema.extend({
    fallbacks: z.lazy(() => z.array(DeliveryRouteSchema)),
  })
export type DeliveryRoute = z.infer<typeof BaseDeliveryRouteSchema> & {
  fallbacks: DeliveryRoute[]
}

export const ContentIdentifierSchema = z.object({
  contentHash: HexSchema,
  cid: z.string().optional(),
  infohash: z.string().optional(),
  magnetUri: z.string().optional(),
})
export type ContentIdentifier = z.infer<typeof ContentIdentifierSchema>

// ============ Moderation Types ============

export const ContentScanDetailsSchema = z.object({
  csamScore: z.number().nonnegative(),
  nsfwScore: z.number().nonnegative(),
  malwareDetected: z.boolean(),
  sensitiveDataFound: z.boolean(),
})

export const ContentScanResultSchema = z.object({
  safe: z.boolean(),
  violationType: ContentViolationTypeSchema,
  confidence: z.number().nonnegative(),
  scanDuration: z.number().nonnegative(),
  details: ContentScanDetailsSchema,
})
export type ContentScanResult = z.infer<typeof ContentScanResultSchema>

export const ModerationReportSchema = z.object({
  contentHash: HexSchema,
  reporter: AddressSchema,
  violationType: ContentViolationTypeSchema,
  evidenceHash: HexSchema,
  timestamp: z.number(),
  caseId: HexSchema.optional(),
})
export type ModerationReport = z.infer<typeof ModerationReportSchema>

// ============ Encrypted Storage Types ============

export const EncryptedContentSchema = z.object({
  cid: z.string(),
  infohash: z.string(),
  magnetUri: z.string(),
  keyId: z.string(),
  accessControlHash: HexSchema,
  encryptedSize: z.number().int().nonnegative(),
  originalSize: z.number().int().nonnegative(),
})
export type EncryptedContent = z.infer<typeof EncryptedContentSchema>

export const AuthSignatureSchema = z.object({
  sig: HexSchema,
  message: z.string(),
  address: AddressSchema,
})

export const DecryptionRequestSchema = z.object({
  identifier: z.string(),
  authSignature: AuthSignatureSchema,
})
export type DecryptionRequest = z.infer<typeof DecryptionRequestSchema>

// ============ Contract ABIs ============

export const CONTENT_REGISTRY_ABI = [
  // Content registration
  {
    name: 'registerContent',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'contentHash', type: 'bytes32' },
      { name: 'infohash', type: 'bytes32' },
      { name: 'size', type: 'uint64' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint8' }],
  },
  // Content moderation
  {
    name: 'flagContent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'contentHash', type: 'bytes32' },
      { name: 'violationType', type: 'uint8' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'caseId', type: 'bytes32' }],
  },
  {
    name: 'canServe',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isBlocked',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getContent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'contentHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'violationType', type: 'uint8' },
          { name: 'tier', type: 'uint8' },
          { name: 'uploader', type: 'address' },
          { name: 'uploadedAt', type: 'uint64' },
          { name: 'size', type: 'uint64' },
          { name: 'seedCount', type: 'uint64' },
          { name: 'rewardPool', type: 'uint128' },
        ],
      },
    ],
  },
  // Seeding
  {
    name: 'startSeeding',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'infohash', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'stopSeeding',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'infohash', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'reportSeeding',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'infohash', type: 'bytes32' },
      { name: 'bytesServed', type: 'uint128' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'getSeederStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'seeder', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'totalBytesServed', type: 'uint128' },
          { name: 'pendingRewards', type: 'uint128' },
          { name: 'activeTorrents', type: 'uint64' },
          { name: 'lastReportTime', type: 'uint64' },
        ],
      },
    ],
  },
  {
    name: 'getRewardRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [{ name: '', type: 'uint128' }],
  },
  // Blocklist
  {
    name: 'getBlocklistLength',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getBlocklistBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  // Admin
  {
    name: 'topUpRewardPool',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [],
  },
] as const
