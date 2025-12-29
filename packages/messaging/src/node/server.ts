/**
 * Network Messaging Relay Node Server
 *
 * Handles message routing, storage, and delivery for the decentralized
 * messaging network. Uses EQLite for persistent storage with in-memory cache
 * for fast access.
 */

import { cors } from '@elysiajs/cors'
import {
  getAllowedOrigins,
  getIpfsUrlEnv,
  getNodeId,
  getPortEnv,
} from '@jejunetwork/config'
import {
  type CacheClient,
  createLogger,
  getCacheClient,
} from '@jejunetwork/shared'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { Elysia } from 'elysia'
import { type Address, type Hex, verifyMessage } from 'viem'

import {
  IPFSAddResponseSchema,
  type MessageEnvelope,
  MessageEnvelopeSchema,
  type NodeConfig,
  WebSocketSubscribeSchema,
} from '../schemas'
import {
  EQLiteMessageStorage,
  type StoredMessage as EQLiteStoredMessage,
} from '../storage/eqlite-storage'

const log = createLogger('relay-server')

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

// In-memory cache for fast access (backed by EQLite)
const messageCache = new Map<string, StoredMessage>()

// Pending messages per recipient (cached, synced with EQLite)
const pendingByRecipient = new Map<string, string[]>()

// WebSocket subscribers
const subscribers = new Map<string, Subscriber>()

// EQLite storage instance (initialized on server start)
let eqliteStorage: EQLiteMessageStorage | null = null

// Stats
let totalMessagesRelayed = 0
let totalBytesRelayed = 0

function generateCID(content: string): string {
  const hash = sha256(new TextEncoder().encode(content))
  return `Qm${bytesToHex(hash).slice(0, 44)}`
}

/**
 * Convert MessageEnvelope to EQLite StoredMessage format
 * Note: Addresses are normalized to lowercase for consistent querying
 */
function envelopeToEQLiteMessage(
  envelope: MessageEnvelope,
  cid: string,
): EQLiteStoredMessage {
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
 * Convert EQLite StoredMessage to StoredMessage format
 */
function eqliteMessageToStored(msg: EQLiteStoredMessage): StoredMessage {
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

  // Fall back to EQLite storage for messages not in cache
  if (eqliteStorage) {
    const eqliteMessages = await eqliteStorage.getPendingMessages(
      normalizedRecipient as Address,
    )
    return eqliteMessages.map(eqliteMessageToStored)
  }

  return []
}

async function markDelivered(messageId: string): Promise<void> {
  // Update EQLite storage
  if (eqliteStorage) {
    await eqliteStorage.updateDeliveryStatus(messageId, 'delivered')
  }

  // Update in-memory cache
  const msg = messageCache.get(messageId)
  if (msg) {
    msg.deliveredAt = Date.now()
  }
}

/**
 * Store message in both EQLite and cache
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

  // Persist to EQLite if available
  if (eqliteStorage) {
    const eqliteMessage = envelopeToEQLiteMessage(envelope, cid)
    await eqliteStorage.storeMessage(eqliteMessage)
  }

  return storedMessage
}

/**
 * Get message by ID from cache or EQLite
 */
async function getMessage(id: string): Promise<StoredMessage | null> {
  // Check cache first
  const cached = messageCache.get(id)
  if (cached) return cached

  // Try EQLite storage
  // Note: EQLite doesn't have a getMessageById method, so we'd need to add it
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

// Distributed rate limiting via shared cache
const RATE_LIMIT_WINDOW_SECONDS = 60 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100 // 100 requests per minute

let rateLimitCache: CacheClient | null = null

function getRateLimitCache(): CacheClient {
  if (!rateLimitCache) {
    rateLimitCache = getCacheClient('messaging-ratelimit')
  }
  return rateLimitCache
}

async function checkRateLimit(identifier: string): Promise<boolean> {
  const cache = getRateLimitCache()
  const cacheKey = `ratelimit:${identifier}`

  const current = await cache.get(cacheKey)
  if (!current) {
    // First request - set count to 1 with TTL
    await cache.set(cacheKey, '1', RATE_LIMIT_WINDOW_SECONDS)
    return true
  }

  const count = parseInt(current, 10)
  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  // Increment count
  await cache.set(cacheKey, String(count + 1), RATE_LIMIT_WINDOW_SECONDS)
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
 * Initialize EQLite storage for persistent message storage
 */
async function initializeEQLiteStorage(): Promise<void> {
  const storage = new EQLiteMessageStorage()
  await storage.initialize()
  eqliteStorage = storage
  log.info('EQLite storage initialized')
}

export function createRelayServer(config: NodeConfig) {
  // Initialize EQLite storage - REQUIRED for production
  // In development, if EQLite isn't available, initialization will throw
  initializeEQLiteStorage().catch((error) => {
    log.error('EQLite storage initialization failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    // Don't set to null - keep it undefined to let queries fail fast
    // Memory-only mode is not supported for production reliability
  })

  // CORS - restrict to known origins in production
  const allowedOrigins = getAllowedOrigins()

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
        eqliteAvailable: eqliteStorage !== null,
      },
      timestamp: Date.now(),
    }))

    .post('/send', async ({ body, request, set }) => {
      // Rate limiting by IP or address
      const headers = request.headers as RequestHeaders
      const clientIp =
        headers.get('x-forwarded-for') ?? headers.get('x-real-ip') ?? 'unknown'
      const allowed = await checkRateLimit(clientIp)
      if (!allowed) {
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

      // Store message in EQLite and cache
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
            log.error('IPFS storage failed', {
              messageId: envelope.id,
              error: err.message,
            })
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
      const allowed = await checkRateLimit(clientIp)
      if (!allowed) {
        set.status = 429
        return { error: 'Rate limit exceeded' }
      }

      const { address } = params

      // Validate Ethereum address format only (required for signature verification)
      if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
        set.status = 400
        return { error: 'Invalid address format' }
      }

      // SECURITY: Authenticate request - only the owner can fetch their messages
      const signature = headers.get('x-jeju-signature') as Hex | null
      const timestamp = headers.get('x-jeju-timestamp')

      if (!signature || !timestamp) {
        set.status = 401
        return {
          error:
            'Authentication required. Provide x-jeju-signature and x-jeju-timestamp headers.',
        }
      }

      // Validate timestamp to prevent replay attacks
      const ts = parseInt(timestamp, 10)
      const now = Date.now()
      if (
        Number.isNaN(ts) ||
        ts < now - MAX_MESSAGE_AGE_MS ||
        ts > now + MAX_CLOCK_SKEW_MS
      ) {
        set.status = 401
        return { error: 'Invalid or expired timestamp' }
      }

      // Verify signature proves ownership
      let isValid = false
      try {
        isValid = await verifyMessage({
          address: address as Address,
          message: `Get messages:${address}:${timestamp}`,
          signature,
        })
      } catch {
        isValid = false
      }

      if (!isValid) {
        set.status = 401
        return { error: 'Invalid signature - cannot verify address ownership' }
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

    .get('/message/:id', async ({ params, request, set }) => {
      const { id } = params
      const headers = request.headers as RequestHeaders

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

      // SECURITY: Authenticate request - only sender or recipient can view message
      const signature = headers.get('x-jeju-signature') as Hex | null
      const timestamp = headers.get('x-jeju-timestamp')

      if (!signature || !timestamp) {
        set.status = 401
        return {
          error:
            'Authentication required. Provide x-jeju-signature and x-jeju-timestamp headers.',
        }
      }

      // Validate timestamp
      const ts = parseInt(timestamp, 10)
      const now = Date.now()
      if (
        Number.isNaN(ts) ||
        ts < now - MAX_MESSAGE_AGE_MS ||
        ts > now + MAX_CLOCK_SKEW_MS
      ) {
        set.status = 401
        return { error: 'Invalid or expired timestamp' }
      }

      // Try verifying as sender
      let isAuthorized = false
      try {
        isAuthorized = await verifyMessage({
          address: message.envelope.from as Address,
          message: `Get message:${id}:${timestamp}`,
          signature,
        })
      } catch {
        isAuthorized = false
      }

      // Try verifying as recipient if not sender
      if (!isAuthorized) {
        try {
          isAuthorized = await verifyMessage({
            address: message.envelope.to as Address,
            message: `Get message:${id}:${timestamp}`,
            signature,
          })
        } catch {
          isAuthorized = false
        }
      }

      if (!isAuthorized) {
        set.status = 401
        return { error: 'Unauthorized - must be sender or recipient' }
      }

      return {
        ...message.envelope,
        cid: message.cid,
        receivedAt: message.receivedAt,
        deliveredAt: message.deliveredAt,
      }
    })

    .post('/read/:id', async ({ params, request, set }) => {
      const { id } = params
      const headers = request.headers as RequestHeaders

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

      // SECURITY: Only the recipient can mark a message as read
      const signature = headers.get('x-jeju-signature') as Hex | null
      const timestamp = headers.get('x-jeju-timestamp')

      if (!signature || !timestamp) {
        set.status = 401
        return {
          error:
            'Authentication required. Provide x-jeju-signature and x-jeju-timestamp headers.',
        }
      }

      // Validate timestamp
      const ts = parseInt(timestamp, 10)
      const now = Date.now()
      if (
        Number.isNaN(ts) ||
        ts < now - MAX_MESSAGE_AGE_MS ||
        ts > now + MAX_CLOCK_SKEW_MS
      ) {
        set.status = 401
        return { error: 'Invalid or expired timestamp' }
      }

      // Verify signature from recipient only
      let isValid = false
      try {
        isValid = await verifyMessage({
          address: message.envelope.to as Address,
          message: `Mark read:${id}:${timestamp}`,
          signature,
        })
      } catch {
        isValid = false
      }

      if (!isValid) {
        set.status = 401
        return {
          error: 'Unauthorized - only recipient can mark message as read',
        }
      }

      // Update status in EQLite
      if (eqliteStorage) {
        await eqliteStorage.updateDeliveryStatus(id, 'read')
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

    .get('/metrics', () => {
      const metrics = [
        '# HELP relay_messages_total Total messages relayed',
        '# TYPE relay_messages_total counter',
        `relay_messages_total{node_id="${config.nodeId}"} ${totalMessagesRelayed}`,
        '',
        '# HELP relay_bytes_total Total bytes relayed',
        '# TYPE relay_bytes_total counter',
        `relay_bytes_total{node_id="${config.nodeId}"} ${totalBytesRelayed}`,
        '',
        '# HELP relay_active_subscribers Current active WebSocket subscribers',
        '# TYPE relay_active_subscribers gauge',
        `relay_active_subscribers{node_id="${config.nodeId}"} ${subscribers.size}`,
        '',
        '# HELP relay_pending_messages Messages pending delivery',
        '# TYPE relay_pending_messages gauge',
        `relay_pending_messages{node_id="${config.nodeId}"} ${messageCache.size}`,
        '',
        '# HELP relay_eqlite_available EQLite storage availability (1=available, 0=unavailable)',
        '# TYPE relay_eqlite_available gauge',
        `relay_eqlite_available{node_id="${config.nodeId}"} ${eqliteStorage ? 1 : 0}`,
        '',
        '# HELP relay_uptime_seconds Server uptime in seconds',
        '# TYPE relay_uptime_seconds gauge',
        `relay_uptime_seconds{node_id="${config.nodeId}"} ${process.uptime()}`,
        '',
      ]
      return new Response(metrics.join('\n'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    })

  return app
}

interface WebSocketLike {
  send: (data: string) => void
  close: () => void
  readyState: number
}

/** Max age for subscription timestamp (5 minutes) */
const MAX_SUBSCRIPTION_AGE_MS = 5 * 60 * 1000

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

  const { address: rawAddress, signature, timestamp } = parseResult.data
  const address = rawAddress.toLowerCase()

  // Validate timestamp to prevent replay attacks
  const now = Date.now()
  if (
    timestamp < now - MAX_SUBSCRIPTION_AGE_MS ||
    timestamp > now + MAX_CLOCK_SKEW_MS
  ) {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Invalid or expired timestamp',
      }),
    )
    return null
  }

  // Verify signature proves ownership of the address
  let isValid = false
  try {
    isValid = await verifyMessage({
      address: rawAddress as Address,
      message: `Subscribe to Jeju messages:${rawAddress}:${timestamp}`,
      signature: signature as Hex,
    })
  } catch {
    isValid = false
  }

  if (!isValid) {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Invalid signature - cannot verify address ownership',
      }),
    )
    return null
  }

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
        log.error('Subscription error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
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
            log.error('WebSocket subscription error', {
              error: error instanceof Error ? error.message : 'Unknown error',
            })
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
  const port = getPortEnv()
  const nodeIdEnv = getNodeId()
  const ipfsUrl = getIpfsUrlEnv()

  if (!port) {
    throw new Error('PORT environment variable is required')
  }

  if (!nodeIdEnv) {
    throw new Error('NODE_ID environment variable is required')
  }

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${port}`)
  }

  startRelayServer({
    port,
    nodeId: nodeIdEnv,
    ipfsUrl,
    maxMessageSize: 1024 * 1024, // 1MB
    messageRetentionDays: 7,
  })
}
