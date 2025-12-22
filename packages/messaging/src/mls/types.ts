/**
 * MLS Types for Jeju Messaging
 * 
 * Type definitions for MLS-based group messaging.
 */

import { z } from 'zod';
import type { Address, Hex } from 'viem';

// ============ Zod Schemas ============

export const MLSMessageSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  senderId: z.string(),
  senderAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  content: z.string(),
  contentType: z.enum(['text', 'image', 'file', 'reaction', 'reply', 'transaction', 'agent_action']),
  timestamp: z.number(),
  replyTo: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type MLSMessage = z.infer<typeof MLSMessageSchema>;

export const GroupInviteSchema = z.object({
  groupId: z.string(),
  inviterAddress: z.string(),
  inviterFid: z.number().optional(),
  groupName: z.string(),
  memberCount: z.number(),
  expiresAt: z.number(),
  code: z.string(),
});

export type GroupInvite = z.infer<typeof GroupInviteSchema>;

export const GroupMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  createdBy: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  createdAt: z.number(),
  memberCount: z.number(),
});

export type GroupMetadata = z.infer<typeof GroupMetadataSchema>;

// ============ Client Types ============

export interface MLSClientConfig {
  /** Wallet address */
  address: Address;
  /** Key registry contract address */
  keyRegistryAddress: Address;
  /** Relay URL for message transport */
  relayUrl: string;
  /** RPC URL for chain interaction */
  rpcUrl: string;
  /** Network (mainnet | testnet) */
  network: 'mainnet' | 'testnet';
  /** Enable persistence */
  persistenceEnabled?: boolean;
  /** Persistence directory */
  persistenceDir?: string;
}

export interface MLSClientState {
  /** Client address */
  address: Address;
  /** Is initialized */
  isInitialized: boolean;
  /** Number of groups */
  groupCount: number;
  /** Last sync time */
  lastSyncAt: number;
}

// ============ Group Types ============

export interface GroupConfig {
  /** Group name */
  name: string;
  /** Group description */
  description?: string;
  /** Group image URL */
  imageUrl?: string;
  /** Initial members (addresses) */
  members: Address[];
  /** Group admins */
  admins?: Address[];
}

export interface GroupMember {
  /** Member address */
  address: Address;
  /** Is admin */
  isAdmin: boolean;
  /** Join time */
  joinedAt: number;
  /** Added by */
  addedBy: Address;
  /** Installation IDs */
  installationIds: Uint8Array[];
}

export interface GroupState {
  /** Group ID */
  id: string;
  /** MLS group ID (bytes) */
  mlsGroupId: Uint8Array;
  /** Metadata */
  metadata: GroupMetadata;
  /** Members */
  members: GroupMember[];
  /** Is active */
  isActive: boolean;
  /** Last message time */
  lastMessageAt?: number;
  /** Unread count */
  unreadCount: number;
}

// ============ Message Types ============

export interface SendOptions {
  /** Content type */
  contentType?: string;
  /** Reply to message ID */
  replyTo?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
  /** Priority (for ordering) */
  priority?: 'normal' | 'high';
}

export interface FetchOptions {
  /** Limit number of messages */
  limit?: number;
  /** Start from message ID */
  after?: string;
  /** End at message ID */
  before?: string;
  /** Direction */
  direction?: 'asc' | 'desc';
}

// ============ Content Types ============

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  url: string;
  width: number;
  height: number;
  mimeType: string;
  blurhash?: string;
  alt?: string;
}

export interface FileContent {
  type: 'file';
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface ReactionContent {
  type: 'reaction';
  emoji: string;
  messageId: string;
  action: 'add' | 'remove';
}

export interface ReplyContent {
  type: 'reply';
  text: string;
  replyToId: string;
  replyToContent?: string;
  replyToSender?: Address;
}

export interface TransactionContent {
  type: 'transaction';
  chainId: number;
  txHash: Hex;
  status: 'pending' | 'confirmed' | 'failed';
  description?: string;
  amount?: string;
  token?: string;
}

export interface AgentActionContent {
  type: 'agent_action';
  agentId: number;
  action: string;
  params: Record<string, string | number | boolean>;
  status: 'pending' | 'completed' | 'failed';
  result?: string;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | FileContent
  | ReactionContent
  | ReplyContent
  | TransactionContent
  | AgentActionContent;

// ============ Event Types ============

export interface MLSEvent {
  type: 'message' | 'member_added' | 'member_removed' | 'group_created' | 'group_updated';
  groupId: string;
  timestamp: number;
}

export interface MessageEvent extends MLSEvent {
  type: 'message';
  message: MLSMessage;
}

export interface MemberEvent extends MLSEvent {
  type: 'member_added' | 'member_removed';
  member: Address;
  actor: Address;
}

export interface GroupEvent extends MLSEvent {
  type: 'group_created' | 'group_updated';
  metadata: GroupMetadata;
}

export type MLSEventData = MessageEvent | MemberEvent | GroupEvent;

// ============ Sync Types ============

export interface SyncResult {
  /** Number of new messages */
  newMessages: number;
  /** Number of groups synced */
  groupsSynced: number;
  /** Errors encountered */
  errors: string[];
  /** Sync duration ms */
  durationMs: number;
}

export interface DeviceInfo {
  /** Installation ID */
  installationId: Uint8Array;
  /** Device type */
  deviceType: 'desktop' | 'mobile' | 'web';
  /** Last active */
  lastActiveAt: number;
  /** Device name */
  name?: string;
}

