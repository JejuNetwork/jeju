import { bytesToHex, createLogger, randomBytes } from '@jejunetwork/shared'
import type { Address } from 'viem'
import { z } from 'zod'

const log = createLogger('xmtp-node')

import { IPFSAddResponseSchema } from '../schemas'
import type {
  SyncState,
  XMTPEnvelope,
  XMTPIdentity,
  XMTPNodeConfig,
  XMTPNodeStats,
} from './types'

const MAX_CONNECTIONS = 10000
const MAX_IDENTITIES = 100000
const MAX_MESSAGE_HANDLERS = 100
const MAX_ENVELOPE_SIZE = 1024 * 1024
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

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Node already running')
    }

    log.info('Starting', { nodeId: this.config.nodeId })

    if (!this.config.skipRelayConnection) {
      await this.connectToRelay().catch((err) => {
        log.warn('Relay connection failed (continuing)', {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      })
    }

    await this.initializeMLS()
    await this.startSync()

    this.isRunning = true
    this.startTime = Date.now()

    log.info('Started successfully', { nodeId: this.config.nodeId })
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return

    log.info('Stopping', { nodeId: this.config.nodeId })

    this.isRunning = false

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.relayConnection) {
      this.relayConnection.close(1000, 'Node shutting down')
      this.relayConnection = null
    }

    for (const [, ws] of this.connections) {
      ws.close(1000, 'Node shutting down')
    }
    this.connections.clear()
    await this.flushPendingMessages()

    log.info('Stopped', { nodeId: this.config.nodeId })
  }

  private async connectToRelay(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = this.establishRelayConnection()
    return this.connectionPromise.finally(() => {
      this.connectionPromise = null
    })
  }

  private async establishRelayConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.buildWebSocketUrl(this.config.jejuRelayUrl)
      log.info('Connecting to relay', { wsUrl })

      const ws = new WebSocket(wsUrl)

      const connectionTimeout = setTimeout(() => {
        ws.close()
        reject(new Error(`Connection timeout to ${wsUrl}`))
      }, 10000)

      ws.onopen = () => {
        clearTimeout(connectionTimeout)
        this.relayConnection = ws
        this.reconnectAttempts = 0
        log.info('Connected to relay')

        const subscribeMessage = JSON.stringify({
          type: 'subscribe',
          nodeId: this.config.nodeId,
          topics: ['xmtp/*'],
        })
        ws.send(subscribeMessage)
        this.flushPendingEnvelopes()

        resolve()
      }

      ws.onmessage = (event) => {
        this.handleWebSocketMessage(event)
      }

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout)
        this.relayConnection = null
        log.info('Relay connection closed', {
          code: event.code,
          reason: event.reason,
        })

        if (this.isRunning) {
          this.scheduleReconnect()
        }
      }

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout)
        log.error('WebSocket error', { error: String(error) })
      }
    })
  }

  private buildWebSocketUrl(httpUrl: string): string {
    const url = httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    return url.endsWith('/') ? `${url}ws` : `${url}/ws`
  }

  private handleWebSocketMessage(event: MessageEvent): void {
    const data = event.data
    let bytes: Uint8Array

    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data)
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data)
    } else if (data instanceof Blob) {
      data.arrayBuffer().then((buffer) => {
        this.handleRelayMessage(new Uint8Array(buffer))
      })
      return
    } else {
      log.error('Unknown message type from relay')
      return
    }

    this.handleRelayMessage(bytes)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error('Max reconnect attempts reached', {
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      })
      return
    }

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    )
    this.reconnectAttempts++

    log.info('Scheduling reconnect attempt', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    })

    this.reconnectTimeout = setTimeout(() => {
      this.connectToRelay().catch((error) => {
        log.error('Reconnect failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }, delay)
  }

  private flushPendingEnvelopes(): void {
    if (this.pendingEnvelopes.length === 0) return

    log.info('Flushing pending envelopes', {
      count: this.pendingEnvelopes.length,
    })

    const envelopes = [...this.pendingEnvelopes]
    this.pendingEnvelopes = []

    for (const envelope of envelopes) {
      this.forwardToRelay(envelope)
    }
  }

  async handleRelayMessage(data: Uint8Array): Promise<void> {
    const envelope = this.decodeEnvelope(data)
    if (!envelope) return

    this.messageCount++

    for (const handler of this.messageHandlers) {
      await handler(envelope)
    }

    this.routeToClients(envelope)
  }

  async processEnvelope(envelope: XMTPEnvelope): Promise<void> {
    if (!this.validateEnvelope(envelope)) {
      throw new Error('Invalid envelope')
    }

    this.messageCount++

    if (this.config.ipfsUrl) {
      await this.persistToIPFS(envelope)
    }

    this.forwardToRelay(envelope)
    this.forwardCount++
  }

  private forwardToRelay(envelope: XMTPEnvelope): void {
    if (this.relayConnection?.readyState === WebSocket.OPEN) {
      this.relayConnection.send(this.encodeEnvelope(envelope))
    } else {
      this.pendingEnvelopes.push(envelope)
      this.syncState.pendingMessages = this.pendingEnvelopes.length
    }
  }

  private routeToClients(envelope: XMTPEnvelope): void {
    const payload = this.encodeEnvelope(envelope)
    for (const recipient of envelope.recipients) {
      const conn = this.connections.get(recipient.toLowerCase())
      if (conn?.readyState === WebSocket.OPEN) {
        conn.send(payload)
      }
    }
  }

  async registerIdentity(identity: XMTPIdentity): Promise<void> {
    const key = identity.address.toLowerCase()
    if (
      !this.identityCache.has(key) &&
      this.identityCache.size >= MAX_IDENTITIES
    ) {
      throw new Error('Identity cache at capacity')
    }

    this.identityCache.set(key, identity)
    log.info('Registered identity', {
      address: `${identity.address.slice(0, 10)}...`,
    })
  }

  async getIdentity(address: Address): Promise<XMTPIdentity | null> {
    return this.identityCache.get(address.toLowerCase()) ?? null
  }

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

  private async initializeMLS(): Promise<void> {
    log.info('Initializing MLS state')
    this.identityCache.clear()
    this.messageHandlers.clear()

    if (this.config.persistenceDir) {
      await this.loadPersistedIdentities()
    }

    log.info('MLS state initialized')
  }

  private async loadPersistedIdentities(): Promise<void> {
    if (!this.config.persistenceDir) return

    const identityFile = `${this.config.persistenceDir}/identities.json`
    const file = Bun.file(identityFile)
    const exists = await file.exists().catch(() => false)

    if (!exists) return

    const data: { identities: XMTPIdentity[] } = await file
      .json()
      .catch(() => ({ identities: [] }))

    for (const identity of data.identities) {
      this.identityCache.set(identity.address.toLowerCase(), identity)
    }

    log.info('Loaded persisted identities', { count: data.identities.length })
  }

  private async startSync(): Promise<void> {
    if (this.syncState.isSyncing) {
      log.debug('Sync already in progress')
      return
    }

    this.syncState.isSyncing = true
    log.info('Starting sync', { fromTimestamp: this.syncState.lastSyncedAt })

    if (this.config.jejuRelayUrl) {
      const response = await fetch(
        `${this.config.jejuRelayUrl}/api/sync?nodeId=${encodeURIComponent(this.config.nodeId)}&since=${this.syncState.lastSyncedAt}`,
      ).catch(() => null)

      if (response?.ok) {
        const data: { messages: XMTPEnvelope[]; lastTimestamp: number } =
          await response
            .json()
            .catch(() => ({ messages: [], lastTimestamp: 0 }))

        for (const envelope of data.messages) {
          this.messageCount++
          for (const handler of this.messageHandlers) {
            await handler(envelope).catch((err) => {
              log.error('Handler error', {
                error: err instanceof Error ? err.message : 'Unknown error',
              })
            })
          }
        }

        this.syncState.pendingMessages = this.pendingEnvelopes.length
        if (data.lastTimestamp > this.syncState.lastSyncedAt) {
          this.syncState.lastSyncedAt = data.lastTimestamp
        }

        log.info('Synced messages', { count: data.messages.length })
      }
    }

    this.syncState.isSyncing = false
    this.syncState.lastSyncedAt = Date.now()
  }

  getSyncState(): SyncState {
    return { ...this.syncState }
  }

  private async persistToIPFS(envelope: XMTPEnvelope): Promise<string | null> {
    if (!this.config.ipfsUrl) return null

    const response = await fetch(`${this.config.ipfsUrl}/api/v0/add`, {
      method: 'POST',
      body: Buffer.from(this.encodeEnvelope(envelope)),
    })

    if (!response.ok) {
      log.error('IPFS persist failed', { status: response.statusText })
      return null
    }

    const result = IPFSAddResponseSchema.parse(await response.json())
    return result.Hash
  }

  onMessage(handler: MessageHandler): void {
    if (this.messageHandlers.size >= MAX_MESSAGE_HANDLERS) {
      throw new Error('Too many message handlers registered')
    }
    this.messageHandlers.add(handler)
  }

  offMessage(handler: MessageHandler): void {
    this.messageHandlers.delete(handler)
  }

  registerClient(address: Address, ws: WebSocket): void {
    const key = address.toLowerCase()
    if (
      !this.connections.has(key) &&
      this.connections.size >= MAX_CONNECTIONS
    ) {
      throw new Error('Connection limit reached')
    }

    this.connections.set(key, ws)
  }

  unregisterClient(address: Address): void {
    this.connections.delete(address.toLowerCase())
  }

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
      storageUsedBytes: this.calculateStorageUsed(),
    }
  }

  private calculateStorageUsed(): number {
    let bytes = 0
    for (const identity of this.identityCache.values()) {
      bytes += identity.address.length * 2
      bytes += identity.installationId.length
      if (identity.keyBundle) {
        bytes += identity.keyBundle.identityKey.length
        bytes += identity.keyBundle.preKey.length
        bytes += identity.keyBundle.preKeySignature.length
      }
    }
    for (const envelope of this.pendingEnvelopes) {
      bytes += envelope.ciphertext.length
      bytes += envelope.signature.length
      bytes += envelope.sender.length * 2
      bytes += envelope.contentTopic.length * 2
      for (const recipient of envelope.recipients) {
        bytes += recipient.length * 2
      }
    }

    return bytes
  }

  isHealthy(): boolean {
    return this.isRunning
  }

  getConnectionState(): NodeConnectionState {
    return {
      isConnected: this.relayConnection?.readyState === WebSocket.OPEN,
      connectedAt: this.startTime,
      relayUrl: this.config.jejuRelayUrl,
      peerCount: this.connections.size,
    }
  }

  async reconnect(): Promise<void> {
    if (this.relayConnection) {
      this.relayConnection.close(1000, 'Reconnecting')
      this.relayConnection = null
    }
    this.reconnectAttempts = 0
    await this.connectToRelay()
  }

  private encodeEnvelope(envelope: XMTPEnvelope): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({
        ...envelope,
        ciphertext: Buffer.from(envelope.ciphertext).toString('base64'),
        signature: Buffer.from(envelope.signature).toString('base64'),
      }),
    )
  }

  private decodeEnvelope(data: Uint8Array): XMTPEnvelope | null {
    if (data.length > MAX_ENVELOPE_SIZE) {
      log.error('Envelope too large, rejecting', {
        size: data.length,
        maxSize: MAX_ENVELOPE_SIZE,
      })
      return null
    }

    let json: string
    try {
      json = new TextDecoder().decode(data)
    } catch {
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      return null
    }

    const result = XMTPEnvelopeSchema.safeParse(parsed)
    if (!result.success) {
      log.error('Invalid envelope format', { error: result.error.message })
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

  private validateEnvelope(envelope: XMTPEnvelope): boolean {
    return !!(
      envelope.id &&
      envelope.sender &&
      envelope.recipients.length &&
      envelope.ciphertext?.length
    )
  }

  private async flushPendingMessages(): Promise<void> {
    if (this.pendingEnvelopes.length === 0) {
      log.debug('No pending messages to flush')
      return
    }

    log.info('Flushing pending messages to persistence', {
      count: this.pendingEnvelopes.length,
    })

    if (this.config.persistenceDir) {
      const pendingFile = `${this.config.persistenceDir}/pending-messages.json`
      const pendingData = this.pendingEnvelopes.map((e) => ({
        ...e,
        ciphertext: Buffer.from(e.ciphertext).toString('base64'),
        signature: Buffer.from(e.signature).toString('base64'),
      }))

      await Bun.write(pendingFile, JSON.stringify(pendingData, null, 2))
      log.info('Persisted pending messages', {
        count: pendingData.length,
        file: pendingFile,
      })
    }
    this.pendingEnvelopes = []
    this.syncState.pendingMessages = 0
  }

  static generateMessageId(): string {
    return bytesToHex(randomBytes(16))
  }
}

export async function createXMTPNode(
  config: XMTPNodeConfig,
): Promise<JejuXMTPNode> {
  const node = new JejuXMTPNode(config)
  await node.start()
  return node
}
