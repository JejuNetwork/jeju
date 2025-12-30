/**
 * SQLit Storage for Messaging
 *
 * Provides decentralized message storage backed by SQLit.
 */

import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import type { Address } from 'viem'

export interface SQLitConfig {
  databaseId?: string
  endpoint?: string
}

export interface StoredMessage {
  id: string
  conversationId: string
  sender: Address
  recipient: Address
  encryptedContent: string
  contentCid: string | null
  ephemeralPublicKey: string
  nonce: string
  timestamp: number
  chainId: number
  messageType: string
  deliveryStatus: 'pending' | 'delivered' | 'read'
  signature: string | null
  metadata?: Record<string, unknown>
}

export interface StoredConversation {
  id: string
  participants: Address[]
  lastMessageId?: string
  lastMessageTimestamp?: number
  unreadCount: number
  createdAt: number
  updatedAt: number
}

export interface StoredKeyBundle {
  address: Address
  identityKey: string
  preKey: string
  signedPreKey: string
  signature: string
  timestamp: number
}

/**
 * SQLit-backed message storage
 */
export class SQLitMessageStorage {
  private client: SQLitClient
  private databaseId: string
  private initialized = false

  constructor(config?: SQLitConfig) {
    this.client = getSQLit()
    this.databaseId = config?.databaseId ?? 'messaging'
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create tables if they don't exist
    await this.client.exec(
      `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        encrypted_content TEXT NOT NULL,
        content_cid TEXT,
        ephemeral_public_key TEXT NOT NULL,
        nonce TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        chain_id INTEGER DEFAULT 1,
        message_type TEXT DEFAULT 'dm',
        delivery_status TEXT DEFAULT 'pending',
        signature TEXT,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `,
      [],
      this.databaseId,
    )

    await this.client.exec(
      `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        participants TEXT NOT NULL,
        last_message_id TEXT,
        last_message_timestamp INTEGER,
        unread_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `,
      [],
      this.databaseId,
    )

    await this.client.exec(
      `
      CREATE TABLE IF NOT EXISTS key_bundles (
        address TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL,
        pre_key TEXT NOT NULL,
        signed_pre_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `,
      [],
      this.databaseId,
    )

    // Create indexes
    await this.client.exec(
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`,
      [],
      this.databaseId,
    )
    await this.client.exec(
      `CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient, status)`,
      [],
      this.databaseId,
    )

    this.initialized = true
  }

  async storeMessage(message: StoredMessage): Promise<void> {
    await this.client.exec(
      `
      INSERT INTO messages (id, conversation_id, sender, recipient, encrypted_content, content_cid, ephemeral_public_key, nonce, timestamp, chain_id, message_type, delivery_status, signature, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        message.id,
        message.conversationId,
        message.sender,
        message.recipient,
        message.encryptedContent,
        message.contentCid,
        message.ephemeralPublicKey,
        message.nonce,
        message.timestamp,
        message.chainId,
        message.messageType,
        message.deliveryStatus,
        message.signature,
        message.metadata ? JSON.stringify(message.metadata) : null,
      ],
      this.databaseId,
    )
  }

  async getMessage(id: string): Promise<StoredMessage | null> {
    const result = await this.client.query<{
      id: string
      conversation_id: string
      sender: string
      recipient: string
      encrypted_content: string
      content_cid: string | null
      ephemeral_public_key: string
      nonce: string
      timestamp: number
      chain_id: number
      message_type: string
      delivery_status: string
      signature: string | null
      metadata: string | null
    }>(`SELECT * FROM messages WHERE id = ?`, [id], this.databaseId)

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: row.id,
      conversationId: row.conversation_id,
      sender: row.sender as Address,
      recipient: row.recipient as Address,
      encryptedContent: row.encrypted_content,
      contentCid: row.content_cid,
      ephemeralPublicKey: row.ephemeral_public_key,
      nonce: row.nonce,
      timestamp: row.timestamp,
      chainId: row.chain_id,
      messageType: row.message_type,
      deliveryStatus: row.delivery_status as StoredMessage['deliveryStatus'],
      signature: row.signature,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }
  }

  async getPendingMessages(recipient: Address): Promise<StoredMessage[]> {
    const result = await this.client.query<{
      id: string
      conversation_id: string
      sender: string
      recipient: string
      encrypted_content: string
      content_cid: string | null
      ephemeral_public_key: string
      nonce: string
      timestamp: number
      chain_id: number
      message_type: string
      delivery_status: string
      signature: string | null
      metadata: string | null
    }>(
      `SELECT * FROM messages WHERE recipient = ? AND delivery_status = 'pending' ORDER BY timestamp ASC`,
      [recipient.toLowerCase()],
      this.databaseId,
    )

    return result.rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      sender: row.sender as Address,
      recipient: row.recipient as Address,
      encryptedContent: row.encrypted_content,
      contentCid: row.content_cid,
      ephemeralPublicKey: row.ephemeral_public_key,
      nonce: row.nonce,
      timestamp: row.timestamp,
      chainId: row.chain_id,
      messageType: row.message_type,
      deliveryStatus: row.delivery_status as StoredMessage['deliveryStatus'],
      signature: row.signature,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }))
  }

  async updateDeliveryStatus(
    id: string,
    status: StoredMessage['deliveryStatus'],
  ): Promise<void> {
    await this.client.exec(
      `UPDATE messages SET delivery_status = ? WHERE id = ?`,
      [status, id],
      this.databaseId,
    )
  }

  async storeKeyBundle(bundle: StoredKeyBundle): Promise<void> {
    await this.client.exec(
      `
      INSERT OR REPLACE INTO key_bundles (address, identity_key, pre_key, signed_pre_key, signature, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [
        bundle.address.toLowerCase(),
        bundle.identityKey,
        bundle.preKey,
        bundle.signedPreKey,
        bundle.signature,
        bundle.timestamp,
      ],
      this.databaseId,
    )
  }

  async getKeyBundle(address: Address): Promise<StoredKeyBundle | null> {
    const result = await this.client.query<{
      address: string
      identity_key: string
      pre_key: string
      signed_pre_key: string
      signature: string
      timestamp: number
    }>(
      `SELECT * FROM key_bundles WHERE address = ?`,
      [address.toLowerCase()],
      this.databaseId,
    )

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      address: row.address as Address,
      identityKey: row.identity_key,
      preKey: row.pre_key,
      signedPreKey: row.signed_pre_key,
      signature: row.signature,
      timestamp: row.timestamp,
    }
  }

  async close(): Promise<void> {
    // SQLit client handles connection pooling
    this.initialized = false
  }
}

// Singleton instance
let storageInstance: SQLitMessageStorage | null = null

export function createSQLitStorage(config?: SQLitConfig): SQLitMessageStorage {
  if (!storageInstance) {
    storageInstance = new SQLitMessageStorage(config)
  }
  return storageInstance
}

export function getSQLitStorage(): SQLitMessageStorage | null {
  return storageInstance
}

export function resetSQLitStorage(): void {
  storageInstance = null
}

export type ConsistencyLevel = 'strong' | 'eventual'
