/**
 * Direct Cast Message Types
 *
 * Type definitions for encrypted direct messages between Farcaster users.
 */

import type { Hex } from 'viem'

// ============ Message Types ============

export interface DirectCast {
  /** Unique message ID */
  id: string
  /** Conversation ID */
  conversationId: string
  /** Sender FID */
  senderFid: number
  /** Recipient FID */
  recipientFid: number
  /** Message text */
  text: string
  /** Embedded content */
  embeds?: DirectCastEmbed[]
  /** Reply to message ID */
  replyTo?: string
  /** Timestamp (ms) */
  timestamp: number
  /** Message signature */
  signature: Hex
  /** Read status */
  isRead?: boolean
}

export interface DirectCastEmbed {
  /** Embed type */
  type: 'url' | 'cast' | 'image'
  /** URL for url/image types */
  url?: string
  /** Cast reference */
  castId?: { fid: number; hash: Hex }
  /** Alt text for images */
  alt?: string
}

export interface EncryptedDirectCast {
  /** Encrypted ciphertext */
  ciphertext: Hex
  /** Encryption nonce */
  nonce: Hex
  /** Ephemeral public key */
  ephemeralPublicKey: Hex
  /** Sender FID (unencrypted for routing) */
  senderFid: number
  /** Recipient FID (unencrypted for routing) */
  recipientFid: number
  /** Timestamp */
  timestamp: number
  /** Signature over encrypted content */
  signature: Hex
}

// ============ Conversation Types ============

export interface DirectCastConversation {
  /** Unique conversation ID */
  id: string
  /** Participant FIDs (sorted) */
  participants: number[]
  /** Last message in conversation */
  lastMessage?: DirectCast
  /** Unread message count */
  unreadCount: number
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
  /** Is muted */
  isMuted?: boolean
  /** Is archived */
  isArchived?: boolean
}

// ============ Notification Types ============

export type DCNotificationType =
  | 'new_message'
  | 'read_receipt'
  | 'typing'
  | 'delivered'

export interface DirectCastNotification {
  /** Notification type */
  type: DCNotificationType
  /** Conversation ID */
  conversationId: string
  /** Sender FID */
  senderFid: number
  /** Timestamp */
  timestamp: number
  /** Message ID (for new_message, delivered) */
  messageId?: string
}

// ============ Client Types ============

export interface DCClientConfig {
  /** User's FID */
  fid: number
  /** Ed25519 signer private key */
  signerPrivateKey: Uint8Array
  /** Hub URL for key lookups */
  hubUrl: string
  /** Relay URL for message transport */
  relayUrl?: string
  /** Enable persistence */
  persistenceEnabled?: boolean
  /** Persistence path */
  persistencePath?: string
}

export interface DCClientState {
  /** Client FID */
  fid: number
  /** Is initialized */
  isInitialized: boolean
  /** Is connected to relay */
  isConnected: boolean
  /** Conversation count */
  conversationCount: number
  /** Unread message count */
  unreadCount: number
}

// ============ API Types ============

export interface SendDCParams {
  /** Recipient FID */
  recipientFid: number
  /** Message text */
  text: string
  /** Embeds */
  embeds?: DirectCastEmbed[]
  /** Reply to message ID */
  replyTo?: string
}

export interface GetMessagesParams {
  /** Limit */
  limit?: number
  /** Get messages before this ID */
  before?: string
  /** Get messages after this ID */
  after?: string
}

// ============ WebSocket Types ============

export interface DCWebSocketMessage {
  type: 'auth' | 'send' | 'typing' | 'read' | 'subscribe'
  payload: Record<string, unknown>
}

export interface DCWebSocketResponse {
  type: 'auth_success' | 'auth_failed' | 'message' | 'notification' | 'error'
  payload: Record<string, unknown>
}
