/**
 * Direct Cast Message Types
 *
 * Type definitions for encrypted direct messages between Farcaster users.
 */

import type { Hex } from 'viem'
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
export interface DCAuthMessage {
  type: 'auth'
  payload: {
    fid: number
    signature: Hex
    timestamp: number
  }
}

export interface DCSendMessage {
  type: 'send'
  payload: {
    recipientFid: number
    ciphertext: Hex
    nonce: Hex
    ephemeralPublicKey: Hex
  }
}

export interface DCTypingMessage {
  type: 'typing'
  payload: {
    conversationId: string
    isTyping: boolean
  }
}

export interface DCReadMessage {
  type: 'read'
  payload: {
    conversationId: string
    messageId: string
  }
}

export interface DCSubscribeMessage {
  type: 'subscribe'
  payload: {
    conversationIds: string[]
  }
}

export type DCWebSocketMessage =
  | DCAuthMessage
  | DCSendMessage
  | DCTypingMessage
  | DCReadMessage
  | DCSubscribeMessage

export interface DCAuthSuccessResponse {
  type: 'auth_success'
  payload: {
    fid: number
    sessionId: string
  }
}

export interface DCAuthFailedResponse {
  type: 'auth_failed'
  payload: {
    error: string
  }
}

export interface DCMessageResponse {
  type: 'message'
  payload: {
    id: string
    conversationId: string
    senderFid: number
    recipientFid: number
    ciphertext: Hex
    nonce: Hex
    ephemeralPublicKey: Hex
    timestamp: number
    signature: Hex
  }
}

export interface DCNotificationResponse {
  type: 'notification'
  payload: {
    notificationType: DCNotificationType
    conversationId: string
    senderFid: number
    timestamp: number
    messageId?: string
  }
}

export interface DCErrorResponse {
  type: 'error'
  payload: {
    error: string
    code?: string
  }
}

export type DCWebSocketResponse =
  | DCAuthSuccessResponse
  | DCAuthFailedResponse
  | DCMessageResponse
  | DCNotificationResponse
  | DCErrorResponse
