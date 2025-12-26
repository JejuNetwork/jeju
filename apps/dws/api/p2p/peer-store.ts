/**
 * Peer Store
 *
 * Persistent storage for peer information, scores, and connection history.
 * Enables intelligent peer selection and network stability.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================================
// Types
// ============================================================================

export interface PeerInfo {
  peerId: string
  nodeId: string
  addresses: string[]
  protocols: string[]
  services: string[]
  region: string
  agentId: bigint
  publicKey?: string
  metadata: Record<string, string>
  addedAt: number
  lastSeen: number
  lastConnect: number
  connectCount: number
  disconnectCount: number
}

export interface PeerScore {
  peerId: string
  overall: number
  latency: number
  uptime: number
  deliveryRate: number
  bandwidth: number
  stake: bigint
  reputation: number
  penaltyExpiry: number
}

interface ConnectionEvent {
  peerId: string
  type: 'connect' | 'disconnect' | 'fail'
  timestamp: number
  duration?: number
  reason?: string
}

interface PeerStoreData {
  version: number
  peers: Record<string, PeerInfo>
  scores: Record<string, PeerScore>
  connectionHistory: ConnectionEvent[]
}

// ============================================================================
// Constants
// ============================================================================

const STORE_VERSION = 1
const MAX_PEERS = 10000
const MAX_HISTORY = 1000
const SAVE_INTERVAL = 60000 // 1 minute
const SCORE_DECAY_INTERVAL = 3600000 // 1 hour

// ============================================================================
// Peer Store Implementation
// ============================================================================

export class PeerStore {
  private dataDir: string
  private peers: Map<string, PeerInfo> = new Map()
  private scores: Map<string, PeerScore> = new Map()
  private connectionHistory: ConnectionEvent[] = []
  private saveInterval: ReturnType<typeof setInterval> | null = null
  private decayInterval: ReturnType<typeof setInterval> | null = null
  private dirty = false

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.ensureDataDir()
    this.load()
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }
  }

  /**
   * Get store file path
   */
  private get storePath(): string {
    return join(this.dataDir, 'peers.json')
  }

  /**
   * Load peer store from disk
   */
  private load(): void {
    if (!existsSync(this.storePath)) {
      console.log(`[PeerStore] No existing data, starting fresh`)
      return
    }

    const content = readFileSync(this.storePath, 'utf-8')
    const data: unknown = JSON.parse(content)

    if (typeof data !== 'object' || data === null) {
      console.warn(`[PeerStore] Invalid data format, starting fresh`)
      return
    }

    const storeData = data as PeerStoreData

    if (storeData.version !== STORE_VERSION) {
      console.warn(`[PeerStore] Version mismatch, migrating data`)
      // Handle migrations here if needed
    }

    // Load peers
    for (const [peerId, info] of Object.entries(storeData.peers ?? {})) {
      this.peers.set(peerId, {
        ...info,
        agentId: BigInt(info.agentId ?? '0'),
      })
    }

    // Load scores
    for (const [peerId, score] of Object.entries(storeData.scores ?? {})) {
      this.scores.set(peerId, {
        ...score,
        stake: BigInt(score.stake ?? '0'),
      })
    }

    // Load history
    this.connectionHistory = storeData.connectionHistory ?? []

    console.log(`[PeerStore] Loaded ${this.peers.size} peers`)
  }

  /**
   * Save peer store to disk
   */
  private save(): void {
    if (!this.dirty) return

    const data: PeerStoreData = {
      version: STORE_VERSION,
      peers: Object.fromEntries(
        Array.from(this.peers.entries()).map(([k, v]) => [
          k,
          { ...v, agentId: v.agentId.toString() } as unknown as PeerInfo,
        ]),
      ),
      scores: Object.fromEntries(
        Array.from(this.scores.entries()).map(([k, v]) => [
          k,
          { ...v, stake: v.stake.toString() } as unknown as PeerScore,
        ]),
      ),
      connectionHistory: this.connectionHistory.slice(-MAX_HISTORY),
    }

    writeFileSync(this.storePath, JSON.stringify(data, null, 2))
    this.dirty = false
    console.log(`[PeerStore] Saved ${this.peers.size} peers`)
  }

  /**
   * Start periodic save and score decay
   */
  start(): void {
    this.saveInterval = setInterval(() => {
      this.save()
    }, SAVE_INTERVAL)

    this.decayInterval = setInterval(() => {
      this.decayScores()
    }, SCORE_DECAY_INTERVAL)
  }

  /**
   * Stop and save
   */
  stop(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval)
      this.saveInterval = null
    }

    if (this.decayInterval) {
      clearInterval(this.decayInterval)
      this.decayInterval = null
    }

    this.save()
  }

  // ============================================================================
  // Peer Management
  // ============================================================================

  /**
   * Add or update a peer
   */
  addPeer(
    info: Omit<PeerInfo, 'addedAt' | 'connectCount' | 'disconnectCount'>,
  ): void {
    const existing = this.peers.get(info.peerId)

    if (existing) {
      // Update existing peer
      existing.addresses = info.addresses
      existing.protocols = info.protocols
      existing.services = info.services
      existing.region = info.region
      existing.agentId = info.agentId
      existing.metadata = { ...existing.metadata, ...info.metadata }
      existing.lastSeen = info.lastSeen
      if (info.lastConnect > existing.lastConnect) {
        existing.lastConnect = info.lastConnect
      }
    } else {
      // Add new peer
      this.peers.set(info.peerId, {
        ...info,
        addedAt: Date.now(),
        connectCount: 0,
        disconnectCount: 0,
      })

      // Initialize score
      this.scores.set(info.peerId, {
        peerId: info.peerId,
        overall: 50,
        latency: 100,
        uptime: 0,
        deliveryRate: 1,
        bandwidth: 0,
        stake: BigInt(0),
        reputation: 50,
        penaltyExpiry: 0,
      })
    }

    this.dirty = true

    // Prune if over limit
    if (this.peers.size > MAX_PEERS) {
      this.prunePeers()
    }
  }

  /**
   * Remove a peer
   */
  removePeer(peerId: string): void {
    this.peers.delete(peerId)
    this.scores.delete(peerId)
    this.dirty = true
  }

  /**
   * Get a peer
   */
  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId)
  }

  /**
   * Check if peer exists
   */
  hasPeer(peerId: string): boolean {
    return this.peers.has(peerId)
  }

  /**
   * Get all peers
   */
  getAllPeers(): PeerInfo[] {
    return Array.from(this.peers.values())
  }

  /**
   * Get peers by service
   */
  getPeersByService(service: string): PeerInfo[] {
    return Array.from(this.peers.values()).filter((p) =>
      p.services.includes(service),
    )
  }

  /**
   * Get peers by region
   */
  getPeersByRegion(region: string): PeerInfo[] {
    return Array.from(this.peers.values()).filter(
      (p) => p.region === region || p.region === 'global',
    )
  }

  /**
   * Get peer count
   */
  getPeerCount(): number {
    return this.peers.size
  }

  // ============================================================================
  // Score Management
  // ============================================================================

  /**
   * Get peer score
   */
  getScore(peerId: string): PeerScore | undefined {
    return this.scores.get(peerId)
  }

  /**
   * Update peer score
   */
  updateScore(
    peerId: string,
    updates: Partial<Omit<PeerScore, 'peerId'>>,
  ): void {
    const score = this.scores.get(peerId)
    if (!score) return

    if (updates.latency !== undefined) {
      score.latency = score.latency * 0.8 + updates.latency * 0.2
    }
    if (updates.uptime !== undefined) {
      score.uptime = updates.uptime
    }
    if (updates.deliveryRate !== undefined) {
      score.deliveryRate = score.deliveryRate * 0.9 + updates.deliveryRate * 0.1
    }
    if (updates.bandwidth !== undefined) {
      score.bandwidth = score.bandwidth * 0.8 + updates.bandwidth * 0.2
    }
    if (updates.stake !== undefined) {
      score.stake = updates.stake
    }
    if (updates.reputation !== undefined) {
      score.reputation = Math.max(0, Math.min(100, updates.reputation))
    }
    if (updates.penaltyExpiry !== undefined) {
      score.penaltyExpiry = updates.penaltyExpiry
    }

    // Recalculate overall score
    score.overall = this.calculateOverallScore(score)

    this.dirty = true
  }

  /**
   * Calculate overall score from components
   */
  private calculateOverallScore(score: PeerScore): number {
    // Check for active penalty
    if (score.penaltyExpiry > Date.now()) {
      return -100
    }

    // Weighted scoring
    const latencyScore = Math.max(0, 100 - score.latency / 10) // Lower is better
    const uptimeScore = score.uptime * 100
    const deliveryScore = score.deliveryRate * 100
    const stakeScore = Math.min(100, Number(score.stake / BigInt(1e17))) // 0.1 ETH = max
    const reputationScore = score.reputation

    return (
      latencyScore * 0.2 +
      uptimeScore * 0.2 +
      deliveryScore * 0.3 +
      stakeScore * 0.15 +
      reputationScore * 0.15
    )
  }

  /**
   * Apply penalty to peer
   */
  applyPenalty(peerId: string, durationMs: number, reason: string): void {
    const score = this.scores.get(peerId)
    if (!score) return

    score.penaltyExpiry = Date.now() + durationMs
    score.reputation = Math.max(0, score.reputation - 10)
    score.overall = -100

    this.dirty = true
    console.log(
      `[PeerStore] Penalty applied to ${peerId.slice(0, 12)}...: ${reason}`,
    )
  }

  /**
   * Decay scores over time
   */
  private decayScores(): void {
    for (const score of this.scores.values()) {
      // Decay reputation towards neutral
      if (score.reputation > 50) {
        score.reputation = score.reputation * 0.99 + 50 * 0.01
      } else if (score.reputation < 50) {
        score.reputation = score.reputation * 0.99 + 50 * 0.01
      }

      // Recalculate overall
      score.overall = this.calculateOverallScore(score)
    }

    this.dirty = true
  }

  /**
   * Get top peers by score
   */
  getTopPeers(count: number, service?: string): PeerInfo[] {
    let peers = Array.from(this.peers.values())

    if (service) {
      peers = peers.filter((p) => p.services.includes(service))
    }

    return peers
      .sort((a, b) => {
        const scoreA = this.scores.get(a.peerId)?.overall ?? 0
        const scoreB = this.scores.get(b.peerId)?.overall ?? 0
        return scoreB - scoreA
      })
      .slice(0, count)
  }

  // ============================================================================
  // Connection Events
  // ============================================================================

  /**
   * Record connection event
   */
  recordConnection(peerId: string, success: boolean): void {
    const peer = this.peers.get(peerId)
    if (!peer) return

    const event: ConnectionEvent = {
      peerId,
      type: success ? 'connect' : 'fail',
      timestamp: Date.now(),
    }

    this.connectionHistory.push(event)

    if (success) {
      peer.connectCount++
      peer.lastConnect = Date.now()
      this.updateScore(peerId, {
        uptime: peer.connectCount / (peer.connectCount + peer.disconnectCount),
      })
    }

    this.dirty = true

    // Trim history
    if (this.connectionHistory.length > MAX_HISTORY * 2) {
      this.connectionHistory = this.connectionHistory.slice(-MAX_HISTORY)
    }
  }

  /**
   * Record disconnection event
   */
  recordDisconnection(peerId: string, duration: number, reason?: string): void {
    const peer = this.peers.get(peerId)
    if (!peer) return

    const event: ConnectionEvent = {
      peerId,
      type: 'disconnect',
      timestamp: Date.now(),
      duration,
      reason,
    }

    this.connectionHistory.push(event)
    peer.disconnectCount++
    this.updateScore(peerId, {
      uptime: peer.connectCount / (peer.connectCount + peer.disconnectCount),
    })

    this.dirty = true
  }

  /**
   * Get recent connection history for a peer
   */
  getConnectionHistory(peerId: string, limit = 10): ConnectionEvent[] {
    return this.connectionHistory
      .filter((e) => e.peerId === peerId)
      .slice(-limit)
  }

  // ============================================================================
  // Pruning
  // ============================================================================

  /**
   * Prune lowest scoring peers
   */
  private prunePeers(): void {
    const sorted = Array.from(this.peers.keys())
      .map((peerId) => ({
        peerId,
        score: this.scores.get(peerId)?.overall ?? 0,
        lastSeen: this.peers.get(peerId)?.lastSeen ?? 0,
      }))
      .sort((a, b) => {
        // Sort by score, then by last seen
        if (a.score !== b.score) return a.score - b.score
        return a.lastSeen - b.lastSeen
      })

    // Remove bottom 10%
    const toRemove = sorted.slice(0, Math.floor(sorted.length * 0.1))

    for (const { peerId } of toRemove) {
      this.peers.delete(peerId)
      this.scores.delete(peerId)
    }

    console.log(`[PeerStore] Pruned ${toRemove.length} peers`)
    this.dirty = true
  }

  /**
   * Prune stale peers (not seen in a long time)
   */
  pruneStale(maxAge: number): number {
    const now = Date.now()
    const stale: string[] = []

    for (const [peerId, peer] of this.peers) {
      if (now - peer.lastSeen > maxAge) {
        stale.push(peerId)
      }
    }

    for (const peerId of stale) {
      this.peers.delete(peerId)
      this.scores.delete(peerId)
    }

    if (stale.length > 0) {
      console.log(`[PeerStore] Pruned ${stale.length} stale peers`)
      this.dirty = true
    }

    return stale.length
  }

  // ============================================================================
  // Export/Import
  // ============================================================================

  /**
   * Export peer list for sharing
   */
  exportPeers(): Array<{
    peerId: string
    addresses: string[]
    services: string[]
  }> {
    return Array.from(this.peers.values())
      .filter((p) => (this.scores.get(p.peerId)?.overall ?? 0) > 0)
      .map((p) => ({
        peerId: p.peerId,
        addresses: p.addresses,
        services: p.services,
      }))
  }

  /**
   * Import peers from external source
   */
  importPeers(
    peers: Array<{ peerId: string; addresses: string[]; services?: string[] }>,
  ): number {
    let imported = 0

    for (const peer of peers) {
      if (!this.peers.has(peer.peerId)) {
        this.addPeer({
          peerId: peer.peerId,
          nodeId: peer.peerId,
          addresses: peer.addresses,
          protocols: [],
          services: peer.services ?? [],
          region: 'unknown',
          agentId: BigInt(0),
          metadata: {},
          lastSeen: Date.now(),
          lastConnect: 0,
        })
        imported++
      }
    }

    return imported
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createPeerStore(dataDir: string): PeerStore {
  return new PeerStore(dataDir)
}
