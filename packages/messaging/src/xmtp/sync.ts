/**
 * XMTP Sync Service
 *
 * Handles synchronization of XMTP messages across Jeju relay nodes.
 * Ensures message consistency and handles offline message queuing.
 */

import { createLogger } from '@jejunetwork/shared'
import { expectValid } from '@jejunetwork/types'

const log = createLogger('xmtp-sync')

import {
  IPFSAddResponseSchema,
  SyncEventsArraySchema,
  SyncPersistenceSchema,
} from '../schemas'
import type {
  SyncState,
  XMTPConversation,
  XMTPEnvelope,
  XMTPMessage,
} from './types'

export interface SyncEvent {
  type: 'message' | 'conversation' | 'identity' | 'group'
  id: string
  timestamp: number
  data: XMTPEnvelope | XMTPConversation | XMTPMessage | Record<string, unknown>
}

export interface SyncPeer {
  nodeId: string
  url: string
  lastSyncedAt: number
  cursor: string
}

/** Event handler functions for sync events */
export interface SyncEventHandlers {
  /** Called when a message event is received */
  onMessage?: (envelope: XMTPEnvelope) => Promise<void>
  /** Called when a conversation event is received */
  onConversation?: (conversation: XMTPConversation) => Promise<void>
  /** Called when an identity event is received */
  onIdentity?: (data: Record<string, unknown>) => Promise<void>
  /** Called when a group event is received */
  onGroup?: (data: Record<string, unknown>) => Promise<void>
}

export interface SyncServiceConfig {
  /** Sync interval in ms */
  syncIntervalMs: number
  /** Max events per batch */
  batchSize: number
  /** Persistence path */
  persistencePath?: string
  /** IPFS URL for backup */
  ipfsUrl?: string
  /** Max buffer size */
  maxBufferSize?: number
  /** Event handlers - at least one handler should be provided */
  handlers?: SyncEventHandlers
}

// Maximum event buffer size to prevent memory exhaustion
const DEFAULT_MAX_BUFFER_SIZE = 50000

/**
 * Manages sync state across XMTP nodes
 */
export class XMTPSyncService {
  private config: SyncServiceConfig
  private state: SyncState
  private peers: Map<string, SyncPeer> = new Map()
  private eventBuffer: SyncEvent[] = []
  private syncInterval: NodeJS.Timeout | null = null
  private isSyncing: boolean = false

  constructor(config?: Partial<SyncServiceConfig>) {
    this.config = {
      syncIntervalMs: config?.syncIntervalMs ?? 5000,
      batchSize: config?.batchSize ?? 100,
      persistencePath: config?.persistencePath,
      ipfsUrl: config?.ipfsUrl,
      maxBufferSize: config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
      handlers: config?.handlers,
    }

    // Warn if no handlers are configured
    if (!config?.handlers || Object.keys(config.handlers).length === 0) {
      log.warn(
        'No event handlers configured - sync events will not be processed',
      )
    }

    this.state = {
      lastSyncedBlock: 0,
      lastSyncedAt: 0,
      pendingMessages: 0,
      isSyncing: false,
    }
  }

  /**
   * Start the sync service
   */
  async start(): Promise<void> {
    log.info('Starting sync service')

    // Load persisted state
    await this.loadState()

    // Start sync loop
    this.syncInterval = setInterval(async () => {
      await this.runSyncCycle()
    }, this.config.syncIntervalMs)

    // Run initial sync
    await this.runSyncCycle()

    log.info('Sync service started')
  }

  /**
   * Stop the sync service
   */
  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
    }

    // Wait for current sync to complete
    while (this.isSyncing) {
      await this.delay(100)
    }

    // Persist state
    await this.saveState()

    log.info('Sync service stopped')
  }

  /**
   * Run a sync cycle
   */
  private async runSyncCycle(): Promise<void> {
    if (this.isSyncing) return

    this.isSyncing = true
    this.state.isSyncing = true

    try {
      // Sync with each peer
      for (const [, peer] of this.peers) {
        await this.syncWithPeer(peer)
      }

      // Process buffered events
      await this.processEventBuffer()

      // Update state
      this.state.lastSyncedAt = Date.now()
    } finally {
      this.isSyncing = false
      this.state.isSyncing = false
    }
  }

  /**
   * Sync with a specific peer
   */
  private async syncWithPeer(peer: SyncPeer): Promise<void> {
    const events = await this.fetchEventsFromPeer(peer).catch(
      (error: Error) => {
        log.error('Failed to sync with peer', {
          nodeId: peer.nodeId,
          error: error.message,
        })
        return []
      },
    )

    for (const event of events) {
      if (
        this.eventBuffer.length >=
        (this.config.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE)
      ) {
        log.warn('Event buffer full, dropping oldest events')
        const toRemove = Math.ceil(this.eventBuffer.length * 0.1)
        this.eventBuffer.splice(0, toRemove)
      }
      this.eventBuffer.push(event)
    }

    const lastEvent = events[events.length - 1]
    if (lastEvent) {
      peer.lastSyncedAt = Date.now()
      peer.cursor = lastEvent.id
    }
  }

  /**
   * Fetch events from peer
   */
  private async fetchEventsFromPeer(peer: SyncPeer): Promise<SyncEvent[]> {
    const response = await fetch(`${peer.url}/api/sync/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cursor: peer.cursor,
        limit: this.config.batchSize,
      }),
    })

    if (!response.ok) {
      throw new Error(`Peer sync failed: ${response.status}`)
    }

    const rawEvents: unknown = await response.json()
    return expectValid(SyncEventsArraySchema, rawEvents, 'peer sync events')
  }

  /**
   * Process buffered events
   */
  private async processEventBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return

    // Sort by timestamp
    this.eventBuffer.sort((a, b) => a.timestamp - b.timestamp)

    // Process in batches
    while (this.eventBuffer.length > 0) {
      const batch = this.eventBuffer.splice(0, this.config.batchSize)
      await this.processBatch(batch)
    }
  }

  /**
   * Process a batch of events
   */
  private async processBatch(events: SyncEvent[]): Promise<void> {
    for (const event of events) {
      await this.processEvent(event)
    }

    // Persist after batch
    if (this.config.persistencePath) {
      await this.saveState()
    }
  }

  /**
   * Process a single event
   */
  private async processEvent(event: SyncEvent): Promise<void> {
    const handlers = this.config.handlers

    switch (event.type) {
      case 'message':
        if (handlers?.onMessage) {
          await handlers.onMessage(event.data as XMTPEnvelope)
        }
        break
      case 'conversation':
        if (handlers?.onConversation) {
          await handlers.onConversation(event.data as XMTPConversation)
        }
        break
      case 'identity':
        if (handlers?.onIdentity) {
          await handlers.onIdentity(event.data as Record<string, unknown>)
        }
        break
      case 'group':
        if (handlers?.onGroup) {
          await handlers.onGroup(event.data as Record<string, unknown>)
        }
        break
    }

    // Update sync state
    if (event.timestamp > this.state.lastSyncedAt) {
      this.state.lastSyncedAt = event.timestamp
    }
  }

  /**
   * Add a sync peer
   */
  addPeer(nodeId: string, url: string): void {
    this.peers.set(nodeId, {
      nodeId,
      url,
      lastSyncedAt: 0,
      cursor: '',
    })
  }

  /**
   * Remove a sync peer
   */
  removePeer(nodeId: string): void {
    this.peers.delete(nodeId)
  }

  /**
   * Get all peers
   */
  getPeers(): SyncPeer[] {
    return Array.from(this.peers.values())
  }

  /**
   * Submit an event to be synced
   */
  async submitEvent(event: Omit<SyncEvent, 'timestamp'>): Promise<void> {
    const fullEvent: SyncEvent = {
      ...event,
      timestamp: Date.now(),
    }

    // Check buffer size limit to prevent memory exhaustion
    if (
      this.eventBuffer.length >=
      (this.config.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE)
    ) {
      log.warn('Event buffer full, dropping oldest events')
      const toRemove = Math.ceil(this.eventBuffer.length * 0.1)
      this.eventBuffer.splice(0, toRemove)
    }

    this.eventBuffer.push(fullEvent)

    // Broadcast to peers
    await this.broadcastEvent(fullEvent)
  }

  /**
   * Broadcast event to all peers
   */
  private async broadcastEvent(event: SyncEvent): Promise<void> {
    const broadcasts = Array.from(this.peers.values()).map((peer) =>
      fetch(`${peer.url}/api/sync/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }),
    )

    await Promise.allSettled(broadcasts)
  }

  /**
   * Load persisted state with validation
   */
  private async loadState(): Promise<void> {
    if (!this.config.persistencePath) return

    const file = Bun.file(this.config.persistencePath)
    if (!(await file.exists())) {
      return
    }

    const rawData: unknown = await file.json().catch(() => null)
    if (!rawData) {
      log.debug('Failed to parse persistence file')
      return
    }

    const result = SyncPersistenceSchema.safeParse(rawData)
    if (!result.success) {
      log.debug('Invalid persistence data', { error: result.error.message })
      return
    }

    this.state = result.data.state
    for (const peer of result.data.peers) {
      this.peers.set(peer.nodeId, peer)
    }
  }

  /**
   * Save state to disk
   */
  private async saveState(): Promise<void> {
    if (!this.config.persistencePath) return

    await Bun.write(
      this.config.persistencePath,
      JSON.stringify(
        {
          state: this.state,
          peers: Array.from(this.peers.values()),
        },
        null,
        2,
      ),
    )
  }

  /**
   * Backup state to IPFS
   */
  async backupToIPFS(): Promise<string | null> {
    if (!this.config.ipfsUrl) return null

    const data = JSON.stringify({
      state: this.state,
      peers: Array.from(this.peers.values()),
      timestamp: Date.now(),
    })

    const response = await fetch(`${this.config.ipfsUrl}/api/v0/add`, {
      method: 'POST',
      body: data,
    })

    if (!response.ok) return null

    const rawResult: unknown = await response.json()
    const result = expectValid(IPFSAddResponseSchema, rawResult, 'IPFS add')
    return result.Hash
  }

  /**
   * Restore from IPFS
   */
  async restoreFromIPFS(hash: string): Promise<void> {
    if (!this.config.ipfsUrl) return

    // Validate IPFS hash format to prevent SSRF
    // CIDv0: starts with Qm, 46 chars total
    // CIDv1: starts with b (base32) or z (base58), variable length
    if (
      !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58}|z[1-9A-HJ-NP-Za-km-z]{48,})$/.test(
        hash,
      )
    ) {
      throw new Error('Invalid IPFS hash format')
    }

    const response = await fetch(
      `${this.config.ipfsUrl}/ipfs/${encodeURIComponent(hash)}`,
    )
    if (!response.ok) return

    const rawData: unknown = await response.json()
    const data = expectValid(
      SyncPersistenceSchema,
      rawData,
      'IPFS restore data',
    )

    this.state = data.state
    for (const peer of data.peers) {
      this.peers.set(peer.nodeId, peer)
    }
  }

  /**
   * Get sync state
   */
  getState(): SyncState {
    return { ...this.state }
  }

  /**
   * Get pending message count
   */
  getPendingCount(): number {
    return this.eventBuffer.length
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create and start a sync service
 */
export async function createSyncService(
  config?: Partial<SyncServiceConfig>,
): Promise<XMTPSyncService> {
  const service = new XMTPSyncService(config)
  await service.start()
  return service
}
