/**
 * P2P Discovery
 *
 * Implements decentralized peer discovery using:
 * - Kademlia DHT for distributed hash table lookups
 * - mDNS for local network peer discovery
 * - Bootstrap nodes for initial connectivity
 * - On-chain registry as source of truth
 */

import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'

// ============================================================================
// Types
// ============================================================================

export interface P2PConfig {
  nodeId: string
  listenAddresses: string[]
  bootstrapPeers: string[]
  enableMdns: boolean
  enableDht: boolean
  identityRegistryAddress: Address
  rpcUrl: string
  privateKey?: Hex
}

export interface P2PNode {
  peerId: string
  nodeId: string
  addresses: string[]
  services: string[]
  region: string
  agentId: bigint
  endpoint: string
  stake: bigint
  lastSeen: number
  latency: number
  score: number
}

interface DHTRecord {
  key: string
  value: Uint8Array
  publisher: string
  timestamp: number
  ttl: number
}

interface PeerConnection {
  peerId: string
  address: string
  connected: boolean
  connectedAt: number
  lastActivity: number
  latency: number
}

// ============================================================================
// Constants
// ============================================================================

const DHT_REPLICATION_FACTOR = 20
const DHT_QUERY_CONCURRENCY = 3
const PEER_REFRESH_INTERVAL = 30000
const BOOTSTRAP_RETRY_INTERVAL = 10000
const MAX_CONNECTIONS = 100
const PING_INTERVAL = 15000

const DEFAULT_BOOTSTRAP_PEERS = [
  '/dns4/boot1.jeju.network/tcp/4001/p2p/QmBootstrap1',
  '/dns4/boot2.jeju.network/tcp/4001/p2p/QmBootstrap2',
  '/dns4/boot3.jeju.network/tcp/4001/p2p/QmBootstrap3',
]

// ============================================================================
// P2P Discovery Implementation
// ============================================================================

export class P2PDiscovery {
  private config: P2PConfig
  private peerId: string
  private peers: Map<string, P2PNode> = new Map()
  private connections: Map<string, PeerConnection> = new Map()
  private dhtRecords: Map<string, DHTRecord> = new Map()
  private kBucket: Map<number, string[]> = new Map()
  private running = false
  private refreshInterval: ReturnType<typeof setInterval> | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map()

  constructor(config: P2PConfig) {
    this.config = config
    this.peerId = this.generatePeerId(config.nodeId)
    this.initializeKBuckets()
  }

  /**
   * Generate a peer ID from node ID
   */
  private generatePeerId(nodeId: string): string {
    const hash = keccak256(toBytes(nodeId))
    return `Qm${hash.slice(2, 48)}`
  }

  /**
   * Initialize Kademlia k-buckets
   */
  private initializeKBuckets(): void {
    for (let i = 0; i < 256; i++) {
      this.kBucket.set(i, [])
    }
  }

  /**
   * Calculate XOR distance between two peer IDs
   */
  private xorDistance(a: string, b: string): bigint {
    const aBytes = toBytes(keccak256(toBytes(a)))
    const bBytes = toBytes(keccak256(toBytes(b)))

    let result = BigInt(0)
    for (let i = 0; i < 32; i++) {
      result = (result << BigInt(8)) | BigInt(aBytes[i] ^ bBytes[i])
    }
    return result
  }

  /**
   * Get bucket index for a peer
   */
  private getBucketIndex(peerId: string): number {
    const distance = this.xorDistance(this.peerId, peerId)
    if (distance === BigInt(0)) return 0

    let index = 0
    let d = distance
    while (d > BigInt(0)) {
      d = d >> BigInt(1)
      index++
    }
    return Math.min(index, 255)
  }

  /**
   * Start the P2P discovery service
   */
  async start(): Promise<void> {
    if (this.running) return

    console.log(`[P2P] Starting discovery service...`)
    console.log(`[P2P] Peer ID: ${this.peerId}`)
    console.log(
      `[P2P] Listen addresses: ${this.config.listenAddresses.join(', ')}`,
    )

    this.running = true

    // Connect to bootstrap peers
    await this.connectToBootstrap()

    // Start mDNS if enabled
    if (this.config.enableMdns) {
      await this.startMdns()
    }

    // Start DHT if enabled
    if (this.config.enableDht) {
      await this.startDht()
    }

    // Start periodic refresh
    this.refreshInterval = setInterval(() => {
      this.refreshPeers().catch(console.error)
    }, PEER_REFRESH_INTERVAL)

    // Start ping interval
    this.pingInterval = setInterval(() => {
      this.pingAllPeers().catch(console.error)
    }, PING_INTERVAL)

    // Announce ourselves to the network
    await this.announceNode()

    console.log(`[P2P] Discovery service started`)
  }

  /**
   * Stop the P2P discovery service
   */
  async stop(): Promise<void> {
    if (!this.running) return

    console.log(`[P2P] Stopping discovery service...`)

    this.running = false

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    // Disconnect from all peers
    for (const [peerId] of this.connections) {
      await this.disconnectPeer(peerId)
    }

    console.log(`[P2P] Discovery service stopped`)
  }

  /**
   * Connect to bootstrap peers
   */
  private async connectToBootstrap(): Promise<void> {
    const bootstrapPeers =
      this.config.bootstrapPeers.length > 0
        ? this.config.bootstrapPeers
        : DEFAULT_BOOTSTRAP_PEERS

    console.log(
      `[P2P] Connecting to ${bootstrapPeers.length} bootstrap peers...`,
    )

    const results = await Promise.allSettled(
      bootstrapPeers.map((addr) => this.connectToPeer(addr)),
    )

    const connected = results.filter((r) => r.status === 'fulfilled').length
    console.log(
      `[P2P] Connected to ${connected}/${bootstrapPeers.length} bootstrap peers`,
    )

    if (connected === 0) {
      console.warn(
        `[P2P] No bootstrap peers available, retrying in ${BOOTSTRAP_RETRY_INTERVAL}ms`,
      )
      setTimeout(() => this.connectToBootstrap(), BOOTSTRAP_RETRY_INTERVAL)
    }
  }

  /**
   * Connect to a peer by multiaddress
   */
  async connectToPeer(multiaddr: string): Promise<boolean> {
    const peerId = this.extractPeerId(multiaddr)
    if (!peerId) {
      console.warn(`[P2P] Invalid multiaddr: ${multiaddr}`)
      return false
    }

    if (this.connections.has(peerId)) {
      return true
    }

    if (this.connections.size >= MAX_CONNECTIONS) {
      await this.pruneConnections()
    }

    const address = this.extractAddress(multiaddr)

    const conn: PeerConnection = {
      peerId,
      address,
      connected: false,
      connectedAt: 0,
      lastActivity: Date.now(),
      latency: 0,
    }

    const start = Date.now()
    const response = await fetch(`${address}/p2p/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.peerId }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (response?.ok) {
      conn.connected = true
      conn.connectedAt = Date.now()
      conn.latency = Date.now() - start
      this.connections.set(peerId, conn)

      // Add to k-bucket
      const bucketIndex = this.getBucketIndex(peerId)
      const bucket = this.kBucket.get(bucketIndex) ?? []
      if (!bucket.includes(peerId)) {
        bucket.push(peerId)
        if (bucket.length > DHT_REPLICATION_FACTOR) {
          bucket.shift()
        }
        this.kBucket.set(bucketIndex, bucket)
      }

      // Request peer info
      await this.fetchPeerInfo(peerId, address)

      this.emit('peer:connect', { peerId, address })
      console.log(
        `[P2P] Connected to peer: ${peerId.slice(0, 12)}... (${conn.latency}ms)`,
      )
      return true
    }

    return false
  }

  /**
   * Disconnect from a peer
   */
  async disconnectPeer(peerId: string): Promise<void> {
    const conn = this.connections.get(peerId)
    if (!conn) return

    this.connections.delete(peerId)
    this.peers.delete(peerId)

    // Remove from k-bucket
    const bucketIndex = this.getBucketIndex(peerId)
    const bucket = this.kBucket.get(bucketIndex) ?? []
    const index = bucket.indexOf(peerId)
    if (index >= 0) {
      bucket.splice(index, 1)
      this.kBucket.set(bucketIndex, bucket)
    }

    this.emit('peer:disconnect', { peerId })
  }

  /**
   * Extract peer ID from multiaddress
   */
  private extractPeerId(multiaddr: string): string | null {
    const match = multiaddr.match(/\/p2p\/(\w+)$/)
    return match ? match[1] : null
  }

  /**
   * Extract HTTP address from multiaddress
   */
  private extractAddress(multiaddr: string): string {
    // Parse multiaddr format: /dns4/host/tcp/port/p2p/peerId
    // or /ip4/host/tcp/port/p2p/peerId
    const dnsMatch = multiaddr.match(/\/dns4\/([^/]+)\/tcp\/(\d+)/)
    if (dnsMatch) {
      return `http://${dnsMatch[1]}:${dnsMatch[2]}`
    }

    const ipMatch = multiaddr.match(/\/ip4\/([^/]+)\/tcp\/(\d+)/)
    if (ipMatch) {
      return `http://${ipMatch[1]}:${ipMatch[2]}`
    }

    return multiaddr
  }

  /**
   * Fetch peer info from connected peer
   */
  private async fetchPeerInfo(peerId: string, address: string): Promise<void> {
    const response = await fetch(`${address}/p2p/info`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (response?.ok) {
      const info = (await response.json()) as {
        nodeId: string
        services: string[]
        region: string
        agentId: string
        endpoint: string
        stake: string
      }

      const node: P2PNode = {
        peerId,
        nodeId: info.nodeId,
        addresses: [address],
        services: info.services,
        region: info.region,
        agentId: BigInt(info.agentId ?? '0'),
        endpoint: info.endpoint,
        stake: BigInt(info.stake ?? '0'),
        lastSeen: Date.now(),
        latency: this.connections.get(peerId)?.latency ?? 0,
        score: 100,
      }

      this.peers.set(peerId, node)
      this.emit('peer:discovered', node)
    }
  }

  /**
   * Start mDNS discovery for local peers
   */
  private async startMdns(): Promise<void> {
    console.log(`[P2P] mDNS discovery enabled`)
    // Note: Full mDNS implementation would use dgram multicast
    // For now, we scan common local ports
    const localAddresses = [
      'http://127.0.0.1:4030',
      'http://127.0.0.1:4031',
      'http://127.0.0.1:4032',
    ]

    for (const addr of localAddresses) {
      const response = await fetch(`${addr}/p2p/info`, {
        signal: AbortSignal.timeout(1000),
      }).catch(() => null)

      if (response?.ok) {
        const info = (await response.json()) as { peerId: string }
        if (info.peerId && info.peerId !== this.peerId) {
          await this.connectToPeer(`${addr}/p2p/${info.peerId}`)
        }
      }
    }
  }

  /**
   * Start DHT service
   */
  private async startDht(): Promise<void> {
    console.log(`[P2P] DHT enabled`)
    // DHT is initialized through k-buckets
    // Records are stored and retrieved via put/get methods
  }

  /**
   * Announce this node to the network
   */
  async announceNode(): Promise<void> {
    const record: DHTRecord = {
      key: `node:${this.config.nodeId}`,
      value: new TextEncoder().encode(
        JSON.stringify({
          peerId: this.peerId,
          nodeId: this.config.nodeId,
          addresses: this.config.listenAddresses,
          timestamp: Date.now(),
        }),
      ),
      publisher: this.peerId,
      timestamp: Date.now(),
      ttl: 3600000, // 1 hour
    }

    await this.dhtPut(record.key, record)
    console.log(`[P2P] Node announced to DHT`)
  }

  /**
   * Store a record in the DHT
   */
  async dhtPut(key: string, record: DHTRecord): Promise<void> {
    // Store locally
    this.dhtRecords.set(key, record)

    // Replicate to closest peers
    const closestPeers = this.findClosestPeers(key, DHT_REPLICATION_FACTOR)

    await Promise.allSettled(
      closestPeers.map(async (peerId) => {
        const conn = this.connections.get(peerId)
        if (!conn?.connected) return

        await fetch(`${conn.address}/p2p/dht/put`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
          signal: AbortSignal.timeout(5000),
        }).catch(() => null)
      }),
    )
  }

  /**
   * Get a record from the DHT
   */
  async dhtGet(key: string): Promise<DHTRecord | null> {
    // Check local store first
    const local = this.dhtRecords.get(key)
    if (local && Date.now() < local.timestamp + local.ttl) {
      return local
    }

    // Query closest peers
    const closestPeers = this.findClosestPeers(key, DHT_QUERY_CONCURRENCY)

    for (const peerId of closestPeers) {
      const conn = this.connections.get(peerId)
      if (!conn?.connected) continue

      const response = await fetch(
        `${conn.address}/p2p/dht/get?key=${encodeURIComponent(key)}`,
        {
          signal: AbortSignal.timeout(5000),
        },
      ).catch(() => null)

      if (response?.ok) {
        const record = (await response.json()) as DHTRecord
        if (record && Date.now() < record.timestamp + record.ttl) {
          this.dhtRecords.set(key, record)
          return record
        }
      }
    }

    return null
  }

  /**
   * Find the closest peers to a key
   */
  private findClosestPeers(key: string, count: number): string[] {
    const keyHash = keccak256(toBytes(key))
    const allPeers = Array.from(this.connections.keys())

    return allPeers
      .map((peerId) => ({
        peerId,
        distance: this.xorDistance(keyHash, peerId),
      }))
      .sort((a, b) => {
        if (a.distance < b.distance) return -1
        if (a.distance > b.distance) return 1
        return 0
      })
      .slice(0, count)
      .map((p) => p.peerId)
  }

  /**
   * Refresh peer connections
   */
  private async refreshPeers(): Promise<void> {
    const now = Date.now()
    const stale: string[] = []

    for (const [peerId, conn] of this.connections) {
      if (now - conn.lastActivity > 60000) {
        stale.push(peerId)
      }
    }

    // Disconnect stale peers
    for (const peerId of stale) {
      console.log(`[P2P] Disconnecting stale peer: ${peerId.slice(0, 12)}...`)
      await this.disconnectPeer(peerId)
    }

    // Try to find new peers if below threshold
    if (this.connections.size < 10) {
      await this.discoverNewPeers()
    }
  }

  /**
   * Discover new peers via DHT random walk
   */
  private async discoverNewPeers(): Promise<void> {
    const randomKey = toHex(crypto.getRandomValues(new Uint8Array(32)))
    const closestPeers = this.findClosestPeers(randomKey, 5)

    for (const peerId of closestPeers) {
      const conn = this.connections.get(peerId)
      if (!conn?.connected) continue

      const response = await fetch(`${conn.address}/p2p/peers?limit=10`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      if (response?.ok) {
        const result = (await response.json()) as { peers: string[] }
        for (const addr of result.peers) {
          if (!this.connections.has(this.extractPeerId(addr) ?? '')) {
            await this.connectToPeer(addr)
          }
        }
      }
    }
  }

  /**
   * Ping all connected peers
   */
  private async pingAllPeers(): Promise<void> {
    for (const [peerId, conn] of this.connections) {
      if (!conn.connected) continue

      const start = Date.now()
      const response = await fetch(`${conn.address}/p2p/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.peerId }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      if (response?.ok) {
        conn.latency = Date.now() - start
        conn.lastActivity = Date.now()

        const peer = this.peers.get(peerId)
        if (peer) {
          peer.latency = conn.latency
          peer.lastSeen = Date.now()
        }
      } else {
        conn.connected = false
      }
    }

    // Prune disconnected
    for (const [peerId, conn] of this.connections) {
      if (!conn.connected) {
        await this.disconnectPeer(peerId)
      }
    }
  }

  /**
   * Prune connections when at capacity
   */
  private async pruneConnections(): Promise<void> {
    // Sort by score and keep best connections
    const sorted = Array.from(this.connections.entries()).sort((a, b) => {
      const scoreA = this.peers.get(a[0])?.score ?? 0
      const scoreB = this.peers.get(b[0])?.score ?? 0
      return scoreB - scoreA
    })

    // Remove lowest scoring connections
    const toRemove = sorted.slice(MAX_CONNECTIONS - 10)
    for (const [peerId] of toRemove) {
      await this.disconnectPeer(peerId)
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get all discovered peers
   */
  getPeers(): P2PNode[] {
    return Array.from(this.peers.values())
  }

  /**
   * Get peers by service type
   */
  getPeersByService(service: string): P2PNode[] {
    return Array.from(this.peers.values()).filter((p) =>
      p.services.includes(service),
    )
  }

  /**
   * Get peers by region
   */
  getPeersByRegion(region: string): P2PNode[] {
    return Array.from(this.peers.values()).filter(
      (p) => p.region === region || p.region === 'global',
    )
  }

  /**
   * Find the best peer for a service
   */
  findBestPeer(service: string, preferredRegion?: string): P2PNode | null {
    let candidates = this.getPeersByService(service)

    if (preferredRegion) {
      const regionalPeers = candidates.filter(
        (p) => p.region === preferredRegion,
      )
      if (regionalPeers.length > 0) {
        candidates = regionalPeers
      }
    }

    if (candidates.length === 0) return null

    // Sort by score (weighted: latency, stake, uptime)
    return candidates.sort((a, b) => {
      const scoreA = a.score - a.latency / 10 + Number(a.stake / BigInt(1e18))
      const scoreB = b.score - b.latency / 10 + Number(b.stake / BigInt(1e18))
      return scoreB - scoreA
    })[0]
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size
  }

  /**
   * Get peer count
   */
  getPeerCount(): number {
    return this.peers.size
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Get this node's peer ID
   */
  getPeerId(): string {
    return this.peerId
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  on(event: string, handler: (data: unknown) => void): void {
    const handlers = this.eventHandlers.get(event) ?? []
    handlers.push(handler)
    this.eventHandlers.set(event, handlers)
  }

  off(event: string, handler: (data: unknown) => void): void {
    const handlers = this.eventHandlers.get(event) ?? []
    const index = handlers.indexOf(handler)
    if (index >= 0) {
      handlers.splice(index, 1)
      this.eventHandlers.set(event, handlers)
    }
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event) ?? []
    for (const handler of handlers) {
      handler(data)
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createP2PDiscovery(config: P2PConfig): P2PDiscovery {
  return new P2PDiscovery(config)
}
