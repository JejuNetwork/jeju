/**
 * Zod schemas for validation in Network Messaging
 * 
 * This file is the source of truth for all validatable types.
 * Runtime types that extend these are in ./sdk/types.ts
 */

import { z } from 'zod';

// ============ Common Schemas ============

export const HexStringSchema = z.string().regex(/^[a-fA-F0-9]+$/, 'Invalid hex string');

// ============ Serialized Encrypted Message Schema ============

export const SerializedEncryptedMessageSchema = z.object({
  ciphertext: HexStringSchema,
  nonce: HexStringSchema,
  ephemeralPublicKey: HexStringSchema,
});

/** Serialized encrypted message for wire transfer */
export type SerializedEncryptedMessage = z.infer<typeof SerializedEncryptedMessageSchema>;

// ============ Message Envelope Schema ============

export const MessageEnvelopeSchema = z.object({
  id: z.string().uuid(),
  from: z.string().min(1, 'from address required'),
  to: z.string().min(1, 'to address required'),
  encryptedContent: SerializedEncryptedMessageSchema,
  timestamp: z.number().int().positive(),
  signature: z.string().optional(),
  cid: z.string().optional(),
});

/** Message envelope for wire transfer */
export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;

// ============ Node Config Schema ============

export const NodeConfigSchema = z.object({
  port: z.number().int().positive().max(65535),
  nodeId: z.string().min(1, 'nodeId is required'),
  ipfsUrl: z.string().url().optional(),
  maxMessageSize: z.number().int().positive().optional(),
  messageRetentionDays: z.number().int().positive().optional(),
});

/** Relay node configuration */
export type NodeConfig = z.infer<typeof NodeConfigSchema>;

// ============ Client Config Schema (Validatable portion) ============

export const MessagingClientConfigBaseSchema = z.object({
  rpcUrl: z.string().url('rpcUrl must be a valid URL'),
  relayUrl: z.string().url().optional(),
  address: z.string().min(1, 'address is required'),
  nodeRegistryAddress: z.string().optional(),
  keyRegistryAddress: z.string().optional(),
  autoReconnect: z.boolean().optional(),
  preferredRegion: z.string().optional(),
});

/** Base client config (validatable portion) */
export type MessagingClientConfigBase = z.infer<typeof MessagingClientConfigBaseSchema>;

// ============ WebSocket Message Schemas ============

export const WebSocketSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  address: z.string().min(1, 'address is required'),
});

/** WebSocket subscription message */
export type WebSocketSubscribe = z.infer<typeof WebSocketSubscribeSchema>;

// ============ Receipt Data Schemas ============

export const DeliveryReceiptDataSchema = z.object({
  messageId: z.string().uuid(),
});

/** Delivery receipt data */
export type DeliveryReceiptData = z.infer<typeof DeliveryReceiptDataSchema>;

export const ReadReceiptDataSchema = z.object({
  messageId: z.string().uuid(),
  readAt: z.number().int().positive(),
});

/** Read receipt data */
export type ReadReceiptData = z.infer<typeof ReadReceiptDataSchema>;

// ============ WebSocket Incoming Message Schemas (Client) ============

export const WebSocketIncomingMessageSchema = z.object({
  type: z.enum(['message', 'delivery_receipt', 'read_receipt']),
  data: z.union([MessageEnvelopeSchema, DeliveryReceiptDataSchema, ReadReceiptDataSchema]),
});

/** WebSocket incoming message from server */
export type WebSocketIncomingMessage = z.infer<typeof WebSocketIncomingMessageSchema>;

// ============ IPFS Response Schema ============

export const IPFSAddResponseSchema = z.object({
  Hash: z.string().min(1, 'IPFS hash required'),
});

/** IPFS add response */
export type IPFSAddResponse = z.infer<typeof IPFSAddResponseSchema>;

// ============ Send Message Request Schema ============

export const SendMessageRequestSchema = z.object({
  to: z.string().min(1, 'to address is required'),
  content: z.string().min(1, 'content is required'),
  chatId: z.string().optional(),
  replyTo: z.string().optional(),
});

/** Send message request */
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

