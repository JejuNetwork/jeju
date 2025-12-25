/**
 * XMTP/MLS Types for Jeju Messaging
 *
 * Type definitions for XMTP integration with Jeju relay infrastructure.
 */

import type { Address } from 'viem'

export interface XMTPIdentity {
  /** Ethereum address */
  address: Address
  /** XMTP installation ID */
  installationId: Uint8Array
  /** Public key bundle */
  keyBundle: XMTPKeyBundle
  /** Creation timestamp */
  createdAt: number
  /** Last activity timestamp */
  lastActiveAt: number
}

export interface XMTPKeyBundle {
  /** Identity key (Ed25519) */
  identityKey: Uint8Array
  /** Pre-key for establishing sessions */
  preKey: Uint8Array
  /** Signature of the pre-key */
  preKeySignature: Uint8Array
}

export interface XMTPEnvelope {
  /** Version identifier */
  version: number
  /** Message ID */
  id: string
  /** Sender address */
  sender: Address
  /** Recipient addresses */
  recipients: Address[]
  /** MLS encrypted payload */
  ciphertext: Uint8Array
  /** Content topic for routing */
  contentTopic: string
  /** Timestamp */
  timestamp: number
  /** Signature of the envelope */
  signature: Uint8Array
}

export interface XMTPMessage {
  /** Unique message ID */
  id: string
  /** Conversation ID (topic) */
  conversationId: string
  /** Sender address */
  sender: Address
  /** Content type */
  contentType: ContentType
  /** Message content */
  content: Uint8Array
  /** Sent timestamp */
  sentAt: number
  /** Received timestamp */
  receivedAt?: number
}

export interface ContentType {
  /** Authority (e.g., "xmtp.org") */
  authorityId: string
  /** Type identifier */
  typeId: string
  /** Version */
  versionMajor: number
  versionMinor: number
}

export interface XMTPConversation {
  /** Unique conversation ID */
  id: string
  /** Conversation topic for routing */
  topic: string
  /** Peer addresses */
  peerAddresses: Address[]
  /** Creation timestamp */
  createdAt: number
  /** Context metadata */
  context?: ConversationContext
  /** Whether this is a group conversation */
  isGroup: boolean
}

export interface ConversationContext {
  /** Conversation ID from external system */
  conversationId?: string
  /** Metadata key-value pairs */
  metadata: Record<string, string>
}

export interface XMTPGroup {
  /** Group ID */
  id: string
  /** MLS group state */
  mlsGroupId: Uint8Array
  /** Group name */
  name: string
  /** Member addresses */
  members: Address[]
  /** Admin addresses */
  admins: Address[]
  /** Creation timestamp */
  createdAt: number
  /** Last message timestamp */
  lastMessageAt?: number
  /** Group metadata */
  metadata?: Record<string, string>
}

export interface GroupMemberUpdate {
  /** Type of update */
  type: 'add' | 'remove'
  /** Affected member */
  member: Address
  /** Updated by */
  updatedBy: Address
  /** Timestamp */
  timestamp: number
}

export type ConsentState = 'allowed' | 'denied' | 'unknown'

export interface ConsentEntry {
  /** Entry type */
  entryType: 'address' | 'groupId' | 'inboxId'
  /** Entry value */
  value: string
  /** Consent state */
  state: ConsentState
  /** Updated timestamp */
  updatedAt: number
}

export interface XMTPNodeConfig {
  /** Unique node ID */
  nodeId: string
  /** Jeju relay server URL */
  jejuRelayUrl: string
  /** IPFS gateway URL for persistence */
  ipfsUrl?: string
  /** Local persistence directory */
  persistenceDir: string
  /** Network (mainnet | testnet) */
  network: 'mainnet' | 'testnet'
  /** Enable metrics */
  metricsEnabled?: boolean
  /** Metrics port */
  metricsPort?: number
  /** Skip relay connection (for testing) */
  skipRelayConnection?: boolean
}

export interface XMTPNodeStats {
  /** Node ID */
  nodeId: string
  /** Uptime in seconds */
  uptime: number
  /** Messages processed */
  messagesProcessed: number
  /** Messages forwarded */
  messagesForwarded: number
  /** Active connections */
  activeConnections: number
  /** Connected peers */
  connectedPeers: string[]
  /** Storage used bytes */
  storageUsedBytes: number
}

export interface RouteConfig {
  /** Enable multi-region routing */
  multiRegion: boolean
  /** Preferred regions in order */
  preferredRegions?: string[]
  /** Max retry attempts */
  maxRetries: number
  /** Retry delay ms */
  retryDelayMs: number
  /** Request timeout ms */
  timeoutMs: number
}

export interface RouteResult {
  /** Success flag */
  success: boolean
  /** Message ID */
  messageId?: string
  /** Relay node used */
  relayNode?: string
  /** Error message */
  error?: string
  /** Delivery time ms */
  deliveryTimeMs?: number
}

export interface SyncState {
  /** Last synced block */
  lastSyncedBlock: number
  /** Last synced timestamp */
  lastSyncedAt: number
  /** Pending messages count */
  pendingMessages: number
  /** Sync in progress */
  isSyncing: boolean
}

export interface SyncOptions {
  /** Full sync from genesis */
  fullSync: boolean
  /** Start from block */
  fromBlock?: number
  /** Sync specific topics only */
  topics?: string[]
  /** Max messages per batch */
  batchSize: number
}
