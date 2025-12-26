/**
 * P2P Service
 *
 * Unified service that integrates all P2P components:
 * - Discovery (DHT, mDNS)
 * - Gossip (pub/sub messaging)
 * - Bootstrap (initial connectivity)
 * - Peer Store (persistence)
 *
 * Provides the main API for DWS node discovery and coordination.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { type BootstrapConfig, BootstrapManager } from './bootstrap'
import {
  createP2PDiscovery,
  type P2PConfig,
  type P2PDiscovery,
  type P2PNode,
} from './discovery'
import {
  createGossipProtocol,
  type GossipConfig,
  type GossipMessage,
  type GossipProtocol,
} from './gossip'
import { createPeerStore, type PeerStore } from './peer-store'

// ============================================================================
// Types
// ============================================================================

export interface P2PServiceConfig {
  nodeId: string
  listenPort: number
  externalEndpoint: string
  services: string[]
  region: string
  agentId: bigint
  privateKey?: string
  bootstrapPeers?: string[]
  registryAddress?: Address
  rpcUrl?: string
  dataDir?: string
  enableMdns?: boolean
  enableDht?: boolean
  topics?: string[]
}

export interface P2PService {
  discovery: P2PDiscovery
  gossip: GossipProtocol
  bootstrap: BootstrapManager
  peerStore: PeerStore
  start(): Promise<void>
  stop(): Promise<void>
  getPeers(): P2PNode[]
  findBestPeer(service: string, region?: string): P2PNode | null
  broadcast(topic: string, data: string | Uint8Array): Promise<string>
  subscribe(topic: string, handler: (msg: GossipMessage) => void): void
  getRouter(): Elysia
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_TOPICS = [
  'dws:nodes', // Node announcements
  'dws:cache', // Cache invalidation
  'dws:blocks', // Block propagation
  'dws:blobs', // DA blob announcements
  'dws:jobs', // Compute job coordination
]

// ============================================================================
// P2P Service Implementation
// ============================================================================

class P2PServiceImpl implements P2PService {
  discovery: P2PDiscovery
  gossip: GossipProtocol
  bootstrap: BootstrapManager
  peerStore: PeerStore
  private config: P2PServiceConfig
  private running = false

  constructor(config: P2PServiceConfig) {
    this.config = config

    const dataDir = config.dataDir ?? join(homedir(), '.jeju', 'p2p')
    const topics = config.topics ?? DEFAULT_TOPICS

    // Initialize peer store
    this.peerStore = createPeerStore(dataDir)

    // Initialize bootstrap manager
    const bootstrapConfig: Partial<BootstrapConfig> = {
      hardcodedPeers: config.bootstrapPeers,
      registryAddress: config.registryAddress,
      rpcUrl: config.rpcUrl,
    }
    this.bootstrap = new BootstrapManager(bootstrapConfig)

    // Initialize discovery
    const discoveryConfig: P2PConfig = {
      nodeId: config.nodeId,
      listenAddresses: [`/ip4/0.0.0.0/tcp/${config.listenPort}`],
      bootstrapPeers: config.bootstrapPeers ?? [],
      enableMdns: config.enableMdns ?? true,
      enableDht: config.enableDht ?? true,
      identityRegistryAddress:
        config.registryAddress ?? '0x0000000000000000000000000000000000000000',
      rpcUrl: config.rpcUrl ?? 'http://127.0.0.1:8545',
    }
    this.discovery = createP2PDiscovery(discoveryConfig)

    // Initialize gossip
    const gossipConfig: Partial<GossipConfig> = {
      peerId: this.discovery.getPeerId(),
      topics,
    }
    this.gossip = createGossipProtocol(gossipConfig)

    // Wire up components
    this.wireComponents()
  }

  /**
   * Wire up component interactions
   */
  private wireComponents(): void {
    // When discovery finds a peer, add to store and gossip
    this.discovery.on('peer:discovered', (data: unknown) => {
      const node = data as P2PNode

      this.peerStore.addPeer({
        peerId: node.peerId,
        nodeId: node.nodeId,
        addresses: node.addresses,
        protocols: [],
        services: node.services,
        region: node.region,
        agentId: node.agentId,
        metadata: {},
        lastSeen: Date.now(),
        lastConnect: Date.now(),
      })

      // Add to gossip
      for (const topic of DEFAULT_TOPICS) {
        this.gossip.addPeer(node.peerId, topic)
      }
    })

    // When discovery connects/disconnects
    this.discovery.on('peer:connect', (data: unknown) => {
      const { peerId } = data as { peerId: string }
      this.peerStore.recordConnection(peerId, true)
    })

    this.discovery.on('peer:disconnect', (data: unknown) => {
      const { peerId } = data as { peerId: string }
      this.peerStore.recordDisconnection(peerId, 0)

      // Remove from gossip
      for (const topic of DEFAULT_TOPICS) {
        this.gossip.removePeer(peerId, topic)
      }
    })

    // Wire gossip message sending through discovery connections
    this.gossip.setSender(async (peerId: string, msg: GossipMessage) => {
      const peer = this.peerStore.getPeer(peerId)
      if (!peer || peer.addresses.length === 0) return

      await fetch(`${peer.addresses[0]}/p2p/gossip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(5000),
      }).catch((e) => console.warn(`[P2P] gossip to ${peer.id} failed: ${e.message}`))
    })
  }

  /**
   * Start the P2P service
   */
  async start(): Promise<void> {
    if (this.running) return

    console.log(`[P2P Service] Starting...`)
    this.running = true

    // Start components
    this.peerStore.start()
    await this.bootstrap.start()
    await this.discovery.start()
    await this.gossip.start()

    // Join default topics
    for (const topic of DEFAULT_TOPICS) {
      await this.gossip.join(topic)
    }

    // Announce ourselves
    await this.announceNode()

    console.log(`[P2P Service] Started`)
    console.log(`[P2P Service] Peer ID: ${this.discovery.getPeerId()}`)
    console.log(`[P2P Service] Services: ${this.config.services.join(', ')}`)
  }

  /**
   * Stop the P2P service
   */
  async stop(): Promise<void> {
    if (!this.running) return

    console.log(`[P2P Service] Stopping...`)
    this.running = false

    await this.gossip.stop()
    await this.discovery.stop()
    await this.bootstrap.stop()
    this.peerStore.stop()

    console.log(`[P2P Service] Stopped`)
  }

  /**
   * Announce this node to the network
   */
  private async announceNode(): Promise<void> {
    const announcement = JSON.stringify({
      type: 'node:announce',
      nodeId: this.config.nodeId,
      peerId: this.discovery.getPeerId(),
      endpoint: this.config.externalEndpoint,
      services: this.config.services,
      region: this.config.region,
      agentId: this.config.agentId.toString(),
      timestamp: Date.now(),
    })

    await this.broadcast('dws:nodes', announcement)
  }

  /**
   * Get all discovered peers
   */
  getPeers(): P2PNode[] {
    return this.discovery.getPeers()
  }

  /**
   * Find the best peer for a service
   */
  findBestPeer(service: string, region?: string): P2PNode | null {
    return this.discovery.findBestPeer(service, region)
  }

  /**
   * Broadcast a message to a topic
   */
  async broadcast(topic: string, data: string | Uint8Array): Promise<string> {
    return this.gossip.publish(topic, data)
  }

  /**
   * Subscribe to messages on a topic
   */
  subscribe(topic: string, handler: (msg: GossipMessage) => void): void {
    this.gossip.subscribe(topic, handler)
  }

  /**
   * Get the P2P HTTP router
   */
  getRouter() {
    return (
      new Elysia({ prefix: '/p2p' })
        // Ping endpoint
        .post('/ping', ({ body }) => {
          const { from } = body as { from?: string }
          return {
            pong: true,
            from: this.discovery.getPeerId(),
            timestamp: Date.now(),
            peer: from,
          }
        })

        // Node info endpoint
        .get('/info', () => ({
          peerId: this.discovery.getPeerId(),
          nodeId: this.config.nodeId,
          services: this.config.services,
          region: this.config.region,
          agentId: this.config.agentId.toString(),
          endpoint: this.config.externalEndpoint,
          connections: this.discovery.getConnectionCount(),
          peers: this.discovery.getPeerCount(),
        }))

        // Get peers
        .get(
          '/peers',
          ({ query }) => {
            const limit = parseInt(query.limit ?? '20', 10)
            const service = query.service

            let peers = this.getPeers()

            if (service) {
              peers = peers.filter((p) => p.services.includes(service))
            }

            return {
              peers: peers.slice(0, limit).map((p) => ({
                peerId: p.peerId,
                nodeId: p.nodeId,
                endpoint: p.endpoint,
                services: p.services,
                region: p.region,
                latency: p.latency,
                score: p.score,
              })),
              total: peers.length,
            }
          },
          {
            query: t.Object({
              limit: t.Optional(t.String()),
              service: t.Optional(t.String()),
            }),
          },
        )

        // DHT get
        .get(
          '/dht/get',
          async ({ query }) => {
            const record = await this.discovery.dhtGet(query.key)
            if (!record) {
              return { error: 'not found' }
            }
            return {
              key: record.key,
              value: new TextDecoder().decode(record.value),
              publisher: record.publisher,
              timestamp: record.timestamp,
            }
          },
          {
            query: t.Object({
              key: t.String(),
            }),
          },
        )

        // DHT put
        .post('/dht/put', async ({ body }) => {
          const { key, value, ttl } = body as {
            key: string
            value: string
            ttl?: number
          }

          await this.discovery.dhtPut(key, {
            key,
            value: new TextEncoder().encode(value),
            publisher: this.discovery.getPeerId(),
            timestamp: Date.now(),
            ttl: ttl ?? 3600000,
          })

          return { success: true }
        })

        // Gossip message handler
        .post('/gossip', async ({ body }) => {
          const msg = body as GossipMessage

          // Validate message structure
          if (!msg.id || !msg.topic || !msg.from || !msg.data) {
            return { error: 'invalid message' }
          }

          // Convert data if needed
          const message: GossipMessage = {
            ...msg,
            data:
              typeof msg.data === 'string'
                ? new TextEncoder().encode(msg.data)
                : new Uint8Array(Object.values(msg.data)),
          }

          await this.gossip.handleMessage(message)

          return { success: true }
        })

        // Bootstrap peers
        .get('/bootstrap', () => ({
          peers: this.bootstrap.getBootstrapPeers(),
          stats: this.bootstrap.getStats(),
        }))

        // Health check
        .get('/health', () => ({
          status: 'healthy',
          service: 'p2p',
          running: this.running,
          peerId: this.discovery.getPeerId(),
          connections: this.discovery.getConnectionCount(),
          peers: this.discovery.getPeerCount(),
          bootstrapPeers: this.bootstrap.getHealthyPeerCount(),
          storedPeers: this.peerStore.getPeerCount(),
        }))

        // Stats
        .get('/stats', () => ({
          discovery: {
            running: this.discovery.isRunning(),
            peerId: this.discovery.getPeerId(),
            connections: this.discovery.getConnectionCount(),
            peers: this.discovery.getPeerCount(),
          },
          gossip: {
            seenMessages: this.gossip.getSeenMessageCount(),
            topics: DEFAULT_TOPICS.map((topic) => ({
              name: topic,
              ...this.gossip.getTopicStats(topic),
            })),
          },
          bootstrap: this.bootstrap.getStats(),
          peerStore: {
            peers: this.peerStore.getPeerCount(),
          },
        }))
    )
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createP2PService(config: P2PServiceConfig): P2PService {
  return new P2PServiceImpl(config)
}
