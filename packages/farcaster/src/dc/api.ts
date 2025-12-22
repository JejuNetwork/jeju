/**
 * Direct Cast REST API
 *
 * HTTP API for DC operations.
 */

import { type Context, Hono, type Next } from 'hono'
import { z } from 'zod'
import type { DirectCastClient } from './client'
import type { DirectCastEmbed } from './types'

// ============ Rate Limiting ============

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

// ============ Schemas ============

const SendDCSchema = z.object({
  recipientFid: z.number().int().positive(),
  text: z.string().min(1).max(2000),
  embeds: z
    .array(
      z.object({
        type: z.enum(['url', 'cast', 'image']),
        url: z.string().url().optional(),
        castId: z
          .object({
            fid: z.number().int().positive(),
            hash: z.string().regex(/^0x[a-fA-F0-9]+$/),
          })
          .optional(),
        alt: z.string().optional(),
      }),
    )
    .max(4)
    .optional(),
  replyTo: z.string().optional(),
})

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().optional(),
  after: z.string().optional(),
})

// ============ API Factory ============

/**
 * Create Direct Cast REST API
 */
export function createDCApi(getClient: () => DirectCastClient | null): Hono {
  const app = new Hono()

  // ============ Middleware ============

  // Require authenticated client
  app.use(
    '*',
    async (c: Context, next: Next): Promise<Response | undefined> => {
      const client = getClient()
      if (!client) {
        return c.json({ error: 'Not authenticated' }, 401)
      }
      c.set('dcClient' as never, client as never)
      await next()
      return undefined
    },
  )

  // ============ Conversations ============

  // List conversations
  app.get('/conversations', async (c: Context) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    const conversations = await client.getConversations()

    return c.json({
      conversations,
      count: conversations.length,
    })
  })

  // Get conversation by FID
  app.get('/conversations/:fid', async (c: Context) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    const fid = parseInt(c.req.param('fid'), 10)

    if (Number.isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400)
    }

    const conversation = await client.getConversation(fid)
    return c.json({ conversation })
  })

  // Archive conversation
  app.post('/conversations/:fid/archive', async (c: Context) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    const fid = parseInt(c.req.param('fid'), 10)

    if (Number.isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400)
    }

    await client.archiveConversation(fid)
    return c.json({ success: true })
  })

  // Mute/unmute conversation
  app.post('/conversations/:fid/mute', async (c: Context) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    const fid = parseInt(c.req.param('fid'), 10)

    if (Number.isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400)
    }

    const { muted } = (await c.req.json()) as { muted?: boolean }

    await client.muteConversation(fid, muted ?? true)
    return c.json({ success: true })
  })

  // ============ Messages ============

  // Get messages in conversation
  app.get('/conversations/:fid/messages', async (c: Context) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    const clientState = client.getState()

    // Rate limit read operations
    const rateLimitKey = `read:${clientState.fid}`
    if (!readLimiter.isAllowed(rateLimitKey)) {
      return c.json(
        {
          error:
            'Rate limit exceeded. Please wait before making more requests.',
        },
        429,
      )
    }

    const fid = parseInt(c.req.param('fid'), 10)

    if (Number.isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400)
    }

    const parsed = PaginationSchema.safeParse({
      limit: c.req.query('limit'),
      before: c.req.query('before'),
      after: c.req.query('after'),
    })

    if (!parsed.success) {
      return c.json({ error: 'Invalid pagination params' }, 400)
    }

    const messages = await client.getMessages(fid, parsed.data)

    return c.json({
      messages,
      count: messages.length,
      hasMore: messages.length === parsed.data.limit,
    })
  })

  // Send message
  app.post('/conversations/:fid/messages', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    const clientState = client.getState()

    // Rate limit by sender FID
    const rateLimitKey = `send:${clientState.fid}`
    if (!messageSendLimiter.isAllowed(rateLimitKey)) {
      return c.json(
        {
          error:
            'Rate limit exceeded. Please wait before sending more messages.',
        },
        429,
      )
    }

    const fid = parseInt(c.req.param('fid'), 10)

    if (Number.isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400)
    }

    const body = await c.req.json()
    const parsed = SendDCSchema.safeParse({ ...body, recipientFid: fid })

    if (!parsed.success) {
      return c.json({ error: 'Invalid request' }, 400)
    }

    const message = await client.send({
      recipientFid: parsed.data.recipientFid,
      text: parsed.data.text,
      embeds: parsed.data.embeds as DirectCastEmbed[] | undefined,
      replyTo: parsed.data.replyTo,
    })

    return c.json({ message }, 201)
  })

  // Mark as read
  app.post('/conversations/:fid/read', async (c: Context) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    const fid = parseInt(c.req.param('fid'), 10)

    if (Number.isNaN(fid) || fid <= 0) {
      return c.json({ error: 'Invalid FID' }, 400)
    }

    await client.markAsRead(fid)
    return c.json({ success: true })
  })

  // ============ Status ============

  // Get client state
  app.get('/status', async (c) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    const state = client.getState()
    const publicKey = client.getEncryptionPublicKey()

    return c.json({
      ...state,
      encryptionPublicKey: publicKey,
    })
  })

  // Publish encryption key
  app.post('/publish-key', async (c: Context) => {
    const client = c.get('dcClient' as never) as DirectCastClient
    await client.publishEncryptionKey()

    return c.json({ success: true })
  })

  return app
}

// ============ Standalone Server ============

/**
 * Create standalone DC server
 */
export function createDCServer(client: DirectCastClient, port: number = 3300) {
  const app = createDCApi(() => client)

  // Health check
  app.get('/health', (c: Context) => c.json({ status: 'ok' }))

  console.log(`[DC API] Starting server on port ${port}`)

  return Bun.serve({
    port,
    fetch: app.fetch,
  })
}
