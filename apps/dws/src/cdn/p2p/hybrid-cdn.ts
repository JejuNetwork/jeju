/**
 * Hybrid CDN - Edge Caching + WebTorrent P2P Distribution
 *
 * Combines traditional CDN edge caching with BitTorrent/WebTorrent P2P
 * distribution for maximum performance and decentralization:
 *
 * 1. Edge Cache: Fast, local LRU cache for hot content
 * 2. WebTorrent: P2P swarm for popular content distribution
 * 3. Coordination: GossipSub for magnet URI propagation
 *
 * Content Flow:
 * - Request comes in → Check edge cache
 * - Cache miss → Check WebTorrent swarm
 * - P2P miss → Fetch from origin (IPFS/Arweave)
 * - Optionally seed popular content to swarm
 *
 * Benefits:
 * - Reduced origin load (popular content is P2P)
 * - Better performance as content gets more popular
 * - Works in browsers via WebRTC
 * - Fallback to traditional CDN if P2P fails
 */

import { EventEmitter } from 'node:events'
import type { EdgeCache } from '../../../api/cdn'
import type { ContentCategory, ContentTier } from '../../../api/storage/types'
import {
  getWebTorrentBackend,
  type TorrentInfo,
  type TorrentStats,
  type WebTorrentBackend,
} from '../../../api/storage/webtorrent-backend'
import type { CDNGossipCoordinator } from '../coordination/gossip-coordinator'

// Configuration
export interface HybridCDNConfig {
  // P2P settings
  enableP2P: boolean
  p2pThreshold: number // Min access count before P2P distribution
  p2pMinSize: number // Min content size for P2P (bytes)
  p2pMaxSize: number // Max content size for P2P (bytes)

  // Seeding settings
  autoSeedPopular: boolean
  popularityThreshold: number // Score threshold for auto-seeding
  maxSeedingTorrents: number
  seedRatioTarget: number

  // Bandwidth allocation
  p2pBandwidthPercent: number // % of total bandwidth for P2P
  systemContentPriority: boolean // Prioritize system content seeding

  // Fallback settings
  p2pTimeout: number // Max time to wait for P2P (ms)
  fallbackToOrigin: boolean // Fallback if P2P fails
}

const DEFAULT_CONFIG: HybridCDNConfig = {
  enableP2P: true,
  p2pThreshold: 10, // 10 accesses before P2P
  p2pMinSize: 10 * 1024, // 10KB minimum
  p2pMaxSize: 100 * 1024 * 1024, // 100MB maximum

  autoSeedPopular: true,
  popularityThreshold: 50,
  maxSeedingTorrents: 100,
  seedRatioTarget: 2.0,

  p2pBandwidthPercent: 50,
  systemContentPriority: true,

  p2pTimeout: 10000, // 10 seconds
  fallbackToOrigin: true,
}

// Content popularity tracking
interface ContentPopularity {
  cid: string
  accessCount: number
  accessCount24h: number
  lastAccessed: number
  p2pEnabled: boolean
  magnetUri?: string
  infoHash?: string
  seederCount: number
  downloadCount: number
}

// Request result with source tracking
export interface HybridCDNResult {
  content: Buffer
  source: 'edge-cache' | 'p2p-swarm' | 'origin'
  latencyMs: number
  p2pStats?: {
    peers: number
    downloadSpeed: number
  }
}

// Event types
export interface HybridCDNEvents {
  'content:cached': { cid: string; size: number }
  'content:p2p-enabled': { cid: string; magnetUri: string }
  'content:p2p-downloaded': { cid: string; peers: number; latencyMs: number }
  'content:origin-fetch': { cid: string; latencyMs: number }
  'swarm:peer-connected': { infoHash: string; peers: number }
  'swarm:seeding-started': { cid: string; magnetUri: string }
}

/**
 * Hybrid CDN combining edge caching with WebTorrent P2P
 */
export class HybridCDN extends EventEmitter {
  private config: HybridCDNConfig
  private edgeCache: EdgeCache
  private webtorrent: WebTorrentBackend
  private coordinator?: CDNGossipCoordinator
  private popularity: Map<string, ContentPopularity> = new Map()
  private magnetIndex: Map<string, string> = new Map() // cid -> magnetUri

  constructor(
    edgeCache: EdgeCache,
    config: Partial<HybridCDNConfig> = {},
    coordinator?: CDNGossipCoordinator,
  ) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.edgeCache = edgeCache
    this.webtorrent = getWebTorrentBackend()
    this.coordinator = coordinator

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    // Listen for WebTorrent events
    this.webtorrent.on('torrent:created', (info: TorrentInfo) => {
      this.magnetIndex.set(info.cid, info.magnetUri)
      this.emit('content:p2p-enabled', {
        cid: info.cid,
        magnetUri: info.magnetUri,
      })

      // Broadcast magnet URI to other nodes via coordination
      if (this.coordinator) {
        this.coordinator.broadcastMagnetUri(info.cid, info.magnetUri)
      }
    })

    this.webtorrent.on('torrent:done', (info: TorrentInfo) => {
      this.emit('swarm:seeding-started', {
        cid: info.cid,
        magnetUri: info.magnetUri,
      })
    })

    // Listen for coordinator events (magnet URIs from other nodes)
    if (this.coordinator) {
      this.coordinator.on(
        'magnet:received',
        (data: { cid: string; magnetUri: string }) => {
          this.magnetIndex.set(data.cid, data.magnetUri)
        },
      )
    }
  }

  /**
   * Get content using hybrid CDN strategy
   */
  async get(
    cid: string,
    options: {
      originFetcher: () => Promise<Buffer>
      contentType?: string
      tier?: ContentTier
      category?: ContentCategory
    },
  ): Promise<HybridCDNResult> {
    const startTime = Date.now()

    // Track popularity
    this.trackAccess(cid)

    // 1. Check edge cache first (fastest)
    const cacheResult = this.edgeCache.get(cid)
    if (
      cacheResult.entry &&
      (cacheResult.status === 'HIT' || cacheResult.status === 'STALE')
    ) {
      return {
        content:
          cacheResult.entry.data instanceof Buffer
            ? cacheResult.entry.data
            : Buffer.from(cacheResult.entry.data),
        source: 'edge-cache',
        latencyMs: Date.now() - startTime,
      }
    }

    // 2. Check P2P swarm if enabled and content has magnet
    if (this.config.enableP2P) {
      const magnetUri = this.magnetIndex.get(cid)
      if (magnetUri) {
        const p2pResult = await this.tryP2PDownload(cid, magnetUri)
        if (p2pResult) {
          // Cache the content for future requests
          this.edgeCache.set(cid, p2pResult.content, {
            contentType: options.contentType,
          })

          return {
            content: p2pResult.content,
            source: 'p2p-swarm',
            latencyMs: Date.now() - startTime,
            p2pStats: p2pResult.stats,
          }
        }
      }
    }

    // 3. Fetch from origin
    const content = await options.originFetcher()
    const latencyMs = Date.now() - startTime

    // Cache the content
    this.edgeCache.set(cid, content, {
      contentType: options.contentType,
    })

    this.emit('content:origin-fetch', { cid, latencyMs })

    // 4. Consider enabling P2P for this content
    await this.maybeEnableP2P(cid, content, options)

    return {
      content,
      source: 'origin',
      latencyMs,
    }
  }

  /**
   * Store content and optionally seed via P2P
   */
  async put(
    cid: string,
    content: Buffer,
    options: {
      contentType?: string
      tier?: ContentTier
      category?: ContentCategory
      enableP2P?: boolean
      name?: string
    } = {},
  ): Promise<{ magnetUri?: string }> {
    // Store in edge cache
    this.edgeCache.set(cid, content, {
      contentType: options.contentType,
    })

    this.emit('content:cached', { cid, size: content.length })

    // Enable P2P if requested or if content meets criteria
    const shouldP2P =
      options.enableP2P ??
      (this.config.enableP2P &&
        content.length >= this.config.p2pMinSize &&
        content.length <= this.config.p2pMaxSize)

    if (shouldP2P) {
      const torrent = await this.webtorrent.createTorrent(content, {
        name: options.name ?? cid,
        cid,
        tier: options.tier ?? 'popular',
        category: options.category ?? 'data',
      })

      return { magnetUri: torrent.magnetUri }
    }

    return {}
  }

  /**
   * Add magnet URI for content (from external source or other nodes)
   */
  addMagnet(cid: string, magnetUri: string): void {
    this.magnetIndex.set(cid, magnetUri)
  }

  /**
   * Get magnet URI for content
   */
  getMagnet(cid: string): string | undefined {
    return (
      this.magnetIndex.get(cid) ??
      this.webtorrent.getMagnetUri(cid) ??
      undefined
    )
  }

  /**
   * Check if content is available via P2P
   */
  hasP2P(cid: string): boolean {
    return this.magnetIndex.has(cid) || this.webtorrent.hasTorrent(cid)
  }

  /**
   * Get popularity stats for content
   */
  getPopularity(cid: string): ContentPopularity | undefined {
    return this.popularity.get(cid)
  }

  /**
   * Get all content sorted by popularity
   */
  getPopularContent(limit = 100): ContentPopularity[] {
    return Array.from(this.popularity.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit)
  }

  /**
   * Get P2P swarm stats
   */
  getSwarmStats(): {
    activeTorrents: number
    seedingTorrents: number
    totalPeers: number
    downloadSpeed: number
    uploadSpeed: number
  } {
    const nodeStats = this.webtorrent.getNodeStats()

    return {
      activeTorrents: nodeStats.activeTorrents ?? 0,
      seedingTorrents: nodeStats.seedingTorrents ?? 0,
      totalPeers: nodeStats.peersConnected ?? 0,
      downloadSpeed: 0, // TODO: aggregate from torrents
      uploadSpeed: 0,
    }
  }

  /**
   * Get stats for a specific torrent
   */
  getTorrentStats(cid: string): TorrentStats | null {
    const infoHash = this.webtorrent.getTorrent(cid)?.infoHash
    return infoHash ? this.webtorrent.getTorrentStats(infoHash) : null
  }

  /**
   * Manually seed content to the P2P swarm
   */
  async seedContent(
    cid: string,
    content: Buffer,
    options: {
      name?: string
      tier?: ContentTier
      category?: ContentCategory
    } = {},
  ): Promise<TorrentInfo> {
    return this.webtorrent.createTorrent(content, {
      name: options.name ?? cid,
      cid,
      tier: options.tier ?? 'popular',
      category: options.category ?? 'data',
    })
  }

  /**
   * Stop seeding content
   */
  async stopSeeding(cid: string): Promise<void> {
    const torrent = this.webtorrent.getTorrent(cid)
    if (torrent) {
      await this.webtorrent.stopSeeding(torrent.infoHash)
    }
  }

  /**
   * Sync popular content from the network
   */
  async syncPopularContent(
    content: Array<{ cid: string; magnetUri: string; score: number }>,
  ): Promise<void> {
    // Add magnet URIs to index
    for (const item of content) {
      this.magnetIndex.set(item.cid, item.magnetUri)
    }

    // Let WebTorrent handle replication of popular content
    await this.webtorrent.replicatePopular(content)
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    edgeCache: boolean
    webtorrent: boolean
    p2pEnabled: boolean
  }> {
    return {
      edgeCache: true, // Edge cache is always available
      webtorrent: await this.webtorrent.healthCheck(),
      p2pEnabled: this.config.enableP2P,
    }
  }

  // Private methods

  private trackAccess(cid: string): void {
    let pop = this.popularity.get(cid)

    if (!pop) {
      pop = {
        cid,
        accessCount: 0,
        accessCount24h: 0,
        lastAccessed: 0,
        p2pEnabled: false,
        seederCount: 0,
        downloadCount: 0,
      }
      this.popularity.set(cid, pop)
    }

    pop.accessCount++
    pop.accessCount24h++
    pop.lastAccessed = Date.now()

    // Update P2P info if available
    const torrent = this.webtorrent.getTorrent(cid)
    if (torrent) {
      pop.p2pEnabled = true
      pop.magnetUri = torrent.magnetUri
      pop.infoHash = torrent.infoHash

      const stats = this.webtorrent.getTorrentStats(torrent.infoHash)
      if (stats) {
        pop.seederCount = stats.seeds
        pop.downloadCount = stats.downloaded
      }
    }
  }

  private async tryP2PDownload(
    cid: string,
    magnetUri: string,
  ): Promise<{
    content: Buffer
    stats: { peers: number; downloadSpeed: number }
  } | null> {
    // Check if we already have this torrent
    let torrent = this.webtorrent.getTorrent(cid)

    if (!torrent) {
      // Add the torrent
      const addPromise = this.webtorrent.addMagnet(magnetUri, {
        tier: 'popular',
      })

      // Race against timeout
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), this.config.p2pTimeout)
      })

      const result = await Promise.race([addPromise, timeoutPromise])
      if (!result) {
        // Timeout - P2P too slow, will fall back to origin
        return null
      }

      torrent = result
    }

    // Try to download content
    const downloadPromise = (async () => {
      const content = await this.webtorrent.download(cid)
      const stats = this.webtorrent.getTorrentStats(torrent?.infoHash)

      return {
        content,
        stats: {
          peers: stats?.peers ?? 0,
          downloadSpeed: stats?.downloadSpeed ?? 0,
        },
      }
    })()

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), this.config.p2pTimeout)
    })

    const downloadResult = await Promise.race([downloadPromise, timeoutPromise])

    if (downloadResult) {
      this.emit('content:p2p-downloaded', {
        cid,
        peers: downloadResult.stats.peers,
        latencyMs: Date.now(),
      })
    }

    return downloadResult
  }

  private async maybeEnableP2P(
    cid: string,
    content: Buffer,
    options: {
      tier?: ContentTier
      category?: ContentCategory
    },
  ): Promise<void> {
    if (!this.config.enableP2P || !this.config.autoSeedPopular) {
      return
    }

    // Check if content meets P2P criteria
    if (content.length < this.config.p2pMinSize) {
      return
    }

    if (content.length > this.config.p2pMaxSize) {
      return
    }

    // Check if already P2P enabled
    if (this.webtorrent.hasTorrent(cid)) {
      return
    }

    // Check popularity threshold
    const pop = this.popularity.get(cid)
    if (!pop || pop.accessCount < this.config.p2pThreshold) {
      return
    }

    // Check if we're at max seeding torrents
    const stats = this.webtorrent.getNodeStats()
    if ((stats.seedingTorrents ?? 0) >= this.config.maxSeedingTorrents) {
      return
    }

    // Create torrent and start seeding
    console.log(`[HybridCDN] Auto-enabling P2P for popular content: ${cid}`)

    await this.webtorrent.createTorrent(content, {
      name: cid,
      cid,
      tier: options.tier ?? 'popular',
      category: options.category ?? 'data',
    })
  }
}

// Factory function
export function createHybridCDN(
  edgeCache: EdgeCache,
  config?: Partial<HybridCDNConfig>,
  coordinator?: CDNGossipCoordinator,
): HybridCDN {
  return new HybridCDN(edgeCache, config, coordinator)
}
