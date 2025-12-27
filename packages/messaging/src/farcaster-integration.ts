/**
 * Unified Farcaster-Messaging Integration
 *
 * Combines Jeju messaging SDK with Farcaster Direct Casts to provide
 * a unified messaging experience that works with both wallet addresses
 * and Farcaster FIDs.
 *
 * Features:
 * - Wallet-to-wallet messaging via Jeju messaging SDK
 * - FID-to-FID messaging via Farcaster Direct Casts
 * - Unified conversation view
 * - EQLite storage for persistence
 * - Automatic routing based on recipient type
 */

import type { Address } from 'viem'
import type { DCClientConfig, DirectCast, DirectCastClient } from './farcaster'
import {
  createMessagingClient,
  type MessagingClient,
  type MessagingClientConfig,
} from './sdk'
import {
  createEQLiteStorage,
  type EQLiteConfig,
  type EQLiteMessageStorage,
  type StoredMessage,
} from './storage/eqlite-storage'

export interface UnifiedMessagingConfig {
  /** Jeju messaging client config */
  messaging: MessagingClientConfig
  /** Farcaster Direct Cast client config */
  farcaster?: DCClientConfig
  /** EQLite storage config */
  storage?: EQLiteConfig
}

export interface UnifiedMessage {
  id: string
  conversationId: string
  sender: Address | number // Address for wallet, FID for Farcaster
  recipient: Address | number
  content: string
  timestamp: number
  messageType: 'wallet' | 'farcaster'
  deliveryStatus: 'pending' | 'delivered' | 'read'
  metadata?: Record<string, unknown>
}

export interface UnifiedConversation {
  id: string
  type: 'wallet' | 'farcaster' | 'mixed'
  participants: (Address | number)[]
  lastMessage?: UnifiedMessage
  unreadCount: number
  createdAt: number
  updatedAt: number
}

// Lazy import to handle build order issues
let DirectCastClientClass: typeof DirectCastClient | undefined

async function getDirectCastClient(
  config: DCClientConfig,
): Promise<DirectCastClient> {
  if (!DirectCastClientClass) {
    const mod = await import('./farcaster')
    DirectCastClientClass = mod.DirectCastClient
  }
  return new DirectCastClientClass(config)
}

/** Default chain ID for Jeju network */
const DEFAULT_CHAIN_ID = 420690

export class UnifiedMessagingService {
  private messagingClient: MessagingClient
  private farcasterClient?: DirectCastClient
  private farcasterConfig?: DCClientConfig
  private storage: EQLiteMessageStorage
  private initialized = false
  private address: Address
  private farcasterFid?: number
  private chainId: number

  constructor(config: UnifiedMessagingConfig) {
    this.messagingClient = createMessagingClient(config.messaging)
    this.address = config.messaging.address as Address
    this.chainId = DEFAULT_CHAIN_ID

    if (config.farcaster) {
      this.farcasterConfig = config.farcaster
      this.farcasterFid = config.farcaster.fid
    }
    this.storage = createEQLiteStorage(config.storage)
  }

  async initialize(signature?: string): Promise<void> {
    if (this.initialized) return

    // Initialize messaging client
    if (signature) {
      await this.messagingClient.initialize(signature)
    }

    // Initialize Farcaster client (lazy load)
    if (this.farcasterConfig) {
      this.farcasterClient = await getDirectCastClient(this.farcasterConfig)
      await this.farcasterClient.initialize()
    }

    // Initialize storage
    await this.storage.initialize()

    this.initialized = true
  }

  /**
   * Send a message - automatically routes based on recipient type
   */
  async sendMessage(
    recipient: Address | number,
    content: string,
    options?: {
      messageType?: 'wallet' | 'farcaster' | 'auto'
      metadata?: Record<string, unknown>
    },
  ): Promise<UnifiedMessage> {
    this.ensureInitialized()

    const messageType =
      options?.messageType ??
      (typeof recipient === 'number' ? 'farcaster' : 'wallet')

    if (messageType === 'farcaster' || typeof recipient === 'number') {
      if (!this.farcasterClient) {
        throw new Error('Farcaster client not configured')
      }
      return this.sendFarcasterMessage(recipient as number, content, options)
    }

    return this.sendWalletMessage(recipient as Address, content, options)
  }

  private async sendWalletMessage(
    recipient: Address,
    content: string,
    options?: { metadata?: Record<string, unknown> },
  ): Promise<UnifiedMessage> {
    const response = await this.messagingClient.sendMessage({
      to: recipient,
      content,
    })

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to send message')
    }

    const conversationId = this.getWalletConversationId(recipient)
    const timestamp = response.timestamp

    // Store the message metadata - actual encrypted content comes from the client
    const stored: StoredMessage = {
      id: response.messageId,
      conversationId,
      sender: this.address,
      recipient,
      encryptedContent: '', // Encrypted by client, stored separately
      ephemeralPublicKey: '',
      nonce: '',
      timestamp,
      chainId: this.chainId,
      messageType: 'dm',
      deliveryStatus: 'pending',
    }
    await this.storage.storeMessage(stored)

    return {
      id: stored.id,
      conversationId: stored.conversationId,
      sender: stored.sender,
      recipient: stored.recipient,
      content,
      timestamp: stored.timestamp,
      messageType: 'wallet',
      deliveryStatus: stored.deliveryStatus,
      metadata: options?.metadata,
    }
  }

  private async sendFarcasterMessage(
    recipientFid: number,
    content: string,
    options?: { metadata?: Record<string, unknown> },
  ): Promise<UnifiedMessage> {
    if (!this.farcasterClient || this.farcasterFid === undefined) {
      throw new Error('Farcaster client not configured')
    }

    const dc = await this.farcasterClient.send({
      recipientFid,
      text: content,
    })

    return {
      id: dc.id,
      conversationId: dc.conversationId,
      sender: this.farcasterFid,
      recipient: recipientFid,
      content: dc.text,
      timestamp: dc.timestamp,
      messageType: 'farcaster',
      deliveryStatus: dc.isRead ? 'read' : 'pending',
      metadata: options?.metadata,
    }
  }

  /**
   * Get conversations (merges wallet and Farcaster conversations)
   */
  async getConversations(options?: {
    limit?: number
  }): Promise<UnifiedConversation[]> {
    this.ensureInitialized()

    const conversations: Map<string, UnifiedConversation> = new Map()

    // Get wallet conversations
    const walletConvs = await this.storage.getUserConversations(
      this.address,
      options,
    )
    for (const conv of walletConvs) {
      conversations.set(conv.id, {
        id: conv.id,
        type: 'wallet',
        participants: conv.participants,
        unreadCount: conv.unreadCount,
        createdAt: conv.createdAt,
        updatedAt: conv.lastMessageAt,
      })
    }

    // Get Farcaster conversations
    if (this.farcasterClient) {
      const farcasterConvs = await this.farcasterClient.getConversations()
      for (const conv of farcasterConvs) {
        conversations.set(conv.id, {
          id: conv.id,
          type: 'farcaster',
          participants: conv.participants,
          unreadCount: conv.unreadCount,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        })
      }
    }

    return Array.from(conversations.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(
    conversationId: string,
    options?: { limit?: number; before?: number },
  ): Promise<UnifiedMessage[]> {
    this.ensureInitialized()

    // Check if it's a Farcaster conversation (format: "fid1-fid2")
    if (/^\d+-\d+$/.test(conversationId)) {
      if (!this.farcasterClient || this.farcasterFid === undefined) {
        return []
      }
      const fids = conversationId.split('-').map((f) => parseInt(f, 10))
      const otherFid = fids.find((f) => f !== this.farcasterFid) ?? fids[0] ?? 0
      const dcMessages = await this.farcasterClient.getMessages(otherFid, {
        limit: options?.limit,
        before: options?.before?.toString(),
      })
      return dcMessages.map((dc: DirectCast) => ({
        id: dc.id,
        conversationId: dc.conversationId,
        sender: dc.senderFid,
        recipient: dc.recipientFid,
        content: dc.text,
        timestamp: dc.timestamp,
        messageType: 'farcaster' as const,
        deliveryStatus: dc.isRead ? ('read' as const) : ('pending' as const),
      }))
    }

    // Wallet conversation
    const stored = await this.storage.getConversationMessages(
      conversationId,
      options,
    )

    // Decrypt messages using the messaging client's keys
    return stored.map((msg) => {
      let content: string
      try {
        content = this.messagingClient.decryptContent(
          msg.encryptedContent,
          msg.ephemeralPublicKey,
          msg.nonce,
        )
      } catch {
        // If decryption fails (e.g., message for different recipient), mark as unreadable
        content = '[unable to decrypt]'
      }

      return {
        id: msg.id,
        conversationId: msg.conversationId,
        sender: msg.sender,
        recipient: msg.recipient,
        content,
        timestamp: msg.timestamp,
        messageType: 'wallet' as const,
        deliveryStatus: msg.deliveryStatus,
      }
    })
  }

  private getWalletConversationId(recipient: Address): string {
    const addresses = [
      this.address.toLowerCase(),
      recipient.toLowerCase(),
    ].sort()
    return `wallet-${addresses[0]}-${addresses[1]}`
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('UnifiedMessagingService not initialized')
    }
  }
}

export function createUnifiedMessagingService(
  config: UnifiedMessagingConfig,
): UnifiedMessagingService {
  return new UnifiedMessagingService(config)
}
