/**
 * XMTP Node Wrapper
 *
 * Wraps XMTP's MLS functionality with Jeju's relay infrastructure.
 * Messages are encrypted with XMTP/MLS, transported via Jeju relay nodes.
 */

import { bytesToHex, randomBytes } from '@jejunetwork/shared'
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

// WebSocket reconnection configuration
const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 10

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

export interface NodeConnectionState {
  isConnected: boolean
  connectedAt?: number
  relayUrl: string
  peerCount: number
}

export type MessageHandler = (envelope: XMTPEnvelope) => Promise<void>

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
  private reconnectAttempts: number = 0
  private reconnectTimeout: NodeJS.Timeout | null = null
  private pendingEnvelopes: XMTPEnvelope[] = []
  private connectionPromise: Promise<void> | null = null

  constructor(config: XMTPNodeConfig) {
    this.config = config
    this.syncState = {
      lastSyncedBlock: 0,
      lastSyncedAt: 0,
      pendingMessages: 0,
      isSyncing: false,
    }
  }

  /**
   * Start the XMTP node
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Node already running')
    }

    console.log(`[XMTP Node ${this.config.nodeId}] Starting...`)

    // Connect to Jeju relay network (skip in test mode)
    if (!this.config.skipRelayConnection) {
      await this.connectToRelay().catch((err) => {
        console.warn(
          `[XMTP Node] Relay connection failed (continuing):`,
          err instanceof Error ? err.message : 'Unknown error',
        )
      })
    }

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

    // Mark as not running to prevent reconnection attempts
    this.isRunning = false

    // Cancel any pending reconnection
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Close relay connection
    if (this.relayConnection) {
      this.relayConnection.close(1000, 'Node shutting down')
      this.relayConnection = null
    }

    // Close all client connections
    for (const [, ws] of this.connections) {
      ws.close(1000, 'Node shutting down')
    }
    this.connections.clear()

    // Flush pending messages
    await this.flushPendingMessages()

    console.log(`[XMTP Node ${this.config.nodeId}] Stopped`)
  }

  /**
   * Connect to Jeju relay network with automatic reconnection
   */
  private async connectToRelay(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = this.establishRelayConnection()
    return this.connectionPromise.finally(() => {
      this.connectionPromise = null
    })
  }

  /**
   * Establish WebSocket connection to relay
   */
  private async establishRelayConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.buildWebSocketUrl(this.config.jejuRelayUrl)
      console.log(`[XMTP Node] Connecting to relay: ${wsUrl}`)

      const ws = new WebSocket(wsUrl)

      const connectionTimeout = setTimeout(() => {
        ws.close()
        reject(new Error(`Connection timeout to ${wsUrl}`))
      }, 10000)

      ws.onopen = () => {
        clearTimeout(connectionTimeout)
        this.relayConnection = ws
        this.reconnectAttempts = 0
        console.log(`[XMTP Node] Connected to relay`)

        // Subscribe to messages for this node
        const subscribeMessage = JSON.stringify({
          type: 'subscribe',
          nodeId: this.config.nodeId,
          topics: ['xmtp/*'],
        })
        ws.send(subscribeMessage)

        // Flush any pending envelopes
        this.flushPendingEnvelopes()

        resolve()
      }

      ws.onmessage = (event) => {
        this.handleWebSocketMessage(event)
      }

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout)
        this.relayConnection = null
        console.log(
          `[XMTP Node] Relay connection closed: ${event.code} ${event.reason}`,
        )

        if (this.isRunning) {
          this.scheduleReconnect()
        }
      }

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout)
        console.error(`[XMTP Node] WebSocket error:`, error)
        // onclose will be called after onerror
      }
    })
  }

  /**
   * Build WebSocket URL from HTTP URL
   */
  private buildWebSocketUrl(httpUrl: string): string {
    const url = httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    return url.endsWith('/') ? `${url}ws` : `${url}/ws`
  }

  /**
   * Handle incoming WebSocket message from relay
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    const data = event.data
    let bytes: Uint8Array

    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data)
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data)
    } else if (data instanceof Blob) {
      // Handle Blob asynchronously
      data.arrayBuffer().then((buffer) => {
        this.handleRelayMessage(new Uint8Array(buffer))
      })
      return
    } else {
      console.error('[XMTP Node] Unknown message type from relay')
      return
    }

    this.handleRelayMessage(bytes)
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[XMTP Node] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`,
      )
      return
    }

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS,
    )
    this.reconnectAttempts++

    console.log(
      `[XMTP Node] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`,
    )

    this.reconnectTimeout = setTimeout(() => {
      this.connectToRelay().catch((error) => {
        console.error(`[XMTP Node] Reconnect failed:`, error)
      })
    }, delay)
  }

  /**
   * Flush pending envelopes after reconnection
   */
  private flushPendingEnvelopes(): void {
    if (this.pendingEnvelopes.length === 0) return

    console.log(
      `[XMTP Node] Flushing ${this.pendingEnvelopes.length} pending envelopes`,
    )

    const envelopes = [...this.pendingEnvelopes]
    this.pendingEnvelopes = []

    for (const envelope of envelopes) {
      this.forwardToRelay(envelope).catch((error) => {
        console.error(`[XMTP Node] Failed to flush envelope:`, error)
        this.pendingEnvelopes.push(envelope)
      })
    }
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

    if (this.relayConnection?.readyState === WebSocket.OPEN) {
      this.relayConnection.send(payload)
    } else {
      // Queue for later if not connected
      this.pendingEnvelopes.push(envelope)
      this.syncState.pendingMessages = this.pendingEnvelopes.length
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

  /**
   * Initialize MLS state
   */
  private async initializeMLS(): Promise<void> {
    console.log(`[XMTP Node] Initializing MLS state...`)
    // MLS initialization would go here
    // Using XMTP's @xmtp/mls-client in production
  }

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

  /**
   * Get relay connection state
   */
  getConnectionState(): NodeConnectionState {
    return {
      isConnected: this.relayConnection?.readyState === WebSocket.OPEN,
      connectedAt: this.startTime,
      relayUrl: this.config.jejuRelayUrl,
      peerCount: this.connections.size,
    }
  }

  /**
   * Force reconnection to relay
   */
  async reconnect(): Promise<void> {
    if (this.relayConnection) {
      this.relayConnection.close(1000, 'Reconnecting')
      this.relayConnection = null
    }
    this.reconnectAttempts = 0
    await this.connectToRelay()
  }

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
    return bytesToHex(randomBytes(16))
  }
}

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
