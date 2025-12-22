/**
 * XMTP Node Wrapper
 *
 * Wraps XMTP's MLS functionality with Jeju's relay infrastructure.
 * Messages are encrypted with XMTP/MLS, transported via Jeju relay nodes.
 */

import { randomBytes } from 'node:crypto'
import type { Address } from 'viem'
import { z } from 'zod'
import { IPFSAddResponseSchema } from '../schemas'
import type {
  SyncState,
  XMTPEnvelope,
  XMTPIdentity,
  XMTPNodeConfig,
  XMTPNodeStats,
} from './types'

// Maximum sizes to prevent DoS
const MAX_CONNECTIONS = 10000
const MAX_IDENTITIES = 100000
const MAX_MESSAGE_HANDLERS = 100
const MAX_ENVELOPE_SIZE = 1024 * 1024 // 1MB

// Schema for validating decoded envelopes
const XMTPEnvelopeSchema = z.object({
  version: z.number().optional(),
  id: z.string().min(1).max(100),
  sender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  recipients: z
    .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/))
    .min(1)
    .max(1000),
  ciphertext: z.string().min(1), // base64 encoded
  contentTopic: z.string().min(1).max(500),
  timestamp: z.number().int().positive(),
  signature: z.string().min(1), // base64 encoded
})

// ============ Types ============

export interface NodeConnectionState {
  isConnected: boolean
  connectedAt?: number
  relayUrl: string
  peerCount: number
}

export type MessageHandler = (envelope: XMTPEnvelope) => Promise<void>

// ============ XMTP Node Class ============

/**
 * JejuXMTPNode wraps XMTP functionality with Jeju relay infrastructure.
 *
 * Flow:
 * 1. Receives MLS-encrypted messages from XMTP clients
 * 2. Wraps in Jeju envelope for routing
 * 3. Forwards through Jeju relay network
 * 4. Persists to IPFS for durability
 */
export class JejuXMTPNode {
  private config: XMTPNodeConfig
  private isRunning: boolean = false
  private startTime: number = 0
  private messageCount: number = 0
  private forwardCount: number = 0
  private connections: Map<string, WebSocket> = new Map()
  private messageHandlers: Set<MessageHandler> = new Set()
  private syncState: SyncState
  private identityCache: Map<string, XMTPIdentity> = new Map()
  private relayConnection: WebSocket | null = null

  constructor(config: XMTPNodeConfig) {
    this.config = config
    this.syncState = {
      lastSyncedBlock: 0,
      lastSyncedAt: 0,
      pendingMessages: 0,
      isSyncing: false,
    }
  }

  // ============ Lifecycle ============

  /**
   * Start the XMTP node
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Node already running')
    }

    console.log(`[XMTP Node ${this.config.nodeId}] Starting...`)

    // Connect to Jeju relay network
    await this.connectToRelay()

    // Initialize MLS state
    await this.initializeMLS()

    // Start sync process
    await this.startSync()

    this.isRunning = true
    this.startTime = Date.now()

    console.log(`[XMTP Node ${this.config.nodeId}] Started successfully`)
  }

  /**
   * Stop the XMTP node
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return

    console.log(`[XMTP Node ${this.config.nodeId}] Stopping...`)

    // Close relay connection
    this.relayConnection?.close()

    // Close all client connections
    for (const [, ws] of this.connections) {
      ws.close()
    }
    this.connections.clear()

    // Flush pending messages
    await this.flushPendingMessages()

    this.isRunning = false

    console.log(`[XMTP Node ${this.config.nodeId}] Stopped`)
  }

  // ============ Connection Management ============

  /**
   * Connect to Jeju relay network
   */
  private async connectToRelay(): Promise<void> {
    return new Promise((resolve) => {
      const wsUrl = `${this.config.jejuRelayUrl.replace('http', 'ws')}/ws`

      // In production, use actual WebSocket
      // For now, simulate connection
      console.log(`[XMTP Node] Connecting to relay: ${wsUrl}`)

      // Simulated connection for type safety
      setTimeout(() => {
        console.log(`[XMTP Node] Connected to relay`)
        resolve()
      }, 100)
    })
  }

  /**
   * Handle incoming relay message from WebSocket
   */
  async handleRelayMessage(data: Uint8Array): Promise<void> {
    // Decode envelope
    const envelope = this.decodeEnvelope(data)
    if (!envelope) return

    this.messageCount++

    // Forward to registered handlers
    for (const handler of this.messageHandlers) {
      await handler(envelope)
    }

    // Route to connected clients
    await this.routeToClients(envelope)
  }

  // ============ Message Handling ============

  /**
   * Process and forward an XMTP envelope
   */
  async processEnvelope(envelope: XMTPEnvelope): Promise<void> {
    this.messageCount++

    // Validate envelope
    if (!this.validateEnvelope(envelope)) {
      throw new Error('Invalid envelope')
    }

    // Persist to IPFS if configured
    if (this.config.ipfsUrl) {
      await this.persistToIPFS(envelope)
    }

    // Forward through Jeju relay
    await this.forwardToRelay(envelope)
    this.forwardCount++
  }

  /**
   * Forward envelope to Jeju relay network
   */
  private async forwardToRelay(envelope: XMTPEnvelope): Promise<void> {
    const payload = this.encodeEnvelope(envelope)

    // Send via relay connection
    if (this.relayConnection?.readyState === WebSocket.OPEN) {
      this.relayConnection.send(payload)
    } else {
      // Queue for later if not connected
      this.syncState.pendingMessages++
    }
  }

  /**
   * Route envelope to connected clients
   */
  private async routeToClients(envelope: XMTPEnvelope): Promise<void> {
    for (const recipient of envelope.recipients) {
      const connection = this.connections.get(recipient.toLowerCase())
      if (connection?.readyState === WebSocket.OPEN) {
        const payload = this.encodeEnvelope(envelope)
        connection.send(payload)
      }
    }
  }

  // ============ Identity Management ============

  /**
   * Register an XMTP identity
   */
  async registerIdentity(identity: XMTPIdentity): Promise<void> {
    const key = identity.address.toLowerCase()

    // Check limit to prevent memory exhaustion
    if (
      !this.identityCache.has(key) &&
      this.identityCache.size >= MAX_IDENTITIES
    ) {
      throw new Error('Identity cache at capacity')
    }

    this.identityCache.set(key, identity)

    // Store in Jeju key registry (would call contract)
    // Log truncated address only
    console.log(
      `[XMTP Node] Registered identity for ${identity.address.slice(0, 10)}...`,
    )
  }

  /**
   * Get identity by address
   */
  async getIdentity(address: Address): Promise<XMTPIdentity | null> {
    return this.identityCache.get(address.toLowerCase()) ?? null
  }

  /**
   * Lookup multiple identities
   */
  async lookupIdentities(
    addresses: Address[],
  ): Promise<Map<Address, XMTPIdentity>> {
    const result = new Map<Address, XMTPIdentity>()

    for (const address of addresses) {
      const identity = await this.getIdentity(address)
      if (identity) {
        result.set(address, identity)
      }
    }

    return result
  }

  // ============ MLS Operations ============

  /**
   * Initialize MLS state
   */
  private async initializeMLS(): Promise<void> {
    console.log(`[XMTP Node] Initializing MLS state...`)
    // MLS initialization would go here
    // Using XMTP's @xmtp/mls-client in production
  }

  // ============ Sync Operations ============

  /**
   * Start background sync
   */
  private async startSync(): Promise<void> {
    this.syncState.isSyncing = true
    console.log(
      `[XMTP Node] Starting sync from block ${this.syncState.lastSyncedBlock}`,
    )

    // Sync would run in background
    this.syncState.isSyncing = false
    this.syncState.lastSyncedAt = Date.now()
  }

  /**
   * Get current sync state
   */
  getSyncState(): SyncState {
    return { ...this.syncState }
  }

  // ============ IPFS Persistence ============

  /**
   * Persist envelope to IPFS
   */
  private async persistToIPFS(envelope: XMTPEnvelope): Promise<string | null> {
    if (!this.config.ipfsUrl) return null

    const data = this.encodeEnvelope(envelope)

    // Call IPFS API - Buffer.from creates a Node.js Buffer with proper ArrayBuffer backing
    const response = await fetch(`${this.config.ipfsUrl}/api/v0/add`, {
      method: 'POST',
      body: Buffer.from(data),
    })

    if (!response.ok) {
      console.error(`[XMTP Node] IPFS persist failed: ${response.statusText}`)
      return null
    }

    const rawResult: unknown = await response.json()
    const result = IPFSAddResponseSchema.parse(rawResult)
    return result.Hash
  }

  // ============ Message Handlers ============

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): void {
    // Check limit to prevent handler accumulation attacks
    if (this.messageHandlers.size >= MAX_MESSAGE_HANDLERS) {
      throw new Error('Too many message handlers registered')
    }
    this.messageHandlers.add(handler)
  }

  /**
   * Remove a message handler
   */
  offMessage(handler: MessageHandler): void {
    this.messageHandlers.delete(handler)
  }

  // ============ Client Connections ============

  /**
   * Register a client connection
   */
  registerClient(address: Address, ws: WebSocket): void {
    const key = address.toLowerCase()

    // Check limit to prevent DoS
    if (
      !this.connections.has(key) &&
      this.connections.size >= MAX_CONNECTIONS
    ) {
      throw new Error('Connection limit reached')
    }

    this.connections.set(key, ws)
  }

  /**
   * Unregister a client connection
   */
  unregisterClient(address: Address): void {
    this.connections.delete(address.toLowerCase())
  }

  // ============ Stats ============

  /**
   * Get node statistics
   */
  getStats(): XMTPNodeStats {
    return {
      nodeId: this.config.nodeId,
      uptime: this.isRunning
        ? Math.floor((Date.now() - this.startTime) / 1000)
        : 0,
      messagesProcessed: this.messageCount,
      messagesForwarded: this.forwardCount,
      activeConnections: this.connections.size,
      connectedPeers: Array.from(this.connections.keys()),
      storageUsedBytes: 0, // Would be calculated from persistence
    }
  }

  /**
   * Check if node is healthy
   */
  isHealthy(): boolean {
    return this.isRunning
  }

  // ============ Utility Methods ============

  /**
   * Encode envelope to bytes
   */
  private encodeEnvelope(envelope: XMTPEnvelope): Uint8Array {
    // In production, use proper serialization (protobuf)
    const json = JSON.stringify({
      ...envelope,
      ciphertext: Buffer.from(envelope.ciphertext).toString('base64'),
      signature: Buffer.from(envelope.signature).toString('base64'),
    })
    return new TextEncoder().encode(json)
  }

  /**
   * Decode envelope from bytes with size limits and validation
   */
  private decodeEnvelope(data: Uint8Array): XMTPEnvelope | null {
    // Size limit check
    if (data.length > MAX_ENVELOPE_SIZE) {
      console.error('[XMTP Node] Envelope too large, rejecting')
      return null
    }

    let json: string
    try {
      json = new TextDecoder().decode(data)
    } catch {
      return null
    }

    // Safe JSON parsing
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      return null
    }

    // Validate envelope structure to prevent prototype pollution
    const result = XMTPEnvelopeSchema.safeParse(parsed)
    if (!result.success) {
      console.error(
        '[XMTP Node] Invalid envelope format:',
        result.error.message,
      )
      return null
    }

    const validated = result.data

    return {
      version: validated.version ?? 1,
      id: validated.id,
      sender: validated.sender as Address,
      recipients: validated.recipients as Address[],
      ciphertext: Buffer.from(validated.ciphertext, 'base64'),
      contentTopic: validated.contentTopic,
      timestamp: validated.timestamp,
      signature: Buffer.from(validated.signature, 'base64'),
    }
  }

  /**
   * Validate envelope
   */
  private validateEnvelope(envelope: XMTPEnvelope): boolean {
    if (!envelope.id || !envelope.sender || !envelope.recipients.length) {
      return false
    }
    if (!envelope.ciphertext || envelope.ciphertext.length === 0) {
      return false
    }
    return true
  }

  /**
   * Flush pending messages (during shutdown)
   */
  private async flushPendingMessages(): Promise<void> {
    // Would flush any queued messages
    console.log(
      `[XMTP Node] Flushing ${this.syncState.pendingMessages} pending messages`,
    )
  }

  /**
   * Generate a unique message ID
   */
  static generateMessageId(): string {
    return randomBytes(16).toString('hex')
  }
}

// ============ Factory Function ============

/**
 * Create and start an XMTP node
 */
export async function createXMTPNode(
  config: XMTPNodeConfig,
): Promise<JejuXMTPNode> {
  const node = new JejuXMTPNode(config)
  await node.start()
  return node
}
