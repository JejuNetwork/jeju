/**
 * Swarming Coordinator for DWS Storage
 *
 * Coordinates BitTorrent/WebTorrent swarming across the network:
 * - Peer discovery via DHT and on-chain registry
 * - Regional content routing for low latency
 * - Swarm health monitoring and rebalancing
 * - Incentivized seeding with reputation tracking
 *
 * Integrates with SQLit v2 for distributed state and the metadata service
 * for content discovery.
 */

import { randomBytes } from 'node:crypto'
import { SQLitClient } from '@jejunetwork/sqlit/client'
import {
  getMetadataService,
  type MetadataService,
} from '../database/metadata-service'
import type { ContentTier } from './types'

// ============ Configuration ============

export interface SwarmingConfig {
  /** This node's unique identifier */
  nodeId: string
  /** This node's region */
  region: string
  /** This node's endpoint for peer connections */
  endpoint: string
  /** SQLit v2 endpoint for distributed state */
  sqlitEndpoint: string
  /** Database ID for swarm state */
  databaseId: string
  /** Maximum concurrent downloads per peer */
  maxConcurrentDownloads: number
  /** Maximum concurrent uploads per peer */
  maxConcurrentUploads: number
  /** Peer health check interval in ms */
  healthCheckIntervalMs: number
  /** Content rebalance check interval in ms */
  rebalanceIntervalMs: number
  /** Minimum peers before requesting more */
  minPeersPerContent: number
  /** Target peers for optimal distribution */
  targetPeersPerContent: number
  /** Maximum peers to maintain connections with */
  maxPeerConnections: number
  /** Enable debug logging */
  debug?: boolean
}

export interface SwarmPeer {
  nodeId: string
  endpoint: string
  region: string
  lastSeen: number
  latencyMs: number
  reputation: number
  capabilities: string[]
  availableContent: string[] // CIDs this peer is seeding
  uploadSpeed: number // bytes/sec
  downloadSpeed: number // bytes/sec
  connected: boolean
}

export interface SwarmContent {
  cid: string
  infoHash: string
  size: number
  tier: ContentTier
  seederCount: number
  leecherCount: number
  regions: string[]
  health: 'excellent' | 'good' | 'degraded' | 'critical'
  lastAudit: number
}

export interface SwarmStats {
  totalPeers: number
  connectedPeers: number
  totalContent: number
  totalBytesUploaded: bigint
  totalBytesDownloaded: bigint
  avgLatencyMs: number
  healthScore: number
}

// ============ Database Schema ============

const SWARMING_SCHEMA = `
-- Peer registry
CREATE TABLE IF NOT EXISTS swarm_peers (
  node_id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  region TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  latency_ms INTEGER DEFAULT 0,
  reputation INTEGER DEFAULT 1000,
  capabilities TEXT,
  upload_speed INTEGER DEFAULT 0,
  download_speed INTEGER DEFAULT 0,
  registered_at INTEGER NOT NULL
);

-- Content swarm state
CREATE TABLE IF NOT EXISTS swarm_content (
  cid TEXT PRIMARY KEY,
  info_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  tier TEXT NOT NULL DEFAULT 'popular',
  seeder_count INTEGER DEFAULT 0,
  leecher_count INTEGER DEFAULT 0,
  regions TEXT,
  health TEXT DEFAULT 'good',
  last_audit INTEGER,
  created_at INTEGER NOT NULL
);

-- Peer-content mapping (who is seeding what)
CREATE TABLE IF NOT EXISTS peer_content (
  node_id TEXT NOT NULL,
  cid TEXT NOT NULL,
  seeding INTEGER NOT NULL DEFAULT 0,
  downloaded_bytes INTEGER DEFAULT 0,
  uploaded_bytes INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  PRIMARY KEY (node_id, cid),
  FOREIGN KEY (node_id) REFERENCES swarm_peers(node_id) ON DELETE CASCADE,
  FOREIGN KEY (cid) REFERENCES swarm_content(cid) ON DELETE CASCADE
);

-- Transfer history for analytics
CREATE TABLE IF NOT EXISTS transfer_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  cid TEXT NOT NULL,
  bytes_transferred INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  timestamp INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_peers_region ON swarm_peers(region);
CREATE INDEX IF NOT EXISTS idx_peers_reputation ON swarm_peers(reputation DESC);
CREATE INDEX IF NOT EXISTS idx_content_tier ON swarm_content(tier);
CREATE INDEX IF NOT EXISTS idx_content_health ON swarm_content(health);
CREATE INDEX IF NOT EXISTS idx_peer_content_cid ON peer_content(cid);
CREATE INDEX IF NOT EXISTS idx_transfer_timestamp ON transfer_history(timestamp);
`

// ============ Swarming Coordinator ============

/**
 * Coordinates content swarming across the DWS network
 */
export class SwarmingCoordinator {
  private config: SwarmingConfig
  private client: SQLitClient
  private metadataService: MetadataService
  private initialized = false
  private peers: Map<string, SwarmPeer> = new Map()
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private rebalanceTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: SwarmingConfig) {
    this.config = config
    this.client = new SQLitClient({
      endpoint: config.sqlitEndpoint,
      databaseId: config.databaseId,
      debug: config.debug,
    })
    this.metadataService = getMetadataService()
  }

  /**
   * Initialize the swarming coordinator
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (this.config.debug) {
      console.log('[Swarming] Initializing coordinator...')
    }

    // Create schema
    await this.client.run(SWARMING_SCHEMA)

    // Register this node as a peer
    await this.registerSelf()

    // Load known peers
    await this.loadPeers()

    // Start background tasks
    this.startHealthChecks()
    this.startRebalancing()

    this.initialized = true

    if (this.config.debug) {
      console.log(
        `[Swarming] Coordinator initialized, ${this.peers.size} peers loaded`,
      )
    }
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer)
      this.rebalanceTimer = null
    }
    this.initialized = false
  }

  // ============ Peer Management ============

  /**
   * Register this node as a peer
   */
  private async registerSelf(): Promise<void> {
    const now = Date.now()
    await this.client.run(
      `INSERT INTO swarm_peers (node_id, endpoint, region, last_seen, reputation, capabilities, registered_at)
       VALUES (?, ?, ?, ?, 1000, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET
         endpoint = excluded.endpoint,
         last_seen = excluded.last_seen`,
      [
        this.config.nodeId,
        this.config.endpoint,
        this.config.region,
        now,
        JSON.stringify(['seed', 'download']),
        now,
      ],
    )
  }

  /**
   * Load known peers from database
   */
  private async loadPeers(): Promise<void> {
    const rows = await this.client.query<{
      node_id: string
      endpoint: string
      region: string
      last_seen: number
      latency_ms: number
      reputation: number
      capabilities: string | null
      upload_speed: number
      download_speed: number
    }>(
      'SELECT * FROM swarm_peers WHERE node_id != ? ORDER BY reputation DESC LIMIT ?',
      [this.config.nodeId, this.config.maxPeerConnections],
    )

    for (const row of rows) {
      this.peers.set(row.node_id, {
        nodeId: row.node_id,
        endpoint: row.endpoint,
        region: row.region,
        lastSeen: row.last_seen,
        latencyMs: row.latency_ms,
        reputation: row.reputation,
        capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
        availableContent: [],
        uploadSpeed: row.upload_speed,
        downloadSpeed: row.download_speed,
        connected: false,
      })
    }
  }

  /**
   * Register a new peer
   */
  async registerPeer(
    peer: Omit<SwarmPeer, 'connected' | 'availableContent'>,
  ): Promise<void> {
    await this.initialize()

    await this.client.run(
      `INSERT INTO swarm_peers (node_id, endpoint, region, last_seen, latency_ms, reputation, capabilities, upload_speed, download_speed, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET
         endpoint = excluded.endpoint,
         region = excluded.region,
         last_seen = excluded.last_seen,
         latency_ms = excluded.latency_ms`,
      [
        peer.nodeId,
        peer.endpoint,
        peer.region,
        peer.lastSeen,
        peer.latencyMs,
        peer.reputation,
        JSON.stringify(peer.capabilities),
        peer.uploadSpeed,
        peer.downloadSpeed,
        Date.now(),
      ],
    )

    this.peers.set(peer.nodeId, {
      ...peer,
      connected: false,
      availableContent: [],
    })

    if (this.config.debug) {
      console.log(`[Swarming] Registered peer: ${peer.nodeId} (${peer.region})`)
    }
  }

  /**
   * Get peers for a specific content CID
   */
  async getPeersForContent(cid: string): Promise<SwarmPeer[]> {
    await this.initialize()

    const rows = await this.client.query<{
      node_id: string
    }>(
      `SELECT pc.node_id FROM peer_content pc
       JOIN swarm_peers sp ON pc.node_id = sp.node_id
       WHERE pc.cid = ? AND pc.seeding = 1
       ORDER BY sp.reputation DESC, sp.latency_ms ASC
       LIMIT ?`,
      [cid, this.config.targetPeersPerContent],
    )

    return rows
      .map((row) => this.peers.get(row.node_id))
      .filter((p): p is SwarmPeer => p !== undefined)
  }

  /**
   * Get best peers for this node's region
   */
  async getRegionalPeers(limit = 10): Promise<SwarmPeer[]> {
    await this.initialize()

    // Prefer peers in the same region, then nearby regions
    const rows = await this.client.query<{
      node_id: string
    }>(
      `SELECT node_id FROM swarm_peers
       WHERE node_id != ?
       ORDER BY 
         CASE WHEN region = ? THEN 0 ELSE 1 END,
         reputation DESC,
         latency_ms ASC
       LIMIT ?`,
      [this.config.nodeId, this.config.region, limit],
    )

    return rows
      .map((row) => this.peers.get(row.node_id))
      .filter((p): p is SwarmPeer => p !== undefined)
  }

  // ============ Content Management ============

  /**
   * Register content in the swarm
   */
  async registerContent(content: {
    cid: string
    infoHash: string
    size: number
    tier: ContentTier
  }): Promise<void> {
    await this.initialize()

    const now = Date.now()
    await this.client.run(
      `INSERT INTO swarm_content (cid, info_hash, size, tier, seeder_count, regions, health, created_at)
       VALUES (?, ?, ?, ?, 1, ?, 'good', ?)
       ON CONFLICT(cid) DO UPDATE SET
         seeder_count = seeder_count + 1`,
      [
        content.cid,
        content.infoHash,
        content.size,
        content.tier,
        JSON.stringify([this.config.region]),
        now,
      ],
    )

    // Mark this node as seeding
    await this.client.run(
      `INSERT INTO peer_content (node_id, cid, seeding, started_at, last_activity)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(node_id, cid) DO UPDATE SET
         seeding = 1,
         last_activity = excluded.last_activity`,
      [this.config.nodeId, content.cid, now, now],
    )

    if (this.config.debug) {
      console.log(
        `[Swarming] Registered content: ${content.cid} (${content.tier})`,
      )
    }
  }

  /**
   * Find peers to download content from
   */
  async findContentSources(cid: string): Promise<SwarmPeer[]> {
    await this.initialize()

    // First try the metadata service for node info
    const contentNodes = await this.metadataService.getContentNodes(cid)

    if (contentNodes.length > 0) {
      const peers: SwarmPeer[] = []
      for (const node of contentNodes) {
        const peer = this.peers.get(node.nodeId)
        if (peer) {
          peers.push(peer)
        }
      }
      if (peers.length > 0) {
        return peers
      }
    }

    // Fall back to swarm database
    return this.getPeersForContent(cid)
  }

  /**
   * Request content from a peer
   */
  async requestContent(
    cid: string,
    fromPeer: SwarmPeer,
  ): Promise<{ magnetUri: string; infoHash: string } | null> {
    const startTime = Date.now()

    try {
      const response = await fetch(
        `${fromPeer.endpoint}/v2/swarm/content/${cid}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Node-ID': this.config.nodeId,
            'X-Region': this.config.region,
          },
          signal: AbortSignal.timeout(10000),
        },
      )

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as {
        magnetUri: string
        infoHash: string
      }

      // Update latency
      const latency = Date.now() - startTime
      await this.updatePeerLatency(fromPeer.nodeId, latency)

      // Record download start
      await this.client.run(
        `INSERT INTO peer_content (node_id, cid, seeding, started_at, last_activity)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(node_id, cid) DO UPDATE SET
           last_activity = excluded.last_activity`,
        [this.config.nodeId, cid, Date.now(), Date.now()],
      )

      return data
    } catch (error) {
      if (this.config.debug) {
        console.warn(
          `[Swarming] Failed to request content from ${fromPeer.nodeId}:`,
          error,
        )
      }
      return null
    }
  }

  /**
   * Record a completed transfer
   */
  async recordTransfer(
    fromNode: string,
    toNode: string,
    cid: string,
    bytes: number,
    durationMs: number,
    success: boolean,
  ): Promise<void> {
    await this.initialize()

    await this.client.run(
      `INSERT INTO transfer_history (from_node, to_node, cid, bytes_transferred, duration_ms, success, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fromNode, toNode, cid, bytes, durationMs, success ? 1 : 0, Date.now()],
    )

    // Update reputation based on transfer success
    if (success) {
      await this.client.run(
        'UPDATE swarm_peers SET reputation = MIN(reputation + 1, 10000) WHERE node_id = ?',
        [fromNode],
      )
    } else {
      await this.client.run(
        'UPDATE swarm_peers SET reputation = MAX(reputation - 10, 0) WHERE node_id = ?',
        [fromNode],
      )
    }

    // Update peer content stats
    if (success) {
      await this.client.run(
        `UPDATE peer_content SET 
           uploaded_bytes = uploaded_bytes + ?,
           last_activity = ?
         WHERE node_id = ? AND cid = ?`,
        [bytes, Date.now(), fromNode, cid],
      )
      await this.client.run(
        `UPDATE peer_content SET 
           downloaded_bytes = downloaded_bytes + ?,
           last_activity = ?
         WHERE node_id = ? AND cid = ?`,
        [bytes, Date.now(), toNode, cid],
      )
    }
  }

  // ============ Health & Rebalancing ============

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks()
    }, this.config.healthCheckIntervalMs)
  }

  /**
   * Perform health checks on all peers
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now()
    const staleThreshold = now - this.config.healthCheckIntervalMs * 3

    for (const [nodeId, peer] of Array.from(this.peers.entries())) {
      if (peer.lastSeen < staleThreshold) {
        // Try to ping the peer
        try {
          const start = Date.now()
          const response = await fetch(`${peer.endpoint}/health`, {
            signal: AbortSignal.timeout(5000),
          })

          if (response.ok) {
            peer.lastSeen = now
            peer.latencyMs = Date.now() - start
            peer.connected = true
            await this.updatePeerLatency(nodeId, peer.latencyMs)
          } else {
            peer.connected = false
          }
        } catch {
          peer.connected = false
          // Decrease reputation for unreachable peers
          await this.client.run(
            'UPDATE swarm_peers SET reputation = MAX(reputation - 5, 0) WHERE node_id = ?',
            [nodeId],
          )
        }
      }
    }

    // Remove very stale peers
    const veryStaleThreshold = now - this.config.healthCheckIntervalMs * 10
    await this.client.run(
      'DELETE FROM swarm_peers WHERE last_seen < ? AND node_id != ?',
      [veryStaleThreshold, this.config.nodeId],
    )
  }

  /**
   * Update peer latency
   */
  private async updatePeerLatency(
    nodeId: string,
    latencyMs: number,
  ): Promise<void> {
    await this.client.run(
      'UPDATE swarm_peers SET latency_ms = ?, last_seen = ? WHERE node_id = ?',
      [latencyMs, Date.now(), nodeId],
    )

    const peer = this.peers.get(nodeId)
    if (peer) {
      peer.latencyMs = latencyMs
      peer.lastSeen = Date.now()
    }
  }

  /**
   * Start periodic content rebalancing
   */
  private startRebalancing(): void {
    this.rebalanceTimer = setInterval(async () => {
      await this.performRebalancing()
    }, this.config.rebalanceIntervalMs)
  }

  /**
   * Rebalance content distribution
   */
  private async performRebalancing(): Promise<void> {
    // Find under-replicated content
    const underReplicated = await this.client.query<{
      cid: string
      seeder_count: number
      tier: string
    }>(
      `SELECT cid, seeder_count, tier FROM swarm_content
       WHERE seeder_count < ? AND health != 'critical'
       ORDER BY 
         CASE tier 
           WHEN 'system' THEN 0 
           WHEN 'popular' THEN 1 
           ELSE 2 
         END,
         seeder_count ASC
       LIMIT 10`,
      [this.config.minPeersPerContent],
    )

    for (const content of underReplicated) {
      if (this.config.debug) {
        console.log(
          `[Swarming] Content ${content.cid} under-replicated (${content.seeder_count} seeders)`,
        )
      }

      // Request replication from other nodes
      await this.requestReplication(content.cid)
    }

    // Update content health status
    await this.client.run(
      `UPDATE swarm_content SET health = 
         CASE 
           WHEN seeder_count >= ? THEN 'excellent'
           WHEN seeder_count >= ? THEN 'good'
           WHEN seeder_count >= 2 THEN 'degraded'
           ELSE 'critical'
         END`,
      [this.config.targetPeersPerContent, this.config.minPeersPerContent],
    )
  }

  /**
   * Request other nodes to replicate content
   */
  private async requestReplication(cid: string): Promise<void> {
    const regionalPeers = await this.getRegionalPeers(5)

    for (const peer of regionalPeers) {
      if (!peer.connected) continue

      try {
        await fetch(`${peer.endpoint}/v2/swarm/replicate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cid,
            requestingNode: this.config.nodeId,
            priority: 'normal',
          }),
          signal: AbortSignal.timeout(5000),
        })
      } catch {
        // Ignore failures, some nodes may not support replication requests
      }
    }
  }

  // ============ Stats ============

  /**
   * Get swarm statistics
   */
  async getStats(): Promise<SwarmStats> {
    await this.initialize()

    const peerStats = await this.client.queryOne<{
      total: number
      avg_latency: number
      avg_reputation: number
    }>(
      'SELECT COUNT(*) as total, AVG(latency_ms) as avg_latency, AVG(reputation) as avg_reputation FROM swarm_peers',
    )

    const contentStats = await this.client.queryOne<{
      total: number
    }>('SELECT COUNT(*) as total FROM swarm_content')

    const transferStats = await this.client.queryOne<{
      uploaded: number
      downloaded: number
    }>(
      `SELECT 
         SUM(CASE WHEN from_node = ? THEN bytes_transferred ELSE 0 END) as uploaded,
         SUM(CASE WHEN to_node = ? THEN bytes_transferred ELSE 0 END) as downloaded
       FROM transfer_history`,
      [this.config.nodeId, this.config.nodeId],
    )

    const connectedPeers = Array.from(this.peers.values()).filter(
      (p) => p.connected,
    ).length

    return {
      totalPeers: peerStats?.total ?? 0,
      connectedPeers,
      totalContent: contentStats?.total ?? 0,
      totalBytesUploaded: BigInt(transferStats?.uploaded ?? 0),
      totalBytesDownloaded: BigInt(transferStats?.downloaded ?? 0),
      avgLatencyMs: peerStats?.avg_latency ?? 0,
      healthScore: Math.min(100, (peerStats?.avg_reputation ?? 0) / 100),
    }
  }

  /**
   * Get content swarm info
   */
  async getContentInfo(cid: string): Promise<SwarmContent | null> {
    await this.initialize()

    const row = await this.client.queryOne<{
      cid: string
      info_hash: string
      size: number
      tier: string
      seeder_count: number
      leecher_count: number
      regions: string | null
      health: string
      last_audit: number | null
    }>('SELECT * FROM swarm_content WHERE cid = ?', [cid])

    if (!row) return null

    return {
      cid: row.cid,
      infoHash: row.info_hash,
      size: row.size,
      tier: row.tier as ContentTier,
      seederCount: row.seeder_count,
      leecherCount: row.leecher_count,
      regions: row.regions ? JSON.parse(row.regions) : [],
      health: row.health as 'excellent' | 'good' | 'degraded' | 'critical',
      lastAudit: row.last_audit ?? 0,
    }
  }
}

// ============ Singleton Instance ============

let swarmingCoordinator: SwarmingCoordinator | null = null

/**
 * Get the global swarming coordinator instance
 */
export function getSwarmingCoordinator(
  config?: Partial<SwarmingConfig>,
): SwarmingCoordinator {
  if (!swarmingCoordinator) {
    const nodeId =
      config?.nodeId ??
      process.env.DWS_NODE_ID ??
      `node-${randomBytes(8).toString('hex')}`
    const region = config?.region ?? process.env.DWS_REGION ?? 'us-east'
    const endpoint =
      config?.endpoint ?? process.env.DWS_ENDPOINT ?? 'http://localhost:8080'

    swarmingCoordinator = new SwarmingCoordinator({
      nodeId,
      region,
      endpoint,
      sqlitEndpoint:
        config?.sqlitEndpoint ??
        process.env.SQLIT_V2_ENDPOINT ??
        'http://localhost:8546',
      databaseId: config?.databaseId ?? 'dws-swarm',
      maxConcurrentDownloads: config?.maxConcurrentDownloads ?? 5,
      maxConcurrentUploads: config?.maxConcurrentUploads ?? 10,
      healthCheckIntervalMs: config?.healthCheckIntervalMs ?? 30000,
      rebalanceIntervalMs: config?.rebalanceIntervalMs ?? 60000,
      minPeersPerContent: config?.minPeersPerContent ?? 3,
      targetPeersPerContent: config?.targetPeersPerContent ?? 5,
      maxPeerConnections: config?.maxPeerConnections ?? 50,
      debug: config?.debug ?? process.env.DWS_DEBUG === 'true',
    })
  }
  return swarmingCoordinator
}

/**
 * Reset the swarming coordinator (for testing)
 */
export async function resetSwarmingCoordinator(): Promise<void> {
  if (swarmingCoordinator) {
    await swarmingCoordinator.stop()
    swarmingCoordinator = null
  }
}
