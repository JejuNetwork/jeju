/**
 * CDN GossipSub Coordinator
 *
 * Implements CDN coordination using libp2p GossipSub for:
 * - Global cache invalidation propagation
 * - Hot content replication across regions
 * - Node metrics sharing
 * - Peer discovery and health monitoring
 *
 * Uses libp2p with:
 * - GossipSub for pub/sub messaging
 * - Kademlia DHT for peer discovery
 * - Noise for encryption
 * - Yamux for multiplexing
 */

import { EventEmitter } from 'node:events'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify, identifyPush } from '@libp2p/identify'
import { kadDHT } from '@libp2p/kad-dht'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p, type Libp2p } from 'libp2p'
import { LRUCache } from 'lru-cache'
import {
  type CacheInvalidation,
  CacheInvalidationSchema,
  type CDNCoordinationConfig,
  type CDNMessage,
  CDNMessageType,
  CDNTopics,
  type ConnectedNode,
  type ContentReplicate,
  ContentReplicateSchema,
  type HotContent,
  HotContentSchema,
  type InvalidationResult,
  type MagnetAnnounce,
  MagnetAnnounceSchema,
  type NodeAnnouncement,
  NodeAnnouncementSchema,
  type NodeMetrics,
  NodeMetricsSchema,
  type ReplicationResult,
} from './types'

// Message ID generation for deduplication
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// Parse and validate incoming messages
function parseMessage(data: Uint8Array): CDNMessage | null {
  try {
    const str = new TextDecoder().decode(data)
    const json = JSON.parse(str)

    // Route to appropriate schema based on type
    switch (json.type) {
      case CDNMessageType.CACHE_INVALIDATION:
        return CacheInvalidationSchema.parse(json)
      case CDNMessageType.CONTENT_REPLICATE:
        return ContentReplicateSchema.parse(json)
      case CDNMessageType.NODE_METRICS:
        return NodeMetricsSchema.parse(json)
      case CDNMessageType.NODE_JOIN:
      case CDNMessageType.NODE_LEAVE:
        return NodeAnnouncementSchema.parse(json)
      case CDNMessageType.HOT_CONTENT:
        return HotContentSchema.parse(json)
      case CDNMessageType.MAGNET_ANNOUNCE:
        return MagnetAnnounceSchema.parse(json)
      default:
        console.warn('[CDN] Unknown message type:', json.type)
        return null
    }
  } catch (err) {
    console.error('[CDN] Failed to parse message:', err)
    return null
  }
}

export class CDNGossipCoordinator extends EventEmitter {
  private config: CDNCoordinationConfig
  private node: Libp2p | null = null
  private connectedNodes: Map<string, ConnectedNode> = new Map()
  private messageCache: LRUCache<string, boolean>
  private metricsInterval: ReturnType<typeof setInterval> | null = null
  private hotContentTracker: Map<string, number> = new Map()
  private magnetIndex: Map<string, string> = new Map() // cid -> magnetUri
  private started = false

  // Event handlers
  private invalidationHandlers: Array<(msg: CacheInvalidation) => void> = []
  private replicationHandlers: Array<(msg: ContentReplicate) => void> = []
  private metricsHandlers: Array<(msg: NodeMetrics) => void> = []
  private announcementHandlers: Array<(msg: NodeAnnouncement) => void> = []
  private hotContentHandlers: Array<(msg: HotContent) => void> = []
  private magnetHandlers: Array<(msg: MagnetAnnounce) => void> = []

  constructor(config: CDNCoordinationConfig) {
    super()
    this.config = config
    this.messageCache = new LRUCache<string, boolean>({
      max: 10000,
      ttl: 60000, // 1 minute deduplication window
    })
  }

  /**
   * Initialize and start the libp2p node
   */
  async start(): Promise<void> {
    if (this.started) return

    console.log('[CDN] Starting GossipSub coordinator...')

    // Build bootstrap list
    const bootstrapList = this.config.bootstrapPeers.map((addr) =>
      multiaddr(addr),
    )

    // Create libp2p node
    this.node = await createLibp2p({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0', '/ip4/0.0.0.0/tcp/0/ws'],
      },
      transports: [tcp(), webSockets()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        dht: kadDHT({
          protocol: '/jeju/kad/1.0.0',
          clientMode: false,
        }),
        pubsub: gossipsub({
          allowPublishToZeroTopicPeers: true,
          emitSelf: false,
          fallbackToFloodsub: true,
          D: this.config.meshSize,
          Dlo: Math.max(1, this.config.meshSize - 2),
          Dhi: this.config.meshSize + 2,
          heartbeatInterval: 1000,
          mcacheLength: 5,
          mcacheGossip: 3,
        }),
      },
      peerDiscovery:
        bootstrapList.length > 0
          ? [bootstrap({ list: bootstrapList.map((m) => m.toString()) })]
          : [],
    })

    // Subscribe to topics
    // biome-ignore lint/suspicious/noExplicitAny: libp2p services are dynamically typed
    const pubsub = (this.node.services as Record<string, unknown>).pubsub as {
      subscribe: (topic: string) => void
      addEventListener: (
        event: string,
        handler: (evt: { detail: { topic: string; data: Uint8Array } }) => void,
      ) => void
      publish: (topic: string, data: Uint8Array) => Promise<void>
    }
    if (!pubsub) {
      throw new Error('PubSub service not available')
    }

    // Subscribe to all CDN topics
    for (const topic of Object.values(CDNTopics)) {
      pubsub.subscribe(topic)
    }

    // Set up message handlers
    pubsub.addEventListener(
      'message',
      (evt: { detail: { topic: string; data: Uint8Array } }) => {
        this.handleMessage(evt.detail.topic, evt.detail.data)
      },
    )

    // Set up peer discovery handlers
    this.node.addEventListener('peer:discovery', (evt) => {
      console.log(
        '[CDN] Discovered peer:',
        evt.detail.id.toString().slice(0, 12),
      )
    })

    this.node.addEventListener('peer:connect', (evt) => {
      console.log(
        '[CDN] Connected to peer:',
        evt.detail.toString().slice(0, 12),
      )
    })

    this.node.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString()
      this.handlePeerDisconnect(peerId)
    })

    // Start the node
    await this.node.start()

    // Get our addresses
    const addrs = this.node.getMultiaddrs()
    console.log('[CDN] Listening on:')
    for (const addr of addrs) {
      console.log(`  ${addr.toString()}`)
    }

    // Announce ourselves
    await this.announceJoin()

    // Start metrics broadcasting if enabled
    if (this.config.broadcastMetrics) {
      this.startMetricsBroadcast()
    }

    this.started = true
    console.log('[CDN] GossipSub coordinator started')
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    if (!this.started) return

    console.log('[CDN] Stopping GossipSub coordinator...')

    // Announce leaving
    await this.announceLeave()

    // Stop metrics broadcast
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval)
      this.metricsInterval = null
    }

    // Stop libp2p
    if (this.node) {
      await this.node.stop()
      this.node = null
    }

    this.started = false
    console.log('[CDN] GossipSub coordinator stopped')
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(_topic: string, data: Uint8Array): void {
    const message = parseMessage(data)
    if (!message) return

    // Deduplicate based on requestId or nodeId+timestamp
    const msgKey =
      'requestId' in message
        ? message.requestId
        : `${'nodeId' in message ? message.nodeId : 'unknown'}-${message.timestamp}`

    if (this.messageCache.has(msgKey)) {
      return // Already processed
    }
    this.messageCache.set(msgKey, true)

    // Route to appropriate handlers
    switch (message.type) {
      case CDNMessageType.CACHE_INVALIDATION:
        for (const handler of this.invalidationHandlers) {
          handler(message)
        }
        break

      case CDNMessageType.CONTENT_REPLICATE:
        for (const handler of this.replicationHandlers) {
          handler(message)
        }
        break

      case CDNMessageType.NODE_METRICS:
        this.updateNodeMetrics(message)
        for (const handler of this.metricsHandlers) {
          handler(message)
        }
        break

      case CDNMessageType.NODE_JOIN:
      case CDNMessageType.NODE_LEAVE:
        this.handleNodeAnnouncement(message)
        for (const handler of this.announcementHandlers) {
          handler(message)
        }
        break

      case CDNMessageType.HOT_CONTENT:
        for (const handler of this.hotContentHandlers) {
          handler(message)
        }
        break

      case CDNMessageType.MAGNET_ANNOUNCE:
        this.magnetIndex.set(message.cid, message.magnetUri)
        this.emit('magnet:received', {
          cid: message.cid,
          magnetUri: message.magnetUri,
        })
        for (const handler of this.magnetHandlers) {
          handler(message)
        }
        break
    }
  }

  /**
   * Handle peer disconnect
   */
  private handlePeerDisconnect(peerId: string): void {
    // Find and remove the disconnected node
    for (const [nodeId, node] of Array.from(this.connectedNodes.entries())) {
      if (node.peerId === peerId) {
        this.connectedNodes.delete(nodeId)
        console.log('[CDN] Node disconnected:', nodeId)
        break
      }
    }
  }

  /**
   * Handle node announcements
   */
  private handleNodeAnnouncement(announcement: NodeAnnouncement): void {
    if (announcement.type === CDNMessageType.NODE_JOIN) {
      this.connectedNodes.set(announcement.nodeId, {
        nodeId: announcement.nodeId,
        peerId: announcement.peerId,
        region: announcement.region as import('./types').CDNRegion,
        endpoint: announcement.endpoint,
        capabilities: announcement.capabilities,
        lastSeen: Date.now(),
      })
      console.log(
        '[CDN] Node joined:',
        announcement.nodeId,
        'in',
        announcement.region,
      )
    } else {
      this.connectedNodes.delete(announcement.nodeId)
      console.log('[CDN] Node left:', announcement.nodeId)
    }
  }

  /**
   * Update node metrics from received message
   */
  private updateNodeMetrics(metrics: NodeMetrics): void {
    const node = this.connectedNodes.get(metrics.nodeId)
    if (node) {
      node.lastSeen = Date.now()
      node.metrics = metrics.metrics
    }
  }

  /**
   * Publish a message to a topic
   */
  private async publish(topic: string, message: CDNMessage): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }

    const pubsub = (this.node.services as Record<string, unknown>).pubsub as
      | { publish: (topic: string, data: Uint8Array) => Promise<void> }
      | undefined
    if (!pubsub) {
      throw new Error('PubSub service not available')
    }

    const data = new TextEncoder().encode(JSON.stringify(message))
    await pubsub.publish(topic, data)
  }

  /**
   * Announce this node joining the network
   */
  private async announceJoin(): Promise<void> {
    if (!this.node) return

    const announcement: NodeAnnouncement = {
      type: CDNMessageType.NODE_JOIN,
      nodeId: this.config.nodeId,
      peerId: this.node.peerId.toString(),
      region: this.config.region,
      endpoint: this.config.endpoint,
      capabilities: ['cache', 'cdn'],
      timestamp: Date.now(),
    }

    await this.publish(CDNTopics.ANNOUNCEMENTS, announcement)
  }

  /**
   * Announce this node leaving the network
   */
  private async announceLeave(): Promise<void> {
    if (!this.node) return

    const announcement: NodeAnnouncement = {
      type: CDNMessageType.NODE_LEAVE,
      nodeId: this.config.nodeId,
      peerId: this.node.peerId.toString(),
      region: this.config.region,
      endpoint: this.config.endpoint,
      capabilities: [],
      timestamp: Date.now(),
    }

    await this.publish(CDNTopics.ANNOUNCEMENTS, announcement)
  }

  /**
   * Start periodic metrics broadcast
   */
  private startMetricsBroadcast(): void {
    this.metricsInterval = setInterval(async () => {
      await this.broadcastMetrics()
    }, this.config.metricsInterval)
  }

  /**
   * Broadcast current node metrics
   */
  private async broadcastMetrics(): Promise<void> {
    // Get current metrics (would be populated by the cache system)
    const metrics: NodeMetrics = {
      type: CDNMessageType.NODE_METRICS,
      nodeId: this.config.nodeId,
      region: this.config.region,
      timestamp: Date.now(),
      metrics: {
        cacheSize: 0, // Would be populated from edge cache
        cacheCapacity: 1024 * 1024 * 1024, // 1GB default
        cacheHitRate: 0,
        requestsPerSecond: 0,
        bandwidthUsed: 0,
        bandwidthCapacity: 1000 * 1024 * 1024, // 1Gbps default
        p99Latency: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        connections: this.connectedNodes.size,
        uptime: process.uptime(),
      },
      topContent: [],
    }

    await this.publish(CDNTopics.METRICS, metrics)
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Broadcast a cache invalidation request
   */
  async invalidateCache(
    patterns: string[],
    options: {
      siteId?: string
      regions?: string[]
      priority?: 'low' | 'normal' | 'high' | 'urgent'
    } = {},
  ): Promise<InvalidationResult> {
    const requestId = generateMessageId()

    const invalidation: CacheInvalidation = {
      type: CDNMessageType.CACHE_INVALIDATION,
      requestId,
      siteId: options.siteId,
      patterns,
      regions: options.regions ?? [],
      priority: options.priority ?? 'normal',
      timestamp: Date.now(),
      originNode: this.config.nodeId,
    }

    await this.publish(CDNTopics.INVALIDATION, invalidation)

    return {
      requestId,
      nodesNotified: this.connectedNodes.size,
      nodesAcknowledged: 0, // Would be updated via acknowledgment messages
      errors: [],
    }
  }

  /**
   * Request content replication to other regions
   */
  async replicateContent(
    contentHash: string,
    options: {
      contentType?: string
      size?: number
      targetRegions?: string[]
      priority?: 'low' | 'normal' | 'high'
      ttl?: number
    } = {},
  ): Promise<ReplicationResult> {
    const requestId = generateMessageId()

    const replicate: ContentReplicate = {
      type: CDNMessageType.CONTENT_REPLICATE,
      requestId,
      contentHash,
      contentType: options.contentType ?? 'application/octet-stream',
      size: options.size ?? 0,
      targetRegions: options.targetRegions ?? [],
      priority: options.priority ?? 'normal',
      ttl: options.ttl ?? 86400, // 24 hours default
      timestamp: Date.now(),
      originNode: this.config.nodeId,
    }

    await this.publish(CDNTopics.REPLICATION, replicate)

    return {
      requestId,
      contentHash,
      replicatedTo: [], // Would be updated via acknowledgment messages
      errors: [],
    }
  }

  /**
   * Report hot content (frequently requested)
   */
  async reportHotContent(
    contentHash: string,
    requestCount: number,
    period: number,
    size: number,
  ): Promise<void> {
    const hot: HotContent = {
      type: CDNMessageType.HOT_CONTENT,
      nodeId: this.config.nodeId,
      region: this.config.region,
      contentHash,
      requestCount,
      period,
      size,
      timestamp: Date.now(),
    }

    await this.publish(CDNTopics.REPLICATION, hot)
  }

  /**
   * Track content request for hot content detection
   */
  trackContentRequest(contentHash: string): void {
    if (!this.config.enableHotContentDetection) return

    const current = this.hotContentTracker.get(contentHash) ?? 0
    this.hotContentTracker.set(contentHash, current + 1)

    // Check if threshold exceeded
    if (current + 1 >= this.config.hotContentThreshold) {
      // Report as hot content and reset counter
      this.reportHotContent(contentHash, current + 1, 60, 0).catch(
        console.error,
      )
      this.hotContentTracker.delete(contentHash)
    }
  }

  /**
   * Get list of connected nodes
   */
  getConnectedNodes(): ConnectedNode[] {
    return Array.from(this.connectedNodes.values())
  }

  /**
   * Get nodes in a specific region
   */
  getNodesInRegion(region: string): ConnectedNode[] {
    return Array.from(this.connectedNodes.values()).filter(
      (n) => n.region === region,
    )
  }

  /**
   * Get peer ID for this node
   */
  getPeerId(): string | null {
    return this.node?.peerId.toString() ?? null
  }

  /**
   * Get multiaddrs for this node
   */
  getMultiaddrs(): string[] {
    return this.node?.getMultiaddrs().map((m) => m.toString()) ?? []
  }

  /**
   * Get coordinator statistics
   */
  getStats(): {
    started: boolean
    peerId: string | null
    connectedNodes: number
    regions: string[]
  } {
    const regions = new Set<string>()
    for (const node of Array.from(this.connectedNodes.values())) {
      regions.add(node.region)
    }

    return {
      started: this.started,
      peerId: this.getPeerId(),
      connectedNodes: this.connectedNodes.size,
      regions: Array.from(regions),
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  onInvalidation(handler: (msg: CacheInvalidation) => void): void {
    this.invalidationHandlers.push(handler)
  }

  onReplication(handler: (msg: ContentReplicate) => void): void {
    this.replicationHandlers.push(handler)
  }

  onMetrics(handler: (msg: NodeMetrics) => void): void {
    this.metricsHandlers.push(handler)
  }

  onAnnouncement(handler: (msg: NodeAnnouncement) => void): void {
    this.announcementHandlers.push(handler)
  }

  onHotContent(handler: (msg: HotContent) => void): void {
    this.hotContentHandlers.push(handler)
  }

  onMagnet(handler: (msg: MagnetAnnounce) => void): void {
    this.magnetHandlers.push(handler)
  }

  // ============================================================================
  // WebTorrent/BitTorrent Integration
  // ============================================================================

  /**
   * Broadcast a magnet URI for P2P content distribution
   */
  async broadcastMagnetUri(
    cid: string,
    magnetUri: string,
    options: {
      name?: string
      size?: number
      tier?: 'system' | 'popular' | 'private'
    } = {},
  ): Promise<void> {
    // Extract info hash from magnet URI
    const infoHashMatch = magnetUri.match(/btih:([a-fA-F0-9]{40})/)
    const infoHash = infoHashMatch?.[1]?.toLowerCase() ?? cid

    const announce: MagnetAnnounce = {
      type: CDNMessageType.MAGNET_ANNOUNCE,
      nodeId: this.config.nodeId,
      region: this.config.region,
      cid,
      magnetUri,
      infoHash,
      size: options.size ?? 0,
      name: options.name,
      tier: options.tier ?? 'popular',
      seederCount: 1, // We're seeding it
      timestamp: Date.now(),
    }

    // Store locally
    this.magnetIndex.set(cid, magnetUri)

    // Broadcast to network
    await this.publish(CDNTopics.MAGNETS, announce)

    console.log(`[CDN] Broadcast magnet URI for ${cid.slice(0, 12)}...`)
  }

  /**
   * Get magnet URI for a CID (from network announcements)
   */
  getMagnetUri(cid: string): string | null {
    return this.magnetIndex.get(cid) ?? null
  }

  /**
   * Check if we have a magnet URI for a CID
   */
  hasMagnetUri(cid: string): boolean {
    return this.magnetIndex.has(cid)
  }

  /**
   * Get all known magnet URIs
   */
  getAllMagnetUris(): Map<string, string> {
    return new Map(this.magnetIndex)
  }

  /**
   * Announce multiple magnet URIs (batch)
   */
  async broadcastMagnetUriBatch(
    items: Array<{
      cid: string
      magnetUri: string
      name?: string
      size?: number
      tier?: 'system' | 'popular' | 'private'
    }>,
  ): Promise<void> {
    for (const item of items) {
      await this.broadcastMagnetUri(item.cid, item.magnetUri, {
        name: item.name,
        size: item.size,
        tier: item.tier,
      })
    }
  }
}

// Factory and singleton
let coordinator: CDNGossipCoordinator | null = null

export function getCDNCoordinator(
  config?: CDNCoordinationConfig,
): CDNGossipCoordinator {
  if (!coordinator && config) {
    coordinator = new CDNGossipCoordinator(config)
  }
  if (!coordinator) {
    throw new Error('CDN Coordinator not initialized. Call with config first.')
  }
  return coordinator
}

export async function initializeCDNCoordinator(
  config: CDNCoordinationConfig,
): Promise<CDNGossipCoordinator> {
  coordinator = new CDNGossipCoordinator(config)
  await coordinator.start()
  return coordinator
}

export async function shutdownCDNCoordinator(): Promise<void> {
  if (coordinator) {
    await coordinator.stop()
    coordinator = null
  }
}
