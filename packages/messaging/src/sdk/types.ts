/**
 * Type definitions for Jeju Messaging SDK
 */

import type { SerializedEncryptedMessage } from './crypto';

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

export interface MessageEnvelope {
  id: string;
  from: string;
  to: string;
  encryptedContent: SerializedEncryptedMessage;
  timestamp: number;
  signature?: string;
  cid?: string;            // IPFS CID if stored
}

export interface DeliveryReceipt {
  messageId: string;
  nodeId: string;
  deliveredAt: number;
  signature: string;
}

// ============ API Types ============

export interface SendMessageRequest {
  to: string;
  content: string;
  chatId?: string;
  replyTo?: string;
}

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

export interface MessagingClientConfig {
  /** Jeju RPC URL */
  rpcUrl: string;
  
  /** Relay node URL (optional, will discover from chain) */
  relayUrl?: string;
  
  /** User's Ethereum address */
  address: string;
  
  /** Signer function for transactions */
  signer?: (message: string) => Promise<string>;
  
  /** Pre-derived messaging key pair */
  keyPair?: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  
  /** NodeRegistry contract address */
  nodeRegistryAddress?: string;
  
  /** KeyRegistry contract address */
  keyRegistryAddress?: string;
  
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  
  /** Preferred region for node selection */
  preferredRegion?: string;
}

// ============ Contract Addresses ============

export interface ContractAddresses {
  nodeRegistry: string;
  keyRegistry: string;
  messageLedger?: string;
  stakingToken?: string;
}

// ============ Error Types ============

export class MessagingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
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

