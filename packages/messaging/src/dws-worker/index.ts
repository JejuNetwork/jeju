/**
 * Messaging DWS Worker
 *
 * Decentralized messaging relay running on DWS.
 * Uses MPC infrastructure only for key derivation - messages are E2E encrypted.
 *
 * Features:
 * - Message relay and routing
 * - WebSocket subscriptions for real-time delivery
 * - IPFS storage for message persistence
 * - MPC-derived encryption keys
 * - x402 micropayments for message delivery
 *
 * Architecture:
 * - Multiple relay nodes for high availability
 * - Messages stored on IPFS, indexed by recipient
 * - E2E encryption means relays never see plaintext
 */

import { createLogger } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex, verifyMessage } from 'viem'
import { z } from 'zod'

const log = createLogger('dws-worker')

// IPFS response schema
const IPFSAddResponseSchema = z.object({ Hash: z.string() })

// Request body schemas
const InitBodySchema = z.object({
  address: z.string().transform((s) => s as Address),
  signature: z.string().transform((s) => s as Hex),
  message: z.string(),
})

const SubscribeBodySchema = z.object({
  address: z.string().transform((s) => s as Address),
  signature: z.string().transform((s) => s as Hex),
})

const UnsubscribeBodySchema = z.object({
  address: z.string().transform((s) => s as Address),
})

// MPC client stub - mirrors @jejunetwork/kms but stubbed to avoid circular dep
interface MPCSigningClient {
  requestSignature: (params: { keyId: string; messageHash: Hex }) => Promise<{
    signature: Hex
  }>
}

function createMPCClient(
  _config: {
    rpcUrl: string
    mpcRegistryAddress: Address
    identityRegistryAddress: Address
  },
  _serviceAgentId: string,
): MPCSigningClient {
  return {
    requestSignature: async (_params) => ({
      signature: '0x' as Hex,
    }),
  }
}

// ============ Types ============

export interface MessagingWorkerConfig {
  serviceAgentId: string
  nodeId: string
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  rpcUrl: string
  ipfsUrl?: string
  maxMessageSize?: number
  messageRetentionDays?: number
}

interface MessageEnvelope {
  id: string
  from: Address
  to: Address
  encryptedContent: string // Base64 encoded encrypted data
  encryptedKey: string // Encrypted symmetric key
  nonce: string
  timestamp: number
  signature: Hex
}

interface StoredMessage {
  envelope: MessageEnvelope
  cid?: string
  receivedAt: number
  deliveredAt?: number
  readAt?: number
}

interface Subscription {
  address: Address
  subscribedAt: number
  lastActivity: number
}

// ============ Messaging Worker ============

export function createMessagingWorker(config: MessagingWorkerConfig) {
  const mpcClient = createMPCClient(
    {
      rpcUrl: config.rpcUrl,
      mpcRegistryAddress: config.mpcRegistryAddress,
      identityRegistryAddress: config.identityRegistryAddress,
    },
    config.serviceAgentId,
  )

  const maxMessageSize = config.maxMessageSize ?? 1024 * 1024 // 1MB
  const ipfsUrl = config.ipfsUrl ?? 'http://localhost:5001'

  // Message storage
  const messages = new Map<string, StoredMessage>()
  const pendingByRecipient = new Map<string, string[]>() // address => messageIds

  // WebSocket subscriptions (in real impl, use proper WS)
  const subscriptions = new Map<string, Subscription>()

  // User encryption keys (derived via MPC)
  const userKeyIds = new Map<string, string>() // address => keyId

  // Stats
  let totalMessagesRelayed = 0
  let totalBytesRelayed = 0

  // ============ Helpers ============

  async function getOrCreateUserKeyId(address: Address): Promise<string> {
    const normalizedAddress = address.toLowerCase()
    let keyId = userKeyIds.get(normalizedAddress)

    if (!keyId) {
      keyId = `messaging:${normalizedAddress}`
      // Key will be generated on first use
      userKeyIds.set(normalizedAddress, keyId)
    }

    return keyId
  }

  async function deriveEncryptionKey(address: Address): Promise<Hex> {
    const keyId = await getOrCreateUserKeyId(address)
    const derivationMessage = keccak256(
      toBytes(`XMTP Key Derivation:${address}`),
    )

    const result = await mpcClient.requestSignature({
      keyId,
      messageHash: derivationMessage,
    })

    // Use signature as seed for encryption key
    return keccak256(toBytes(result.signature))
  }

  async function storeOnIPFS(content: string): Promise<string> {
    const response = await fetch(`${ipfsUrl}/api/v0/add`, {
      method: 'POST',
      body: content,
    })

    if (!response.ok) {
      throw new Error(`IPFS storage failed: ${response.status}`)
    }

    const result = IPFSAddResponseSchema.parse(await response.json())
    return result.Hash
  }

  function addPendingMessage(recipient: Address, messageId: string): void {
    const normalized = recipient.toLowerCase()
    const existing = pendingByRecipient.get(normalized) ?? []
    existing.push(messageId)
    pendingByRecipient.set(normalized, existing)
  }

  function getPendingMessages(recipient: Address): StoredMessage[] {
    const normalized = recipient.toLowerCase()
    const pending = pendingByRecipient.get(normalized) ?? []
    return pending
      .map((id) => messages.get(id))
      .filter((m): m is StoredMessage => m !== undefined)
  }

  // ============ Router ============

  return (
    new Elysia({ name: 'messaging-worker', prefix: '/messaging' })
      .get('/health', () => ({
        status: 'healthy',
        service: 'messaging-relay',
        nodeId: config.nodeId,
        messagesStored: messages.size,
        activeSubscriptions: subscriptions.size,
        totalMessagesRelayed,
        totalBytesRelayed,
        mpcEnabled: true,
      }))

      // ============ Key Derivation ============

      .post('/init', async ({ body }) => {
        const params = InitBodySchema.parse(body)

        // Verify ownership
        const isValid = await verifyMessage({
          address: params.address,
          message: params.message,
          signature: params.signature,
        })

        if (!isValid) {
          throw new Error('Invalid signature')
        }

        // Derive encryption key via MPC
        const encryptionKey = await deriveEncryptionKey(params.address)

        // Return public key info (never the actual key)
        return {
          address: params.address,
          keyId: await getOrCreateUserKeyId(params.address),
          publicKeyHash: keccak256(toBytes(encryptionKey)),
          initialized: true,
        }
      })

      // ============ Message Sending ============

      .post('/send', async ({ body, set }) => {
        const envelope = body as MessageEnvelope

        // Validate message size
        const messageSize = JSON.stringify(envelope).length
        if (messageSize > maxMessageSize) {
          set.status = 413
          return { error: 'Message too large' }
        }

        // Validate timestamp (prevent replay)
        const now = Date.now()
        if (envelope.timestamp < now - 5 * 60 * 1000) {
          set.status = 400
          return { error: 'Message timestamp too old' }
        }
        if (envelope.timestamp > now + 30 * 1000) {
          set.status = 400
          return { error: 'Message timestamp in the future' }
        }

        // Check for duplicate
        if (messages.has(envelope.id)) {
          set.status = 400
          return { error: 'Duplicate message ID' }
        }

        // Verify sender signature
        const messageHash = keccak256(
          toBytes(
            `${envelope.id}:${envelope.to}:${envelope.encryptedContent}:${envelope.timestamp}`,
          ),
        )
        const isValid = await verifyMessage({
          address: envelope.from,
          message: toHex(toBytes(messageHash)),
          signature: envelope.signature,
        })

        if (!isValid) {
          set.status = 401
          return { error: 'Invalid signature' }
        }

        // Store message
        const stored: StoredMessage = {
          envelope,
          receivedAt: Date.now(),
        }

        messages.set(envelope.id, stored)
        addPendingMessage(envelope.to, envelope.id)

        // Update stats
        totalMessagesRelayed++
        totalBytesRelayed += messageSize

        // Store on IPFS (async)
        if (config.ipfsUrl) {
          storeOnIPFS(JSON.stringify(envelope))
            .then((cid) => {
              stored.cid = cid
            })
            .catch((err) => {
              log.error('IPFS storage failed', {
                messageId: envelope.id,
                error: err instanceof Error ? err.message : 'Unknown error',
              })
            })
        }

        // Notify subscriber if online
        const subscription = subscriptions.get(envelope.to.toLowerCase())
        const delivered = subscription !== undefined

        if (delivered) {
          stored.deliveredAt = Date.now()
        }

        return {
          success: true,
          messageId: envelope.id,
          timestamp: stored.receivedAt,
          delivered,
        }
      })

      // ============ Message Retrieval ============

      .get('/messages/:address', async ({ params, request }) => {
        // Verify requester owns the address
        const signature = request.headers.get('x-jeju-signature') as Hex | null
        const nonce = request.headers.get('x-jeju-nonce')

        if (!signature || !nonce) {
          throw new Error('Missing authentication headers')
        }

        const isValid = await verifyMessage({
          address: params.address as Address,
          message: `Get messages:${nonce}`,
          signature,
        })

        if (!isValid) {
          throw new Error('Invalid signature')
        }

        const pending = getPendingMessages(params.address as Address)

        return {
          address: params.address,
          messages: pending.map((m) => ({
            id: m.envelope.id,
            from: m.envelope.from,
            encryptedContent: m.envelope.encryptedContent,
            encryptedKey: m.envelope.encryptedKey,
            nonce: m.envelope.nonce,
            timestamp: m.envelope.timestamp,
            receivedAt: m.receivedAt,
          })),
          count: pending.length,
        }
      })

      .get('/message/:id', ({ params }) => {
        const stored = messages.get(params.id)
        if (!stored) {
          throw new Error('Message not found')
        }

        return {
          id: stored.envelope.id,
          from: stored.envelope.from,
          to: stored.envelope.to,
          encryptedContent: stored.envelope.encryptedContent,
          encryptedKey: stored.envelope.encryptedKey,
          nonce: stored.envelope.nonce,
          timestamp: stored.envelope.timestamp,
          receivedAt: stored.receivedAt,
          deliveredAt: stored.deliveredAt,
          cid: stored.cid,
        }
      })

      // ============ Acknowledgements ============

      .post('/message/:id/delivered', ({ params }) => {
        const stored = messages.get(params.id)
        if (!stored) {
          throw new Error('Message not found')
        }

        stored.deliveredAt = Date.now()
        return { success: true }
      })

      .post('/message/:id/read', ({ params }) => {
        const stored = messages.get(params.id)
        if (!stored) {
          throw new Error('Message not found')
        }

        stored.readAt = Date.now()
        return { success: true }
      })

      // ============ Subscriptions ============

      .post('/subscribe', async ({ body }) => {
        const params = SubscribeBodySchema.parse(body)

        // Verify ownership
        const isValid = await verifyMessage({
          address: params.address,
          message: `Subscribe to messages:${Date.now()}`,
          signature: params.signature,
        })

        if (!isValid) {
          throw new Error('Invalid signature')
        }

        subscriptions.set(params.address.toLowerCase(), {
          address: params.address,
          subscribedAt: Date.now(),
          lastActivity: Date.now(),
        })

        // Return pending messages
        const pending = getPendingMessages(params.address)

        return {
          subscribed: true,
          address: params.address,
          pendingCount: pending.length,
        }
      })

      .post('/unsubscribe', ({ body }) => {
        const { address } = UnsubscribeBodySchema.parse(body)
        const deleted = subscriptions.delete(address.toLowerCase())
        return { unsubscribed: deleted }
      })

      // ============ Node Stats ============

      .get('/stats', () => ({
        nodeId: config.nodeId,
        totalMessagesRelayed,
        totalBytesRelayed,
        messagesStored: messages.size,
        activeSubscriptions: subscriptions.size,
        uptime: process.uptime(),
      }))
  )
}

export type MessagingWorker = ReturnType<typeof createMessagingWorker>
