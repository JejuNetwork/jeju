/**
 * Torrent and P2P Storage Types
 * Types for WebTorrent integration and decentralized content delivery
 */

import type { Address } from './contracts';

// ============ Content Types ============

export enum ContentStatus {
  UNKNOWN = 0,
  APPROVED = 1,
  FLAGGED = 2,
  BANNED = 3,
}

export enum ContentViolationType {
  NONE = 0,
  CSAM = 1,
  ILLEGAL_MATERIAL = 2,
  COPYRIGHT = 3,
  SPAM = 4,
}

export enum ContentTier {
  NETWORK_FREE = 0,
  COMMUNITY = 1,
  STANDARD = 2,
  PRIVATE_ENCRYPTED = 3,
  PREMIUM_HOT = 4,
}

export interface ContentRecord {
  contentHash: `0x${string}`;
  status: ContentStatus;
  violationType: ContentViolationType;
  tier: ContentTier;
  uploader: Address;
  uploadedAt: number;
  size: number;
  seedCount: number;
  rewardPool: bigint;
}

export interface SeederStats {
  totalBytesServed: bigint;
  pendingRewards: bigint;
  activeTorrents: number;
  lastReportTime: number;
}

// ============ Torrent Types ============

export interface TorrentInfo {
  infohash: string;
  magnetUri: string;
  name: string;
  size: number;
  files: TorrentFile[];
  createdAt: number;
  contentHash?: `0x${string}`;
}

export interface TorrentFile {
  name: string;
  path: string;
  size: number;
  offset: number;
}

export interface TorrentStats {
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  seeds: number;
  progress: number;
  timeRemaining: number;
}

export interface SeedingInfo {
  infohash: string;
  bytesUploaded: number;
  peersServed: number;
  startedAt: number;
  lastActivity: number;
  estimatedRewards: bigint;
}

// ============ Upload/Download Types ============

export interface TorrentUploadOptions {
  name: string;
  tier: ContentTier;
  trackers?: string[];
  comment?: string;
  private?: boolean;
}

export interface TorrentUploadResult {
  infohash: string;
  magnetUri: string;
  contentHash: `0x${string}`;
  size: number;
  tier: ContentTier;
  rewardPoolRequired: bigint;
}

export interface TorrentDownloadOptions {
  preferTorrent?: boolean;
  maxPeers?: number;
  timeout?: number;
  progressCallback?: (stats: TorrentStats) => void;
}

// ============ Swarm Types ============

export interface SwarmInfo {
  infohash: string;
  seeders: number;
  leechers: number;
  completed: number;
  lastSeen: number;
}

export interface PeerInfo {
  id: string;
  address: string;
  port: number;
  client: string;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  uploaded: number;
}

// ============ Content Routing Types ============

export type DeliveryMethod = 'torrent' | 'ipfs' | 'cdn' | 'proxy';

export interface DeliveryRoute {
  method: DeliveryMethod;
  endpoint: string;
  latencyEstimate: number;
  cost: bigint;
  fallbacks: DeliveryRoute[];
}

export interface ContentIdentifier {
  contentHash: `0x${string}`;
  cid?: string;
  infohash?: string;
  magnetUri?: string;
}

// ============ Moderation Types ============

export interface ContentScanResult {
  safe: boolean;
  violationType: ContentViolationType;
  confidence: number;
  scanDuration: number;
  details: {
    csamScore: number;
    nsfwScore: number;
    malwareDetected: boolean;
    sensitiveDataFound: boolean;
  };
}

export interface ModerationReport {
  contentHash: `0x${string}`;
  reporter: Address;
  violationType: ContentViolationType;
  evidenceHash: `0x${string}`;
  timestamp: number;
  caseId?: `0x${string}`;
}

// ============ Encrypted Storage Types ============

export interface EncryptedContent {
  cid: string;
  infohash: string;
  magnetUri: string;
  keyId: string;
  accessControlHash: `0x${string}`;
  encryptedSize: number;
  originalSize: number;
}

export interface DecryptionRequest {
  identifier: string;
  authSignature: {
    sig: `0x${string}`;
    message: string;
    address: Address;
  };
}

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
] as const;
