/**
 * Network Messaging Relay Node Server
 *
 * Handles message routing, storage, and delivery for the decentralized
 * messaging network. Uses CQL for persistent storage with in-memory cache
 * for fast access.
 */

import { cors } from '@elysiajs/cors'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import type { Address } from 'viem'
import { Elysia } from 'elysia'
import {
  CQLMessageStorage,
  type StoredMessage as CQLStoredMessage,
} from '../storage/cql-storage'
import {
  IPFSAddResponseSchema,
  type MessageEnvelope,
  MessageEnvelopeSchema,
  type NodeConfig,
  WebSocketSubscribeSchema,
} from '../schemas'

interface StoredMessage {
  envelope: MessageEnvelope
  cid: string
  receivedAt: number
  deliveredAt?: number
  storedOnIPFS: boolean
}

interface Subscriber {
  address: string
  ws: WebSocket
  subscribedAt: number
}

/** Message types sent via WebSocket to subscribers */
interface WebSocketNotification {
  type: 'message' | 'delivery_receipt' | 'read_receipt' | 'subscribed' | 'error'
  data?:
    | MessageEnvelope
    | { messageId: string }
    | { messageId: string; readAt: number }
  address?: string
  pendingCount?: number
  error?: string
  details?: { message: string; path?: (string | number)[] }[]
}

// In-memory cache for fast access (backed by CQL)
const messageCache = new Map<string, StoredMessage>()

// Pending messages per recipient (cached, synced with CQL)
const pendingByRecipient = new Map<string, string[]>()

// WebSocket subscribers
const subscribers = new Map<string, Subscriber>()

// CQL storage instance (initialized on server start)
let cqlStorage: CQLMessageStorage | null = null

// Stats
let totalMessagesRelayed = 0
let totalBytesRelayed = 0

function generateCID(content: string): string {
  const hash = sha256(new TextEncoder().encode(content))
  return `Qm${bytesToHex(hash).slice(0, 44)}`
}

/**
 * Convert MessageEnvelope to CQL StoredMessage format
 * Note: Addresses are normalized to lowercase for consistent querying
 */
function envelopeToCQLMessage(
  envelope: MessageEnvelope,
  cid: string,
): CQLStoredMessage {
  const normalizedFrom = envelope.from.toLowerCase() as Address
  const normalizedTo = envelope.to.toLowerCase() as Address
  return {
    id: envelope.id,
    conversationId: `dm:${[normalizedFrom, normalizedTo].sort().join('-')}`,
    sender: normalizedFrom,
    recipient: normalizedTo,
    encryptedContent: envelope.encryptedContent.ciphertext,
    contentCid: cid,
    ephemeralPublicKey: envelope.encryptedContent.ephemeralPublicKey,
    nonce: envelope.encryptedContent.nonce,
    timestamp: envelope.timestamp,
    chainId: 1,
    messageType: 'dm',
    deliveryStatus: 'pending',
    signature: envelope.signature ?? null,
  }
}

/**
 * Convert CQL StoredMessage to StoredMessage format
 */
function cqlMessageToStored(msg: CQLStoredMessage): StoredMessage {
  return {
    envelope: {
      id: msg.id,
      from: msg.sender,
      to: msg.recipient,
      encryptedContent: {
        ciphertext: msg.encryptedContent,
        ephemeralPublicKey: msg.ephemeralPublicKey,
        nonce: msg.nonce,
      },
      timestamp: msg.timestamp,
      signature: msg.signature ?? undefined,
    },
    cid: msg.contentCid ?? generateCID(msg.encryptedContent),
    receivedAt: msg.timestamp,
    deliveredAt: msg.deliveryStatus !== 'pending' ? msg.timestamp : undefined,
    storedOnIPFS: !!msg.contentCid,
  }
}

function addPendingMessage(recipient: string, messageId: string): void {
  const normalizedRecipient = recipient.toLowerCase()
  const existing = pendingByRecipient.get(normalizedRecipient)
  if (existing) {
    existing.push(messageId)
  } else {
    pendingByRecipient.set(normalizedRecipient, [messageId])
  }
}

async function getPendingMessages(recipient: string): Promise<StoredMessage[]> {
  const normalizedRecipient = recipient.toLowerCase()

  // Check in-memory cache first (preserves original data like address case)
  const pending = pendingByRecipient.get(normalizedRecipient)
  if (pending && pending.length > 0) {
    return pending
      .map((id) => messageCache.get(id))
      .filter((m): m is StoredMessage => m !== undefined)
  }

  // Fall back to CQL storage for messages not in cache
  if (cqlStorage) {
    const cqlMessages = await cqlStorage.getPendingMessages(
      normalizedRecipient as Address,
    )
    return cqlMessages.map(cqlMessageToStored)
  }

  return []
}

async function markDelivered(messageId: string): Promise<void> {
  // Update CQL storage
  if (cqlStorage) {
    await cqlStorage.updateDeliveryStatus(messageId, 'delivered')
  }

  // Update in-memory cache
  const msg = messageCache.get(messageId)
  if (msg) {
    msg.deliveredAt = Date.now()
  }
}

/**
 * Store message in both CQL and cache
 */
async function storeMessage(
  envelope: MessageEnvelope,
  cid: string,
): Promise<StoredMessage> {
  const storedMessage: StoredMessage = {
    envelope,
    cid,
    receivedAt: Date.now(),
    storedOnIPFS: false,
  }

  // Store in in-memory cache
  messageCache.set(envelope.id, storedMessage)
  addPendingMessage(envelope.to, envelope.id)

  // Persist to CQL if available
  if (cqlStorage) {
    const cqlMessage = envelopeToCQLMessage(envelope, cid)
    await cqlStorage.storeMessage(cqlMessage)
  }

  return storedMessage
}

/**
 * Get message by ID from cache or CQL
 */
async function getMessage(id: string): Promise<StoredMessage | null> {
  // Check cache first
  const cached = messageCache.get(id)
  if (cached) return cached

  // Try CQL storage
  // Note: CQL doesn't have a getMessageById method, so we'd need to add it
  // For now, return null if not in cache
  return null
}

function notifySubscriber(
  address: string,
  notification: WebSocketNotification,
): boolean {
  const subscriber = subscribers.get(address.toLowerCase())
  if (subscriber && subscriber.ws.readyState === WebSocket.OPEN) {
    subscriber.ws.send(JSON.stringify(notification))
    return true
  }
  return false
}

/**
 * Store content on IPFS. Returns CID on success, null if IPFS is not configured.
 * Throws if IPFS is configured but storage fails.
 */
async function storeOnIPFS(content: string, ipfsUrl: string): Promise<string> {
  const response = await fetch(`${ipfsUrl}/api/v0/add`, {
    method: 'POST',
    body: content,
  })

  if (!response.ok) {
    throw new Error(
      `IPFS storage failed: ${response.status} ${response.statusText}`,
    )
  }

  const result = IPFSAddResponseSchema.parse(await response.json())
  return result.Hash
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100 // 100 requests per minute
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 300000 // Clean up every 5 minutes
const MAX_RATE_LIMIT_ENTRIES = 10000 // Max entries to prevent memory exhaustion

// Periodic cleanup of expired rate limit entries
let rateLimitCleanupInterval: NodeJS.Timeout | null = null

function startRateLimitCleanup(): void {
  if (rateLimitCleanupInterval) return

  rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) {
        rateLimitMap.delete(key)
      }
    }
  }, RATE_LIMIT_CLEANUP_INTERVAL_MS)
}

function checkRateLimit(identifier: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(identifier)

  if (!entry || now > entry.resetAt) {
    // Prevent unbounded growth - if at max capacity, reject new entries
    if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES && !entry) {
      return false
    }
    rateLimitMap.set(identifier, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  entry.count++
  return true
}

// Max WebSocket message size (1MB)
const MAX_WS_MESSAGE_SIZE = 1024 * 1024

// Max subscribers to prevent DoS
const MAX_SUBSCRIBERS = 10000

// Max message age to prevent replay attacks (5 minutes)
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000

// Max clock skew allowed (future messages, 30 seconds)
const MAX_CLOCK_SKEW_MS = 30 * 1000

interface RequestHeaders {
  get(name: string): string | null
}

/**
 * Initialize CQL storage for persistent message storage
 */
async function initializeCQLStorage(): Promise<void> {
  const storage = new CQLMessageStorage()
  await storage.initialize()
  cqlStorage = storage
  console.log('[Relay Server] CQL storage initialized')
}

export function createRelayServer(config: NodeConfig) {
  // Start periodic rate limit cleanup
  startRateLimitCleanup()

  // Initialize CQL storage asynchronously (non-blocking)
  // On failure, cqlStorage remains null and we use in-memory only
  initializeCQLStorage().catch((error) => {
    cqlStorage = null
    console.warn(
      '[Relay Server] CQL storage unavailable, using in-memory only:',
      error instanceof Error ? error.message : 'Unknown error',
    )
  })

  // CORS - restrict to known origins in production
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? ['*']

  const app = new Elysia()
    .use(
      cors({
        origin: allowedOrigins.includes('*') ? true : allowedOrigins,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400,
      }),
    )

    .get('/health', () => ({
      status: 'healthy',
      nodeId: config.nodeId,
      uptime: process.uptime(),
      stats: {
        messagesRelayed: totalMessagesRelayed,
        bytesRelayed: totalBytesRelayed,
        activeSubscribers: subscribers.size,
        pendingMessages: messageCache.size,
        cqlAvailable: cqlStorage !== null,
      },
      timestamp: Date.now(),
    }))

    .post('/send', async ({ body, request, set }) => {
      // Rate limiting by IP or address
      const headers = request.headers as RequestHeaders
      const clientIp =
        headers.get('x-forwarded-for') ?? headers.get('x-real-ip') ?? 'unknown'
      if (!checkRateLimit(clientIp)) {
        set.status = 429
        return { success: false, error: 'Rate limit exceeded' }
      }

      // Validate envelope with Zod schema
      const parseResult = MessageEnvelopeSchema.safeParse(body)
      if (!parseResult.success) {
        set.status = 400
        return {
          success: false,
          error: 'Invalid envelope',
          details: parseResult.error.issues,
        }
      }

      const envelope = parseResult.data

      // Replay attack protection: validate timestamp freshness
      const now = Date.now()
      if (envelope.timestamp < now - MAX_MESSAGE_AGE_MS) {
        set.status = 400
        return {
          success: false,
          error: 'Message timestamp too old - possible replay attack',
        }
      }
      if (envelope.timestamp > now + MAX_CLOCK_SKEW_MS) {
        set.status = 400
        return { success: false, error: 'Message timestamp in the future' }
      }

      // Check if this message ID was already processed (dedupe)
      if (messageCache.has(envelope.id)) {
        set.status = 400
        return {
          success: false,
          error: 'Duplicate message ID - possible replay attack',
        }
      }

      // Check message size
      const messageSize = JSON.stringify(envelope).length
      if (config.maxMessageSize && messageSize > config.maxMessageSize) {
        set.status = 413
        return { success: false, error: 'Message too large' }
      }

      // Generate CID
      const cid = generateCID(JSON.stringify(envelope))

      // Store message in CQL and cache
      const storedMessage = await storeMessage(envelope, cid)

      // Update stats
      totalMessagesRelayed++
      totalBytesRelayed += messageSize

      // Store on IPFS if configured (async, log failures)
      if (config.ipfsUrl) {
        storeOnIPFS(JSON.stringify(envelope), config.ipfsUrl)
          .then(() => {
            storedMessage.storedOnIPFS = true
          })
          .catch((err: Error) => {
            console.error(
              `IPFS storage failed for message ${envelope.id}:`,
              err.message,
            )
          })
      }

      // Try to deliver immediately via WebSocket
      const delivered = notifySubscriber(envelope.to, {
        type: 'message',
        data: envelope,
      })

      if (delivered) {
        await markDelivered(envelope.id)

        // Notify sender of delivery
        notifySubscriber(envelope.from, {
          type: 'delivery_receipt',
          data: { messageId: envelope.id },
        })
      }

      return {
        success: true,
        messageId: envelope.id,
        cid,
        timestamp: storedMessage.receivedAt,
        delivered,
      }
    })

    .get('/messages/:address', async ({ params, request, set }) => {
      // Rate limiting
      const headers = request.headers as RequestHeaders
      const clientIp =
        headers.get('x-forwarded-for') ?? headers.get('x-real-ip') ?? 'unknown'
      if (!checkRateLimit(clientIp)) {
        set.status = 429
        return { error: 'Rate limit exceeded' }
      }

      const { address } = params

      // Validate address format (prevent injection)
      if (
        !/^0x[a-fA-F0-9]{40}$/i.test(address) &&
        !/^[a-zA-Z0-9._-]+$/.test(address)
      ) {
        set.status = 400
        return { error: 'Invalid address format' }
      }

      const pending = await getPendingMessages(address)

      return {
        address,
        messages: pending.map((m) => ({
          ...m.envelope,
          cid: m.cid,
          receivedAt: m.receivedAt,
        })),
        count: pending.length,
      }
    })

    .get('/message/:id', async ({ params, set }) => {
      const { id } = params

      // Validate UUID format to prevent injection
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      ) {
        set.status = 400
        return { error: 'Invalid message ID format' }
      }

      const message = await getMessage(id)

      if (!message) {
        set.status = 404
        return { error: 'Message not found' }
      }

      return {
        ...message.envelope,
        cid: message.cid,
        receivedAt: message.receivedAt,
        deliveredAt: message.deliveredAt,
      }
    })

    .post('/read/:id', async ({ params, set }) => {
      const { id } = params

      // Validate UUID format
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      ) {
        set.status = 400
        return { error: 'Invalid message ID format' }
      }

      const message = await getMessage(id)

      if (!message) {
        set.status = 404
        return { error: 'Message not found' }
      }

      // Update status in CQL
      if (cqlStorage) {
        await cqlStorage.updateDeliveryStatus(id, 'read')
      }

      // Notify sender of read receipt
      notifySubscriber(message.envelope.from, {
        type: 'read_receipt',
        data: { messageId: id, readAt: Date.now() },
      })

      return { success: true }
    })

    .get('/stats', () => ({
      nodeId: config.nodeId,
      totalMessagesRelayed,
      totalBytesRelayed,
      activeSubscribers: subscribers.size,
      pendingMessages: messageCache.size,
      uptime: process.uptime(),
    }))

  return app
}

interface WebSocketLike {
  send: (data: string) => void
  close: () => void
  readyState: number
}

/**
 * Process a subscription message and set up the subscriber
 * Returns the subscribed address or null if invalid
 */
async function processSubscription(
  rawMessage: string,
  ws: WebSocketLike,
  onSubscribe: (address: string) => void,
): Promise<string | null> {
  // Validate message size to prevent DoS
  if (rawMessage.length > MAX_WS_MESSAGE_SIZE) {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Message too large',
      }),
    )
    return null
  }

  // Safe JSON parsing - unknown is correct here, Zod validates below
  let parsed: unknown
  try {
    parsed = JSON.parse(rawMessage)
  } catch {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Invalid JSON',
      }),
    )
    return null
  }

  const parseResult = WebSocketSubscribeSchema.safeParse(parsed)

  if (!parseResult.success) {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Invalid message format',
        details: parseResult.error.issues,
      }),
    )
    return null
  }

  const address = parseResult.data.address.toLowerCase()

  // Check subscriber limit to prevent DoS
  if (!subscribers.has(address) && subscribers.size >= MAX_SUBSCRIBERS) {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Server at capacity, please try again later',
      }),
    )
    return null
  }

  subscribers.set(address, {
    address,
    ws: ws as WebSocket,
    subscribedAt: Date.now(),
  })

  onSubscribe(address)

  // Send any pending messages
  const pending = await getPendingMessages(address)
  for (const msg of pending) {
    ws.send(
      JSON.stringify({
        type: 'message',
        data: msg.envelope,
      }),
    )
    await markDelivered(msg.envelope.id)
  }

  // Confirm subscription
  ws.send(
    JSON.stringify({
      type: 'subscribed',
      address,
      pendingCount: pending.length,
    }),
  )

  return address
}

export function handleWebSocket(ws: WebSocket, _request: Request): void {
  let subscribedAddress: string | null = null

  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    processSubscription(event.data, ws, () => {
      /* no-op callback for standard WebSocket handler */
    })
      .then((address) => {
        subscribedAddress = address
      })
      .catch((error) => {
        console.error('[Relay Server] Subscription error:', error)
      })
  })

  ws.addEventListener('close', () => {
    if (subscribedAddress) {
      subscribers.delete(subscribedAddress)
    }
  })
}

// Track Bun websocket instances separately for the close handler
const bunWsToAddress = new WeakMap<object, string>()

export function startRelayServer(config: NodeConfig): void {
  const app = createRelayServer(config)

  Bun.serve({
    port: config.port,
    fetch: app.fetch,
    websocket: {
      message(ws, message) {
        // Create a WebSocket-like wrapper for the shared handler
        const wsWrapper: WebSocketLike = {
          send: (d: string) => {
            ws.send(d)
          },
          close: () => {
            ws.close()
          },
          readyState: WebSocket.OPEN,
        }

        if (typeof message !== 'string') return

        processSubscription(message, wsWrapper, (addr) => {
          bunWsToAddress.set(ws, addr)
        })
          .then((address) => {
            if (address) {
              // Update subscriber with wrapper
              subscribers.set(address, {
                address,
                ws: wsWrapper as WebSocket,
                subscribedAt: Date.now(),
              })
            }
          })
          .catch((error) => {
            console.error('[Relay Server] Subscription error:', error)
          })
      },
      close(ws) {
        const address = bunWsToAddress.get(ws)
        if (address) {
          subscribers.delete(address)
          bunWsToAddress.delete(ws)
        }
      },
    },
  })
}

if (import.meta.main) {
  const portEnv = process.env.PORT
  const nodeIdEnv = process.env.NODE_ID
  const ipfsUrl = process.env.IPFS_URL

  if (!portEnv) {
    throw new Error('PORT environment variable is required')
  }

  if (!nodeIdEnv) {
    throw new Error('NODE_ID environment variable is required')
  }

  const port = parseInt(portEnv, 10)
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${portEnv}`)
  }

  startRelayServer({
    port,
    nodeId: nodeIdEnv,
    ipfsUrl,
    maxMessageSize: 1024 * 1024, // 1MB
    messageRetentionDays: 7,
  })
}
