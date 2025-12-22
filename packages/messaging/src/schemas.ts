/**
 * Zod schemas for validation in Network Messaging
 *
 * This file is the source of truth for all validatable types.
 * Runtime types that extend these are in ./sdk/types.ts
 */

import type { Hex } from 'viem'
import { z } from 'zod'

// ============ Common Schemas ============

// Limit hex string length to prevent ReDoS and memory exhaustion
// 1MB of hex = 2 million chars, which is more than sufficient for any message
const MAX_HEX_LENGTH = 2 * 1024 * 1024

export const HexStringSchema = z
  .string()
  .max(MAX_HEX_LENGTH, 'Hex string too long')
  .regex(/^[a-fA-F0-9]+$/, 'Invalid hex string')

// ============ Serialized Encrypted Message Schema ============

export const SerializedEncryptedMessageSchema = z.object({
  ciphertext: HexStringSchema,
  nonce: HexStringSchema,
  ephemeralPublicKey: HexStringSchema,
})

/** Serialized encrypted message for wire transfer */
export type SerializedEncryptedMessage = z.infer<
  typeof SerializedEncryptedMessageSchema
>

// ============ Message Envelope Schema ============

export const MessageEnvelopeSchema = z.object({
  id: z.string().uuid(),
  from: z.string().min(1, 'from address required'),
  to: z.string().min(1, 'to address required'),
  encryptedContent: SerializedEncryptedMessageSchema,
  timestamp: z.number().int().positive(),
  signature: z.string().optional(),
  cid: z.string().optional(),
})

/** Message envelope for wire transfer */
export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>

// ============ Node Config Schema ============

export const NodeConfigSchema = z.object({
  port: z.number().int().positive().max(65535),
  nodeId: z.string().min(1, 'nodeId is required'),
  ipfsUrl: z.string().url().optional(),
  maxMessageSize: z.number().int().positive().optional(),
  messageRetentionDays: z.number().int().positive().optional(),
})

/** Relay node configuration */
export type NodeConfig = z.infer<typeof NodeConfigSchema>

// ============ Client Config Schema (Validatable portion) ============

export const MessagingClientConfigBaseSchema = z.object({
  rpcUrl: z.string().url('rpcUrl must be a valid URL'),
  relayUrl: z.string().url().optional(),
  address: z.string().min(1, 'address is required'),
  nodeRegistryAddress: z.string().optional(),
  keyRegistryAddress: z.string().optional(),
  autoReconnect: z.boolean().optional(),
  preferredRegion: z.string().optional(),
})

/** Base client config (validatable portion) */
export type MessagingClientConfigBase = z.infer<
  typeof MessagingClientConfigBaseSchema
>

// ============ WebSocket Message Schemas ============

export const WebSocketSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  address: z.string().min(1, 'address is required'),
})

/** WebSocket subscription message */
export type WebSocketSubscribe = z.infer<typeof WebSocketSubscribeSchema>

// ============ Receipt Data Schemas ============

export const DeliveryReceiptDataSchema = z.object({
  messageId: z.string().uuid(),
})

/** Delivery receipt data */
export type DeliveryReceiptData = z.infer<typeof DeliveryReceiptDataSchema>

export const ReadReceiptDataSchema = z.object({
  messageId: z.string().uuid(),
  readAt: z.number().int().positive(),
})

/** Read receipt data */
export type ReadReceiptData = z.infer<typeof ReadReceiptDataSchema>

// ============ WebSocket Incoming Message Schemas (Client) ============

export const WebSocketIncomingMessageSchema = z.object({
  type: z.enum(['message', 'delivery_receipt', 'read_receipt']),
  data: z.union([
    MessageEnvelopeSchema,
    DeliveryReceiptDataSchema,
    ReadReceiptDataSchema,
  ]),
})

/** WebSocket incoming message from server */
export type WebSocketIncomingMessage = z.infer<
  typeof WebSocketIncomingMessageSchema
>

// ============ IPFS Response Schema ============

export const IPFSAddResponseSchema = z.object({
  Hash: z.string().min(1, 'IPFS hash required'),
})

/** IPFS add response */
export type IPFSAddResponse = z.infer<typeof IPFSAddResponseSchema>

// ============ Send Message Request Schema ============

export const SendMessageRequestSchema = z.object({
  to: z.string().min(1, 'to address is required'),
  content: z.string().min(1, 'content is required'),
  chatId: z.string().optional(),
  replyTo: z.string().optional(),
})

/** Send message request */
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>

// ============ Send Message Response Schema ============

export const SendMessageResponseSchema = z.object({
  success: z.boolean(),
  messageId: z.string(),
  timestamp: z.number(),
  nodeId: z.string().optional(),
  error: z.string().optional(),
})

/** Send message response */
export type SendMessageResponseValidated = z.infer<
  typeof SendMessageResponseSchema
>

// ============ Sync State Schema ============

export const SyncStateSchema = z.object({
  lastSyncedBlock: z.number().int().nonnegative(),
  lastSyncedAt: z.number().int().nonnegative(),
  pendingMessages: z.number().int().nonnegative(),
  isSyncing: z.boolean(),
})

/** Sync state for XMTP sync service */
export type SyncStateValidated = z.infer<typeof SyncStateSchema>

// ============ Sync Peer Schema ============

export const SyncPeerSchema = z.object({
  nodeId: z.string().min(1),
  url: z.string().url(),
  lastSyncedAt: z.number().int().nonnegative(),
  cursor: z.string(),
})

/** Sync peer for XMTP sync service */
export type SyncPeerValidated = z.infer<typeof SyncPeerSchema>

// ============ Sync Persistence Schema ============

export const SyncPersistenceSchema = z.object({
  state: SyncStateSchema,
  peers: z.array(SyncPeerSchema),
  timestamp: z.number().int().positive().optional(),
})

/** Persisted sync data */
export type SyncPersistenceData = z.infer<typeof SyncPersistenceSchema>

// ============ Sync Event Schema ============

export const SyncEventSchema = z.object({
  type: z.enum(['message', 'conversation', 'identity', 'group']),
  id: z.string().min(1),
  timestamp: z.number().int().positive(),
  data: z.record(z.unknown()), // XMTP envelope/conversation/message data
})

/** Sync event from peer */
export type SyncEventValidated = z.infer<typeof SyncEventSchema>

export const SyncEventsArraySchema = z.array(SyncEventSchema)

// ============ Relay Response Schemas ============

export const RelayHealthResponseSchema = z.object({
  status: z.string(),
  nodeId: z.string(),
  uptime: z.number().optional(),
  stats: z
    .object({
      messagesRelayed: z.number(),
      bytesRelayed: z.number(),
      activeSubscribers: z.number(),
      pendingMessages: z.number(),
    })
    .optional(),
  timestamp: z.number().optional(),
})

/** Health check response */
export type RelayHealthResponse = z.infer<typeof RelayHealthResponseSchema>

export const RelayStatsResponseSchema = z.object({
  nodeId: z.string(),
  totalMessagesRelayed: z.number(),
  totalBytesRelayed: z.number(),
  activeSubscribers: z.number(),
  pendingMessages: z.number(),
  uptime: z.number(),
})

/** Stats response */
export type RelayStatsResponse = z.infer<typeof RelayStatsResponseSchema>

export const RelayMessagesResponseSchema = z.object({
  address: z.string().optional(),
  messages: z.array(MessageEnvelopeSchema.extend({
    cid: z.string().optional(),
    receivedAt: z.number().optional(),
  })),
  count: z.number().int().nonnegative(),
})

/** Messages fetch response */
export type RelayMessagesResponse = z.infer<typeof RelayMessagesResponseSchema>

// ============ Encrypted Backup Schema (TEE) ============

/** Hex string schema that validates and transforms to Hex type */
const HexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/, 'must be a 0x-prefixed hex string')
  .transform((s): Hex => s as Hex)

export const EncryptedBackupSchema = z.object({
  ciphertext: HexSchema,
  metadata: z.object({
    keyId: z.string().min(1, 'keyId is required'),
    algorithm: z.string().min(1, 'algorithm is required'),
    kdfParams: z.object({
      salt: HexSchema,
      iterations: z.number().int().positive(),
    }),
  }),
  createdAt: z.number().int().positive(),
})

/** Encrypted backup for TEE key export */
export type EncryptedBackupValidated = z.infer<typeof EncryptedBackupSchema>
