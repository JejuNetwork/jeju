/**
 * Direct Cast REST API
 *
 * HTTP API for DC operations.
 */

import { Elysia } from 'elysia'
import { z } from 'zod'
import type { DirectCastClient } from './client'
import type { DirectCastEmbed } from './types'

interface RateLimitEntry {
  count: number
  windowStart: number
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map()
  private readonly windowMs: number
  private readonly maxRequests: number

  constructor(windowMs: number = 60000, maxRequests: number = 60) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests

    // Cleanup old entries periodically
    setInterval(() => this.cleanup(), windowMs * 2)
  }

  isAllowed(key: string): boolean {
    const now = Date.now()
    const entry = this.limits.get(key)

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.limits.set(key, { count: 1, windowStart: now })
      return true
    }

    if (entry.count >= this.maxRequests) {
      return false
    }

    entry.count++
    return true
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.limits) {
      if (now - entry.windowStart > this.windowMs) {
        this.limits.delete(key)
      }
    }
  }
}

// Separate rate limiters for different operation types
const messageSendLimiter = new RateLimiter(60000, 30) // 30 messages per minute
const readLimiter = new RateLimiter(60000, 120) // 120 reads per minute
const DirectCastEmbedSchema = z
  .object({
    type: z.enum(['url', 'cast', 'image']),
    url: z.string().url().optional(),
    castId: z
      .object({
        fid: z.number().int().positive(),
        hash: z.string().regex(/^0x[a-fA-F0-9]+$/),
      })
      .strict()
      .optional(),
    alt: z.string().max(500).optional(),
  })
  .strict()

const SendDCBodySchema = z
  .object({
    text: z.string().min(1).max(2000),
    embeds: z.array(DirectCastEmbedSchema).max(4).optional(),
    replyTo: z.string().min(1).optional(),
  })
  .strict()

const PaginationSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().optional(),
    after: z.string().optional(),
  })
  .strict()

const MuteRequestSchema = z
  .object({
    muted: z.boolean().default(true),
  })
  .strict()
function requireClient(
  getClient: () => DirectCastClient | null,
): DirectCastClient {
  const client = getClient()
  if (!client) {
    throw new Error('NOT_AUTHENTICATED')
  }
  return client
}
/**
 * Create Direct Cast REST API
 */
export function createDCApi(getClient: () => DirectCastClient | null): Elysia {
  const app = new Elysia()

  // Error handler for auth
  app.onError(({ error, set }) => {
    if (error instanceof Error && error.message === 'NOT_AUTHENTICATED') {
      set.status = 401
      return { error: 'Not authenticated' }
    }
    throw error
  })
  // List conversations
  app.get('/conversations', async () => {
    const client = requireClient(getClient)
    const conversations = await client.getConversations()

    return {
      conversations,
      count: conversations.length,
    }
  })

  // Get conversation by FID
  app.get('/conversations/:fid', async ({ params, set }) => {
    const client = requireClient(getClient)
    const fid = parseInt(params.fid, 10)

    if (Number.isNaN(fid) || fid <= 0) {
      set.status = 400
      return { error: 'Invalid FID' }
    }

    const conversation = await client.getConversation(fid)
    return { conversation }
  })

  // Archive conversation
  app.post('/conversations/:fid/archive', async ({ params, set }) => {
    const client = requireClient(getClient)
    const fid = parseInt(params.fid, 10)

    if (Number.isNaN(fid) || fid <= 0) {
      set.status = 400
      return { error: 'Invalid FID' }
    }

    await client.archiveConversation(fid)
    return { success: true }
  })

  // Mute/unmute conversation
  app.post('/conversations/:fid/mute', async ({ params, body, set }) => {
    const client = requireClient(getClient)
    const fid = parseInt(params.fid, 10)

    if (Number.isNaN(fid) || fid <= 0) {
      set.status = 400
      return { error: 'Invalid FID' }
    }

    const parseResult = MuteRequestSchema.safeParse(body)
    if (!parseResult.success) {
      set.status = 400
      return { error: 'Invalid request', details: parseResult.error.issues }
    }

    await client.muteConversation(fid, parseResult.data.muted)
    return { success: true }
  })
  // Get messages in conversation
  app.get('/conversations/:fid/messages', async ({ params, query, set }) => {
    const client = requireClient(getClient)
    const clientState = client.getState()

    // Rate limit read operations
    const rateLimitKey = `read:${clientState.fid}`
    if (!readLimiter.isAllowed(rateLimitKey)) {
      set.status = 429
      return {
        error: 'Rate limit exceeded. Please wait before making more requests.',
      }
    }

    const fid = parseInt(params.fid, 10)

    if (Number.isNaN(fid) || fid <= 0) {
      set.status = 400
      return { error: 'Invalid FID' }
    }

    const parsed = PaginationSchema.safeParse({
      limit: query.limit,
      before: query.before,
      after: query.after,
    })

    if (!parsed.success) {
      set.status = 400
      return { error: 'Invalid pagination params' }
    }

    const messages = await client.getMessages(fid, parsed.data)

    return {
      messages,
      count: messages.length,
      hasMore: messages.length === parsed.data.limit,
    }
  })

  // Send message
  app.post('/conversations/:fid/messages', async ({ params, body, set }) => {
    const client = requireClient(getClient)
    const clientState = client.getState()

    // Rate limit by sender FID
    const rateLimitKey = `send:${clientState.fid}`
    if (!messageSendLimiter.isAllowed(rateLimitKey)) {
      set.status = 429
      return {
        error: 'Rate limit exceeded. Please wait before sending more messages.',
      }
    }

    const fid = parseInt(params.fid, 10)

    if (Number.isNaN(fid) || fid <= 0) {
      set.status = 400
      return { error: 'Invalid FID' }
    }

    // Parse body with schema
    const bodyParsed = SendDCBodySchema.safeParse(body)
    if (!bodyParsed.success) {
      set.status = 400
      return { error: 'Invalid request', details: bodyParsed.error.issues }
    }

    const message = await client.send({
      recipientFid: fid,
      text: bodyParsed.data.text,
      embeds: bodyParsed.data.embeds as DirectCastEmbed[] | undefined,
      replyTo: bodyParsed.data.replyTo,
    })

    set.status = 201
    return { message }
  })

  // Mark as read
  app.post('/conversations/:fid/read', async ({ params, set }) => {
    const client = requireClient(getClient)
    const fid = parseInt(params.fid, 10)

    if (Number.isNaN(fid) || fid <= 0) {
      set.status = 400
      return { error: 'Invalid FID' }
    }

    await client.markAsRead(fid)
    return { success: true }
  })
  // Get client state
  app.get('/status', async () => {
    const client = requireClient(getClient)
    const state = client.getState()
    const publicKey = client.getEncryptionPublicKey()

    return {
      fid: state.fid,
      isConnected: state.isConnected,
      encryptionPublicKey: publicKey,
    }
  })

  // Publish encryption key
  app.post('/publish-key', async () => {
    const client = requireClient(getClient)
    await client.publishEncryptionKey()

    return { success: true }
  })

  return app
}
/**
 * Create standalone DC server
 */
export function createDCServer(client: DirectCastClient, port: number = 3300) {
  const app = createDCApi(() => client)

  // Health check
  app.get('/health', () => ({ status: 'ok' }))

  console.log(`[DC API] Starting server on port ${port}`)

  return app.listen(port)
}
