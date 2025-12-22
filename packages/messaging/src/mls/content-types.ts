/**
 * Custom Content Types for Jeju Messaging
 *
 * Defines rich content types beyond plain text.
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'
import type {
  AgentActionContent,
  FileContent,
  ImageContent,
  MessageContent,
  ReactionContent,
  ReplyContent,
  TextContent,
  TransactionContent,
} from './types'

const TextContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

const ImageContentSchema = z.object({
  type: z.literal('image'),
  url: z.string().url(),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  blurhash: z.string().optional(),
  alt: z.string().optional(),
})

const FileContentSchema = z.object({
  type: z.literal('file'),
  url: z.string().url(),
  name: z.string().min(1).max(255),
  size: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024), // Max 100MB
  mimeType: z.string(),
})

const ReactionContentSchema = z.object({
  type: z.literal('reaction'),
  emoji: z.string().min(1),
  messageId: z.string().min(1),
  action: z.enum(['add', 'remove']),
})

const ReplyContentSchema = z.object({
  type: z.literal('reply'),
  text: z.string(),
  replyToId: z.string().min(1),
  replyToContent: z.string().optional(),
  replyToSender: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
})

const TransactionContentSchema = z.object({
  type: z.literal('transaction'),
  chainId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  status: z.enum(['pending', 'confirmed', 'failed']),
  description: z.string().optional(),
  amount: z.string().optional(),
  token: z.string().optional(),
})

const AgentActionContentSchema = z.object({
  type: z.literal('agent_action'),
  agentId: z.number().int(),
  action: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  status: z.enum(['pending', 'completed', 'failed']),
  result: z.string().optional(),
})

export const MessageContentSchema = z.discriminatedUnion('type', [
  TextContentSchema,
  ImageContentSchema,
  FileContentSchema,
  ReactionContentSchema,
  ReplyContentSchema,
  TransactionContentSchema,
  AgentActionContentSchema,
])

export const ContentTypeIds = {
  TEXT: 'jeju.org/text:1.0',
  IMAGE: 'jeju.org/image:1.0',
  FILE: 'jeju.org/file:1.0',
  REACTION: 'jeju.org/reaction:1.0',
  REPLY: 'jeju.org/reply:1.0',
  TRANSACTION: 'jeju.org/transaction:1.0',
  AGENT_ACTION: 'jeju.org/agent_action:1.0',
} as const

/**
 * Create text content
 */
export function text(content: string): TextContent {
  return {
    type: 'text',
    text: content,
  }
}

/**
 * Create image content
 */
export function image(params: {
  url: string
  width: number
  height: number
  mimeType: string
  blurhash?: string
  alt?: string
}): ImageContent {
  return {
    type: 'image',
    ...params,
  }
}

/**
 * Create file content
 */
export function file(params: {
  url: string
  name: string
  size: number
  mimeType: string
}): FileContent {
  return {
    type: 'file',
    ...params,
  }
}

/**
 * Create reaction content
 */
export function reaction(params: {
  emoji: string
  messageId: string
  action?: 'add' | 'remove'
}): ReactionContent {
  return {
    type: 'reaction',
    emoji: params.emoji,
    messageId: params.messageId,
    action: params.action ?? 'add',
  }
}

/**
 * Create reply content
 */
export function reply(params: {
  text: string
  replyToId: string
  replyToContent?: string
  replyToSender?: Address
}): ReplyContent {
  return {
    type: 'reply',
    ...params,
  }
}

/**
 * Create transaction content
 */
export function transaction(params: {
  chainId: number
  txHash: Hex
  status?: 'pending' | 'confirmed' | 'failed'
  description?: string
  amount?: string
  token?: string
}): TransactionContent {
  return {
    type: 'transaction',
    chainId: params.chainId,
    txHash: params.txHash,
    status: params.status ?? 'pending',
    description: params.description,
    amount: params.amount,
    token: params.token,
  }
}

/**
 * Create agent action content
 */
export function agentAction(params: {
  agentId: number
  action: string
  params: Record<string, string | number | boolean>
  status?: 'pending' | 'completed' | 'failed'
  result?: string
}): AgentActionContent {
  return {
    type: 'agent_action',
    agentId: params.agentId,
    action: params.action,
    params: params.params,
    status: params.status ?? 'pending',
    result: params.result,
  }
}

/**
 * Serialize content to string
 */
export function serializeContent(content: MessageContent): string {
  return JSON.stringify(content)
}

/**
 * Deserialize content from string with Zod validation
 */
export function deserializeContent(json: string): MessageContent {
  const parsed: unknown = JSON.parse(json)
  const result = MessageContentSchema.safeParse(parsed)

  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new Error(`Invalid message content: ${errors}`)
  }

  return result.data as MessageContent
}

/**
 * Get content type ID
 */
export function getContentTypeId(content: MessageContent): string {
  switch (content.type) {
    case 'text':
      return ContentTypeIds.TEXT
    case 'image':
      return ContentTypeIds.IMAGE
    case 'file':
      return ContentTypeIds.FILE
    case 'reaction':
      return ContentTypeIds.REACTION
    case 'reply':
      return ContentTypeIds.REPLY
    case 'transaction':
      return ContentTypeIds.TRANSACTION
    case 'agent_action':
      return ContentTypeIds.AGENT_ACTION
  }
}

/**
 * Validate image content - accepts unknown for runtime validation
 */
export function validateImage(
  content: Partial<ImageContent> | { [key: string]: unknown },
): content is ImageContent {
  const c = content as Record<string, unknown>
  return (
    typeof c.url === 'string' &&
    c.url.startsWith('https://') && // Require HTTPS for security
    c.url.length <= 2048 && // Reasonable URL length limit
    typeof c.width === 'number' &&
    c.width > 0 &&
    c.width <= 10000 && // Reasonable dimension limits
    typeof c.height === 'number' &&
    c.height > 0 &&
    c.height <= 10000 &&
    typeof c.mimeType === 'string' &&
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(c.mimeType)
  )
}

/**
 * Validate file content - accepts unknown for runtime validation
 */
export function validateFile(
  content: Partial<FileContent> | { [key: string]: unknown },
): content is FileContent {
  const c = content as Record<string, unknown>
  return (
    typeof c.url === 'string' &&
    c.url.startsWith('https://') && // Require HTTPS
    c.url.length <= 2048 &&
    typeof c.name === 'string' &&
    c.name.length > 0 &&
    c.name.length <= 255 && // Reasonable filename length
    // Prevent path traversal in filename
    !/[/\\]/.test(c.name) &&
    typeof c.size === 'number' &&
    c.size > 0 &&
    c.size < 100 * 1024 * 1024 // Max 100MB
  )
}

/**
 * Validate transaction content - accepts unknown for runtime validation
 */
export function validateTransaction(
  content: Partial<TransactionContent> | { [key: string]: unknown },
): content is TransactionContent {
  const c = content as Record<string, unknown>
  return (
    typeof c.chainId === 'number' &&
    c.chainId > 0 &&
    typeof c.txHash === 'string' &&
    /^0x[a-fA-F0-9]{64}$/.test(c.txHash) &&
    typeof c.status === 'string' &&
    ['pending', 'confirmed', 'failed'].includes(c.status)
  )
}

/**
 * Get display text for content
 */
export function getContentPreview(content: MessageContent): string {
  switch (content.type) {
    case 'text':
      return content.text.slice(0, 100)
    case 'image':
      return content.alt ?? '📷 Image'
    case 'file':
      return `📎 ${content.name}`
    case 'reaction':
      return `${content.emoji} reaction`
    case 'reply':
      return content.text.slice(0, 100)
    case 'transaction':
      return `💸 Transaction: ${content.description ?? content.txHash.slice(0, 10)}...`
    case 'agent_action':
      return `🤖 Agent: ${content.action}`
  }
}

/**
 * Check if content requires special rendering
 */
export function isRichContent(content: MessageContent): boolean {
  return content.type !== 'text'
}
