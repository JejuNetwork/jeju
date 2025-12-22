/**
 * Custom Content Types for Jeju Messaging
 * 
 * Defines rich content types beyond plain text.
 */

import type { Address, Hex } from 'viem';
import type {
  TextContent,
  ImageContent,
  FileContent,
  ReactionContent,
  ReplyContent,
  TransactionContent,
  AgentActionContent,
  MessageContent,
} from './types';

// ============ Content Type IDs ============

export const ContentTypeIds = {
  TEXT: 'jeju.org/text:1.0',
  IMAGE: 'jeju.org/image:1.0',
  FILE: 'jeju.org/file:1.0',
  REACTION: 'jeju.org/reaction:1.0',
  REPLY: 'jeju.org/reply:1.0',
  TRANSACTION: 'jeju.org/transaction:1.0',
  AGENT_ACTION: 'jeju.org/agent_action:1.0',
} as const;

// ============ Content Builders ============

/**
 * Create text content
 */
export function text(content: string): TextContent {
  return {
    type: 'text',
    text: content,
  };
}

/**
 * Create image content
 */
export function image(params: {
  url: string;
  width: number;
  height: number;
  mimeType: string;
  blurhash?: string;
  alt?: string;
}): ImageContent {
  return {
    type: 'image',
    ...params,
  };
}

/**
 * Create file content
 */
export function file(params: {
  url: string;
  name: string;
  size: number;
  mimeType: string;
}): FileContent {
  return {
    type: 'file',
    ...params,
  };
}

/**
 * Create reaction content
 */
export function reaction(params: {
  emoji: string;
  messageId: string;
  action?: 'add' | 'remove';
}): ReactionContent {
  return {
    type: 'reaction',
    emoji: params.emoji,
    messageId: params.messageId,
    action: params.action ?? 'add',
  };
}

/**
 * Create reply content
 */
export function reply(params: {
  text: string;
  replyToId: string;
  replyToContent?: string;
  replyToSender?: Address;
}): ReplyContent {
  return {
    type: 'reply',
    ...params,
  };
}

/**
 * Create transaction content
 */
export function transaction(params: {
  chainId: number;
  txHash: Hex;
  status?: 'pending' | 'confirmed' | 'failed';
  description?: string;
  amount?: string;
  token?: string;
}): TransactionContent {
  return {
    type: 'transaction',
    chainId: params.chainId,
    txHash: params.txHash,
    status: params.status ?? 'pending',
    description: params.description,
    amount: params.amount,
    token: params.token,
  };
}

/**
 * Create agent action content
 */
export function agentAction(params: {
  agentId: number;
  action: string;
  params: Record<string, string | number | boolean>;
  status?: 'pending' | 'completed' | 'failed';
  result?: string;
}): AgentActionContent {
  return {
    type: 'agent_action',
    agentId: params.agentId,
    action: params.action,
    params: params.params,
    status: params.status ?? 'pending',
    result: params.result,
  };
}

// ============ Content Serialization ============

/**
 * Serialize content to string
 */
export function serializeContent(content: MessageContent): string {
  return JSON.stringify(content);
}

/**
 * Deserialize content from string
 */
export function deserializeContent(json: string): MessageContent {
  const parsed = JSON.parse(json);
  
  switch (parsed.type) {
    case 'text':
    case 'image':
    case 'file':
    case 'reaction':
    case 'reply':
    case 'transaction':
    case 'agent_action':
      return parsed as MessageContent;
    default:
      throw new Error(`Unknown content type: ${parsed.type}`);
  }
}

/**
 * Get content type ID
 */
export function getContentTypeId(content: MessageContent): string {
  switch (content.type) {
    case 'text':
      return ContentTypeIds.TEXT;
    case 'image':
      return ContentTypeIds.IMAGE;
    case 'file':
      return ContentTypeIds.FILE;
    case 'reaction':
      return ContentTypeIds.REACTION;
    case 'reply':
      return ContentTypeIds.REPLY;
    case 'transaction':
      return ContentTypeIds.TRANSACTION;
    case 'agent_action':
      return ContentTypeIds.AGENT_ACTION;
  }
}

// ============ Content Validation ============

/**
 * Validate image content
 */
export function validateImage(content: ImageContent): boolean {
  return (
    typeof content.url === 'string' &&
    content.url.startsWith('http') &&
    content.width > 0 &&
    content.height > 0 &&
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(content.mimeType)
  );
}

/**
 * Validate file content
 */
export function validateFile(content: FileContent): boolean {
  return (
    typeof content.url === 'string' &&
    typeof content.name === 'string' &&
    content.name.length > 0 &&
    content.size > 0 &&
    content.size < 100 * 1024 * 1024 // Max 100MB
  );
}

/**
 * Validate transaction content
 */
export function validateTransaction(content: TransactionContent): boolean {
  return (
    typeof content.chainId === 'number' &&
    content.chainId > 0 &&
    typeof content.txHash === 'string' &&
    /^0x[a-fA-F0-9]{64}$/.test(content.txHash) &&
    ['pending', 'confirmed', 'failed'].includes(content.status)
  );
}

// ============ Content Display Helpers ============

/**
 * Get display text for content
 */
export function getContentPreview(content: MessageContent): string {
  switch (content.type) {
    case 'text':
      return content.text.slice(0, 100);
    case 'image':
      return content.alt ?? '📷 Image';
    case 'file':
      return `📎 ${content.name}`;
    case 'reaction':
      return `${content.emoji} reaction`;
    case 'reply':
      return content.text.slice(0, 100);
    case 'transaction':
      return `💸 Transaction: ${content.description ?? content.txHash.slice(0, 10)}...`;
    case 'agent_action':
      return `🤖 Agent: ${content.action}`;
  }
}

/**
 * Check if content requires special rendering
 */
export function isRichContent(content: MessageContent): boolean {
  return content.type !== 'text';
}

