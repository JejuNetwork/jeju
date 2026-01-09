/**
 * Unified Farcaster-Messaging Integration
 *
 * Combines real XMTP SDK with Farcaster Direct Casts to provide
 * a unified messaging experience that works with both wallet addresses
 * and Farcaster FIDs.
 *
 * Features:
 * - Wallet-to-wallet messaging via real XMTP SDK
 * - FID-to-FID messaging via Farcaster Direct Casts
 * - Unified conversation view
 * - SQLit storage for persistence
 * - Automatic routing based on recipient type
 */

import { createKMSSigner, type KMSSigner } from '@jejunetwork/kms'
import { sha256 } from '@noble/hashes/sha256'
import {
  type Identifier,
  Client as XMTPClient,
  type Signer as XMTPSigner,
} from '@xmtp/browser-sdk'
import type { Address } from 'viem'
import { toBytes } from 'viem'
import type { DCClientConfig, DirectCast, DirectCastClient } from './farcaster'
import {
  createSQLitStorage,
  type SQLitConfig,
  type SQLitMessageStorage,
  type StoredMessage,
} from './storage/sqlit-storage'

export interface UnifiedMessagingConfig {
  /** User's wallet address */
  address: Address
  /** XMTP environment */
  xmtpEnv?: 'local' | 'dev' | 'production'
  /** XMTP DB path */
  xmtpDbPath?: string
  /** Farcaster Direct Cast client config */
  farcaster?: DCClientConfig
  /** SQLit storage config */
  storage?: SQLitConfig
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

/**
 * Create XMTP signer from KMS
 */
function createXMTPKMSSigner(
  kmsSigner: KMSSigner,
  address: Address,
): XMTPSigner {
  return {
    type: 'EOA',
    getIdentifier: (): Identifier => ({
      identifier: address.toLowerCase(),
      identifierKind: 'Ethereum',
    }),
    signMessage: async (message: string): Promise<Uint8Array> => {
      const result = await kmsSigner.signMessage(message)
      return toBytes(result.signature)
    },
  }
}

/**
 * Get DB encryption key from KMS
 */
async function getDbEncryptionKey(kmsSigner: KMSSigner): Promise<Uint8Array> {
  const result = await kmsSigner.signMessage('XMTP_DB_ENCRYPTION_KEY_V1')
  return sha256(toBytes(result.signature))
}

/** Default chain ID for Jeju network */
const DEFAULT_CHAIN_ID = 420690

export class UnifiedMessagingService {
  private xmtpClient: XMTPClient | null = null
  private kmsSigner: KMSSigner | null = null
  private farcasterClient?: DirectCastClient
  private farcasterConfig?: DCClientConfig
  private storage: SQLitMessageStorage
  private initialized = false
  private address: Address
  private xmtpEnv: 'local' | 'dev' | 'production'
  private xmtpDbPath?: string
  private farcasterFid?: number
  private chainId: number

  constructor(config: UnifiedMessagingConfig) {
    this.address = config.address
    this.xmtpEnv = config.xmtpEnv ?? 'dev'
    this.xmtpDbPath = config.xmtpDbPath
    this.chainId = DEFAULT_CHAIN_ID

    if (config.farcaster) {
      this.farcasterConfig = config.farcaster
      this.farcasterFid = config.farcaster.fid
    }
    this.storage = createSQLitStorage(config.storage)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Initialize KMS signer
    this.kmsSigner = createKMSSigner({
      serviceId: `xmtp-unified-${this.address.toLowerCase()}`,
      allowLocalDev: true,
    })
    await this.kmsSigner.initialize()

    // Create XMTP client with KMS signer
    const xmtpSigner = createXMTPKMSSigner(this.kmsSigner, this.address)
    const dbEncryptionKey = await getDbEncryptionKey(this.kmsSigner)

    this.xmtpClient = await XMTPClient.create(xmtpSigner, {
      env: this.xmtpEnv,
      dbPath:
        this.xmtpDbPath ?? `./data/xmtp/${this.address.toLowerCase()}.db3`,
      dbEncryptionKey,
    })

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
    if (!this.xmtpClient) {
      throw new Error('XMTP client not initialized')
    }

    // Create or find DM with recipient
    const dm = await this.xmtpClient.conversations.newDmWithIdentifier({
      identifier: recipient.toLowerCase(),
      identifierKind: 'Ethereum',
    })

    // Send the message via XMTP
    const messageId = await dm.send(content)
    const timestamp = Date.now()
    const conversationId = this.getWalletConversationId(recipient)

    // Store the message metadata
    const stored: StoredMessage = {
      id: messageId,
      conversationId,
      sender: this.address,
      recipient,
      encryptedContent: '', // XMTP handles encryption
      contentCid: null,
      ephemeralPublicKey: '',
      nonce: '',
      timestamp,
      chainId: this.chainId,
      messageType: 'dm',
      deliveryStatus: 'pending',
      signature: null,
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
  async getConversations(_options?: {
    limit?: number
  }): Promise<UnifiedConversation[]> {
    this.ensureInitialized()

    const conversations: Map<string, UnifiedConversation> = new Map()

    // Get XMTP conversations
    if (this.xmtpClient) {
      await this.xmtpClient.conversations.sync()
      const dms = await this.xmtpClient.conversations.listDms()

      for (const dm of dms) {
        const peerInboxId = await dm.peerInboxId()
        const createdAtMs = dm.createdAt?.getTime() ?? Date.now()
        conversations.set(`xmtp-${dm.id}`, {
          id: `xmtp-${dm.id}`,
          type: 'wallet',
          participants: [this.address, peerInboxId as unknown as Address],
          unreadCount: 0,
          createdAt: createdAtMs,
          updatedAt: createdAtMs,
        })
      }
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

    // XMTP conversation (format: "xmtp-<id>")
    if (conversationId.startsWith('xmtp-') && this.xmtpClient) {
      const xmtpConvId = conversationId.slice(5)
      const conversation =
        await this.xmtpClient.conversations.getConversationById(xmtpConvId)
      if (!conversation) return []

      await conversation.sync()
      const messages = await conversation.messages({
        limit: BigInt(options?.limit ?? 50),
      })

      return messages.map((msg) => ({
        id: msg.id,
        conversationId,
        sender: msg.senderInboxId as unknown as Address,
        recipient: this.address,
        content: String(msg.content),
        timestamp: Number(msg.sentAtNs / BigInt(1_000_000)), // Convert ns to ms
        messageType: 'wallet' as const,
        deliveryStatus: 'delivered' as const,
      }))
    }

    return []
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

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.xmtpClient = null
    this.kmsSigner = null
    this.initialized = false
  }
}

export function createUnifiedMessagingService(
  config: UnifiedMessagingConfig,
): UnifiedMessagingService {
  return new UnifiedMessagingService(config)
}
