/**
 * EQLite Storage Adapter for Messaging
 *
 * Provides persistent storage for encrypted messages, conversations, and key bundles
 * using EQLite (EQLite) decentralized database.
 */

import {
  getEQLiteUrl,
  getEqliteDatabaseId,
  getEqliteKeyId,
} from '@jejunetwork/config'
import {
  type EQLiteClient,
  type EQLiteConfig,
  getEQLite,
  type QueryParam,
} from '@jejunetwork/db'
import type { Address } from 'viem'
import { z } from 'zod'

export type { EQLiteConfig }

// ============================================================================
// Database Row Schemas for Type-Safe Mapping
// ============================================================================

const MessageRowSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  sender: z.string(),
  recipient: z.string(),
  encrypted_content: z.string(),
  content_cid: z.string().nullable().optional(),
  ephemeral_public_key: z.string(),
  nonce: z.string(),
  timestamp: z.number(),
  chain_id: z.number(),
  message_type: z.enum(['dm', 'group', 'channel']),
  delivery_status: z.enum(['pending', 'delivered', 'read']),
  signature: z.string().nullable().optional(),
})

const ConversationRowSchema = z.object({
  id: z.string(),
  type: z.enum(['dm', 'group', 'channel']),
  participants: z.string(), // JSON string
  created_at: z.number(),
  last_message_at: z.number(),
  last_message_preview: z.string().nullable().optional(),
  metadata: z.string().nullable().optional(), // JSON string
})

const KeyBundleRowSchema = z.object({
  address: z.string(),
  identity_key: z.string(),
  signed_pre_key: z.string(),
  pre_key_signature: z.string(),
  one_time_pre_keys: z.string(), // JSON string
  registered_at: z.number(),
  updated_at: z.number(),
  chain_id: z.number(),
})

const ParticipantsArraySchema = z.array(z.string())
const OneTimePreKeysSchema = z.array(z.string())

export type ConsistencyLevel = 'strong' | 'eventual'

export interface StoredMessage {
  id: string
  conversationId: string
  sender: Address
  recipient: Address
  encryptedContent: string
  contentCid?: string | null
  ephemeralPublicKey: string
  nonce: string
  timestamp: number
  chainId: number
  messageType: 'dm' | 'group' | 'channel'
  deliveryStatus: 'pending' | 'delivered' | 'read'
  signature?: string | null
}

export interface StoredConversation {
  id: string
  type: 'dm' | 'group' | 'channel'
  participants: Address[]
  createdAt: number
  lastMessageAt: number
  lastMessagePreview?: string
  unreadCount: number
  metadata?: Record<string, unknown>
}

export interface StoredKeyBundle {
  address: Address
  identityKey: string
  signedPreKey: string
  preKeySignature: string
  oneTimePreKeys: string[]
  registeredAt: number
  updatedAt: number
  chainId: number
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => typeof k === 'string')
  )
}

class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}

export class EQLiteMessageStorage {
  private client: EQLiteClient | null = null
  private initialized = false

  async initialize(config?: EQLiteConfig): Promise<void> {
    if (this.initialized) return

    const keyId = config?.keyId ?? getEqliteKeyId()
    if (!keyId) {
      throw new Error('EQLite keyId is required for MessageStorage')
    }
    this.client = getEQLite({
      blockProducerEndpoint: config?.blockProducerEndpoint ?? getEQLiteUrl(),
      databaseId: config?.databaseId ?? getEqliteDatabaseId() ?? 'messaging',
      keyId,
    })

    const healthy = await this.client.isHealthy()
    if (!healthy) {
      throw new ServiceUnavailableError('EQLite not healthy for MessageStorage')
    }

    await this.createTables()
    this.initialized = true
  }

  private async createTables(): Promise<void> {
    const tables = [
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        encrypted_content TEXT NOT NULL,
        content_cid TEXT,
        ephemeral_public_key TEXT NOT NULL,
        nonce TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        chain_id INTEGER NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'dm',
        delivery_status TEXT NOT NULL DEFAULT 'pending',
        signature TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'dm',
        participants TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_message_at INTEGER NOT NULL,
        last_message_preview TEXT,
        metadata TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS key_bundles (
        address TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL,
        signed_pre_key TEXT NOT NULL,
        pre_key_signature TEXT NOT NULL,
        one_time_pre_keys TEXT NOT NULL,
        registered_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        chain_id INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient, delivery_status, timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_participant ON conversations (participants, last_message_at DESC)`,
    ]

    for (const sql of tables) {
      await this.client?.exec(sql)
    }
  }

  async storeMessage(message: StoredMessage): Promise<void> {
    await this.ensureInitialized()
    await this.client?.exec(
      `INSERT INTO messages (id, conversation_id, sender, recipient, encrypted_content, content_cid, ephemeral_public_key, nonce, timestamp, chain_id, message_type, delivery_status, signature) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        message.id,
        message.conversationId,
        message.sender,
        message.recipient,
        message.encryptedContent,
        message.contentCid ?? null,
        message.ephemeralPublicKey,
        message.nonce,
        message.timestamp,
        message.chainId,
        message.messageType,
        message.deliveryStatus,
        message.signature ?? null,
      ],
    )
  }

  async getConversationMessages(
    conversationId: string,
    options: { limit?: number; before?: number } = {},
  ): Promise<StoredMessage[]> {
    await this.ensureInitialized()
    const limit = options.limit ?? 50
    const params: QueryParam[] = options.before
      ? [conversationId, options.before, limit]
      : [conversationId, limit]
    const sql = options.before
      ? `SELECT * FROM messages WHERE conversation_id = $1 AND timestamp < $2 ORDER BY timestamp DESC LIMIT $3`
      : `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT $2`
    const result = await this.client?.query<Record<string, unknown>>(
      sql,
      params,
    )
    return result?.rows.map(this.mapMessageRow) ?? []
  }

  async getPendingMessages(
    recipient: Address,
    options: { limit?: number } = {},
  ): Promise<StoredMessage[]> {
    await this.ensureInitialized()
    const result = await this.client?.query<Record<string, unknown>>(
      `SELECT * FROM messages WHERE recipient = $1 AND delivery_status = 'pending' ORDER BY timestamp ASC LIMIT $2`,
      [recipient, options.limit ?? 100],
    )
    return result?.rows.map(this.mapMessageRow) ?? []
  }

  async updateDeliveryStatus(
    messageId: string,
    status: 'delivered' | 'read',
  ): Promise<void> {
    await this.ensureInitialized()
    await this.client?.exec(
      `UPDATE messages SET delivery_status = $1 WHERE id = $2`,
      [status, messageId],
    )
  }

  async createConversation(
    conversation: Omit<StoredConversation, 'unreadCount'>,
  ): Promise<void> {
    await this.ensureInitialized()
    await this.client?.exec(
      `INSERT INTO conversations (id, type, participants, created_at, last_message_at, last_message_preview, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        conversation.id,
        conversation.type,
        JSON.stringify(conversation.participants),
        conversation.createdAt,
        conversation.lastMessageAt,
        conversation.lastMessagePreview ?? null,
        conversation.metadata ? JSON.stringify(conversation.metadata) : null,
      ],
    )
  }

  async getConversation(id: string): Promise<StoredConversation | null> {
    await this.ensureInitialized()
    const result = await this.client?.query<Record<string, unknown>>(
      `SELECT * FROM conversations WHERE id = $1`,
      [id],
    )
    const row = result?.rows[0]
    return row ? this.mapConversationRow(row) : null
  }

  async getUserConversations(
    address: Address,
    options: { limit?: number } = {},
  ): Promise<StoredConversation[]> {
    await this.ensureInitialized()
    const result = await this.client?.query<Record<string, unknown>>(
      `SELECT * FROM conversations WHERE participants LIKE $1 ORDER BY last_message_at DESC LIMIT $2`,
      [`%${address.toLowerCase()}%`, options.limit ?? 50],
    )
    return result?.rows.map(this.mapConversationRow) ?? []
  }

  async updateConversation(
    id: string,
    update: { lastMessageAt: number; lastMessagePreview?: string },
  ): Promise<void> {
    await this.ensureInitialized()
    await this.client?.exec(
      `UPDATE conversations SET last_message_at = $1, last_message_preview = $2 WHERE id = $3`,
      [update.lastMessageAt, update.lastMessagePreview ?? null, id],
    )
  }

  async storeKeyBundle(bundle: StoredKeyBundle): Promise<void> {
    await this.ensureInitialized()
    await this.client?.exec(
      `INSERT INTO key_bundles (address, identity_key, signed_pre_key, pre_key_signature, one_time_pre_keys, registered_at, updated_at, chain_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (address) DO UPDATE SET identity_key = $2, signed_pre_key = $3, pre_key_signature = $4, one_time_pre_keys = $5, updated_at = $7`,
      [
        bundle.address,
        bundle.identityKey,
        bundle.signedPreKey,
        bundle.preKeySignature,
        JSON.stringify(bundle.oneTimePreKeys),
        bundle.registeredAt,
        bundle.updatedAt,
        bundle.chainId,
      ],
    )
  }

  async getKeyBundle(address: Address): Promise<StoredKeyBundle | null> {
    await this.ensureInitialized()
    const result = await this.client?.query<Record<string, unknown>>(
      `SELECT * FROM key_bundles WHERE address = $1`,
      [address],
    )
    const row = result?.rows[0]
    return row ? this.mapKeyBundleRow(row) : null
  }

  async consumeOneTimePreKey(address: Address): Promise<string | null> {
    await this.ensureInitialized()
    const bundle = await this.getKeyBundle(address)
    if (!bundle || bundle.oneTimePreKeys.length === 0) return null

    const [key, ...remaining] = bundle.oneTimePreKeys
    if (!key) return null

    await this.client?.exec(
      `UPDATE key_bundles SET one_time_pre_keys = $1, updated_at = $2 WHERE address = $3`,
      [JSON.stringify(remaining), Date.now(), address],
    )
    return key
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.ensureInitialized()
    await this.client?.exec(`DELETE FROM messages WHERE id = $1`, [messageId])
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.ensureInitialized()
    await this.client?.exec(`DELETE FROM messages WHERE conversation_id = $1`, [
      conversationId,
    ])
    await this.client?.exec(`DELETE FROM conversations WHERE id = $1`, [
      conversationId,
    ])
  }

  async getMessageCount(conversationId: string): Promise<number> {
    await this.ensureInitialized()
    const result = await this.client?.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1`,
      [conversationId],
    )
    return result?.rows[0]?.count ?? 0
  }

  async getUnreadCount(address: Address): Promise<number> {
    await this.ensureInitialized()
    const result = await this.client?.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM messages WHERE recipient = $1 AND delivery_status = 'pending'`,
      [address],
    )
    return result?.rows[0]?.count ?? 0
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize()
  }

  private mapMessageRow(row: Record<string, unknown>): StoredMessage {
    const parsed = MessageRowSchema.parse(row)
    return {
      id: parsed.id,
      conversationId: parsed.conversation_id,
      sender: parsed.sender as Address,
      recipient: parsed.recipient as Address,
      encryptedContent: parsed.encrypted_content,
      contentCid: parsed.content_cid ?? undefined,
      ephemeralPublicKey: parsed.ephemeral_public_key,
      nonce: parsed.nonce,
      timestamp: parsed.timestamp,
      chainId: parsed.chain_id,
      messageType: parsed.message_type,
      deliveryStatus: parsed.delivery_status,
      signature: parsed.signature ?? undefined,
    }
  }

  private mapConversationRow(row: Record<string, unknown>): StoredConversation {
    const parsed = ConversationRowSchema.parse(row)
    const participants = ParticipantsArraySchema.parse(
      JSON.parse(parsed.participants),
    )
    return {
      id: parsed.id,
      type: parsed.type,
      participants: participants as Address[],
      createdAt: parsed.created_at,
      lastMessageAt: parsed.last_message_at,
      lastMessagePreview: parsed.last_message_preview ?? undefined,
      unreadCount: 0,
      metadata: parsed.metadata
        ? (() => {
            const parsedMetadata = JSON.parse(parsed.metadata)
            return isJsonRecord(parsedMetadata) ? parsedMetadata : undefined
          })()
        : undefined,
    }
  }

  private mapKeyBundleRow(row: Record<string, unknown>): StoredKeyBundle {
    const parsed = KeyBundleRowSchema.parse(row)
    const oneTimePreKeys = OneTimePreKeysSchema.parse(
      JSON.parse(parsed.one_time_pre_keys),
    )
    return {
      address: parsed.address as Address,
      identityKey: parsed.identity_key,
      signedPreKey: parsed.signed_pre_key,
      preKeySignature: parsed.pre_key_signature,
      oneTimePreKeys,
      registeredAt: parsed.registered_at,
      updatedAt: parsed.updated_at,
      chainId: parsed.chain_id,
    }
  }
}

let storage: EQLiteMessageStorage | null = null

export function createEQLiteStorage(
  _config?: EQLiteConfig,
): EQLiteMessageStorage {
  // Config parameter reserved for future EQLite connection customization
  return new EQLiteMessageStorage()
}

export function getEQLiteStorage(): EQLiteMessageStorage {
  if (!storage) storage = new EQLiteMessageStorage()
  return storage
}

export function resetEQLiteStorage(): void {
  storage = null
}
