/**
 * Type definitions for network Messaging SDK
 * 
 * Validatable types are imported from ../schemas.ts (source of truth).
 * Runtime-only types are defined here.
 */

// Import canonical types from schemas (these are the source of truth for wire formats)
export type {
  SerializedEncryptedMessage,
  MessageEnvelope,
  SendMessageRequest,
  DeliveryReceiptData,
  ReadReceiptData,
  WebSocketIncomingMessage,
  NodeConfig,
  MessagingClientConfigBase,
} from '../schemas';

import type { MessagingClientConfigBase } from '../schemas';

// ============ Core Types ============

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: number;
  status: MessageStatus;
  metadata?: MessageMetadata;
}

export type MessageStatus = 
  | 'pending'     // Not yet sent
  | 'sent'        // Sent to relay
  | 'delivered'   // Delivered to recipient
  | 'read'        // Read by recipient
  | 'failed';     // Delivery failed

export interface MessageMetadata {
  replyTo?: string;        // Reply to message ID
  attachments?: Attachment[];
  reactions?: Reaction[];
}

export interface Attachment {
  cid: string;             // IPFS CID of attachment
  name: string;
  mimeType: string;
  size: number;
}

export interface Reaction {
  userId: string;
  emoji: string;
  timestamp: number;
}

// ============ Chat Types ============

export interface Chat {
  id: string;
  type: ChatType;
  participants: string[];
  createdAt: number;
  updatedAt: number;
  lastMessage?: Message;
  metadata?: ChatMetadata;
}

export type ChatType = 'dm' | 'group';

export interface ChatMetadata {
  name?: string;           // Group name
  description?: string;
  avatar?: string;         // IPFS CID
  admins?: string[];
}

// ============ User Types ============

export interface User {
  address: string;
  publicKey?: string;      // Hex-encoded X25519 public key
  displayName?: string;
  avatar?: string;
  lastSeen?: number;
}

// ============ Node Types ============

export interface RelayNode {
  nodeId: string;
  endpoint: string;
  region: string;
  isHealthy: boolean;
  latency?: number;
}

export interface NodeInfo {
  nodeId: string;
  operator: string;
  endpoint: string;
  region: string;
  stakedAmount: bigint;
  messagesRelayed: number;
  isActive: boolean;
  performance: NodePerformance;
}

export interface NodePerformance {
  uptimeScore: number;     // 0-10000 (100.00%)
  deliveryRate: number;    // 0-10000
  avgLatencyMs: number;
}

// ============ Envelope Types ============

// MessageEnvelope is imported from schemas.ts (canonical definition)

export interface DeliveryReceipt {
  messageId: string;
  nodeId: string;
  deliveredAt: number;
  signature: string;
}

// ============ API Types ============

// SendMessageRequest is imported from schemas.ts (canonical definition)

export interface SendMessageResponse {
  success: boolean;
  messageId: string;
  timestamp: number;
  nodeId?: string;
  error?: string;
}

export interface GetMessagesRequest {
  chatId: string;
  limit?: number;
  before?: number;         // Timestamp
  after?: number;          // Timestamp
}

export interface GetMessagesResponse {
  messages: Message[];
  hasMore: boolean;
  cursor?: string;
}

// ============ Event Types ============

export type MessageEvent = 
  | { type: 'message:new'; data: Message }
  | { type: 'message:delivered'; data: DeliveryReceipt }
  | { type: 'message:read'; data: { messageId: string; readAt: number } }
  | { type: 'chat:updated'; data: Chat }
  | { type: 'user:online'; data: { userId: string } }
  | { type: 'user:offline'; data: { userId: string } }
  | { type: 'error'; data: { code: string; message: string } };

export type MessageEventHandler = (event: MessageEvent) => void;

// ============ Client Config ============

/**
 * Full client configuration.
 * Extends the validatable base with runtime-only properties.
 */
export interface MessagingClientConfig extends MessagingClientConfigBase {
  /** Signer function for transactions */
  signer?: (message: string) => Promise<string>;
  
  /** Pre-derived messaging key pair */
  keyPair?: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
}

// ============ Contract Addresses ============

export interface ContractAddresses {
  nodeRegistry: string;
  keyRegistry: string;
  messageLedger?: string;
  stakingToken?: string;
}

// ============ Contract Response Types ============

/** Response from KeyRegistry.getKeyBundle() */
export interface KeyBundleResponse {
  identityKey: `0x${string}`;
  signedPreKey: `0x${string}`;
  preKeySignature: `0x${string}`;
  preKeyTimestamp: bigint;
  registeredAt: bigint;
  lastUpdated: bigint;
  isActive: boolean;
}

/** Response from MessageNodeRegistry.getNode() */
export interface NodeRegistryResponse {
  nodeId: `0x${string}`;
  operator: `0x${string}`;
  endpoint: string;
  region: string;
  stakedAmount: bigint;
  registeredAt: bigint;
  lastHeartbeat: bigint;
  messagesRelayed: bigint;
  feesEarned: bigint;
  isActive: boolean;
  isSlashed: boolean;
}

// WebSocketIncomingMessage, DeliveryReceiptData, ReadReceiptData 
// are imported from schemas.ts (canonical definitions)

// ============ Error Types ============

export interface MessagingErrorDetails {
  messageId?: string;
  address?: string;
  nodeId?: string;
  timestamp?: number;
  originalError?: string;
}

export class MessagingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: MessagingErrorDetails
  ) {
    super(message);
    this.name = 'MessagingError';
  }
}

export const ErrorCodes = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  NO_KEY_BUNDLE: 'NO_KEY_BUNDLE',
  RECIPIENT_NO_KEY: 'RECIPIENT_NO_KEY',
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

