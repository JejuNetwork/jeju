/**
 * WebTorrent Backend - P2P Content Distribution
 *
 * Provides BitTorrent/WebTorrent-based content distribution:
 * - System content: All nodes seed core apps (free, capped bandwidth)
 * - Popular content: Incentivized seeding for hot content
 * - Private content: Encrypted, access-controlled seeding
 */

import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  ContentCategory,
  ContentTier,
  NodeStorageStats,
  StorageBackendType,
} from './types'

// Types

export interface TorrentInfo {
  infoHash: string
  magnetUri: string
  name: string
  size: number
  files: Array<{
    name: string
    path: string
    size: number
  }>
  cid: string // Associated CID
  tier: ContentTier
  category: ContentCategory
  createdAt: number
}

export interface TorrentStats {
  infoHash: string
  downloaded: number
  uploaded: number
  downloadSpeed: number
  uploadSpeed: number
  ratio: number
  peers: number
  seeds: number
  progress: number
  status: 'downloading' | 'seeding' | 'paused' | 'stopped'
}

export interface WebTorrentConfig {
  // Trackers
  trackers: string[]
  dhtEnabled: boolean

  // Storage
  downloadPath: string
  maxCacheSizeGB: number

  // Bandwidth limits
  maxDownloadSpeedMbps: number
  maxUploadSpeedMbps: number
  systemContentBandwidthMbps: number // Capped for free system content

  // Seeding
  maxSeedRatio: number
  seedTimeMinutes: number
  maxConcurrentTorrents: number

  // Content policy
  autoSeedSystemContent: boolean
  autoSeedPopularContent: boolean
  minPopularityScore: number
}

const DEFAULT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.opentrackr.org:31337',
  'udp://open.stealth.si:80/announce',
]

const DEFAULT_CONFIG: WebTorrentConfig = {
  trackers: DEFAULT_TRACKERS,
  dhtEnabled: true,
  downloadPath: './torrents',
  maxCacheSizeGB: 50,
  maxDownloadSpeedMbps: 100,
  maxUploadSpeedMbps: 50,
  systemContentBandwidthMbps: 10, // 10 Mbps for free system content
  maxSeedRatio: 2.0,
  seedTimeMinutes: 60,
  maxConcurrentTorrents: 50,
  autoSeedSystemContent: true,
  autoSeedPopularContent: true,
  minPopularityScore: 100,
}

// WebTorrent Backend

export class WebTorrentBackend extends EventEmitter {
  readonly name = 'webtorrent'
  readonly type: StorageBackendType = 'webtorrent'

  private config: WebTorrentConfig
  private torrents: Map<string, TorrentInfo> = new Map()
  private stats: Map<string, TorrentStats> = new Map()
  private cidToInfoHash: Map<string, string> = new Map()

  // Simulated torrent state (in production, use webtorrent library)
  private seeding: Set<string> = new Set()
  private downloading: Set<string> = new Set()

  // Bandwidth tracking
  private bandwidthUsed = {
    system: 0,
    popular: 0,
    private: 0,
  }

  constructor(config: Partial<WebTorrentConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Load config from environment
    if (process.env.WEBTORRENT_TRACKERS) {
      this.config.trackers = process.env.WEBTORRENT_TRACKERS.split(',')
    }
    if (process.env.WEBTORRENT_MAX_CACHE_GB) {
      this.config.maxCacheSizeGB = parseInt(
        process.env.WEBTORRENT_MAX_CACHE_GB,
        10,
      )
    }
    if (process.env.WEBTORRENT_SYSTEM_BW_MBPS) {
      this.config.systemContentBandwidthMbps = parseInt(
        process.env.WEBTORRENT_SYSTEM_BW_MBPS,
        10,
      )
    }
  }

  /**
   * Create torrent from content
   */
  async createTorrent(
    content: Buffer,
    options: {
      name: string
      cid: string
      tier: ContentTier
      category: ContentCategory
    },
  ): Promise<TorrentInfo> {
    const hash = createHash('sha1').update(content).digest('hex')
    const infoHash = hash.slice(0, 40)

    // Generate magnet URI
    const magnetParams = [
      `xt=urn:btih:${infoHash}`,
      `dn=${encodeURIComponent(options.name)}`,
      ...this.config.trackers.map((t) => `tr=${encodeURIComponent(t)}`),
      `xs=jeju:${options.cid}`, // Cross-seed with CID
    ]
    const magnetUri = `magnet:?${magnetParams.join('&')}`

    const torrentInfo: TorrentInfo = {
      infoHash,
      magnetUri,
      name: options.name,
      size: content.length,
      files: [
        {
          name: options.name,
          path: options.name,
          size: content.length,
        },
      ],
      cid: options.cid,
      tier: options.tier,
      category: options.category,
      createdAt: Date.now(),
    }

    this.torrents.set(infoHash, torrentInfo)
    this.cidToInfoHash.set(options.cid, infoHash)

    // Initialize stats
    this.stats.set(infoHash, {
      infoHash,
      downloaded: content.length,
      uploaded: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      ratio: 0,
      peers: 0,
      seeds: 1,
      progress: 1,
      status: 'seeding',
    })

    // Start seeding
    this.seeding.add(infoHash)
    this.emit('torrent:created', torrentInfo)

    console.log(`[WebTorrent] Created torrent: ${options.name} (${infoHash})`)
    return torrentInfo
  }

  /**
   * Add torrent from magnet URI
   */
  async addMagnet(
    magnetUri: string,
    options?: {
      tier?: ContentTier
      priority?: 'high' | 'normal' | 'low'
    },
  ): Promise<TorrentInfo> {
    const infoHash = this.extractInfoHash(magnetUri)
    if (!infoHash) {
      throw new Error('Invalid magnet URI')
    }

    // Check if already have this torrent
    const existing = this.torrents.get(infoHash)
    if (existing) {
      return existing
    }

    // Check bandwidth limits for tier
    const tier = options?.tier ?? 'popular'
    if (tier === 'system' && !this.canUseBandwidth('system')) {
      throw new Error('System content bandwidth limit reached')
    }

    // Parse magnet URI for metadata
    const params = new URLSearchParams(magnetUri.replace('magnet:?', ''))
    const name = params.get('dn') ?? infoHash
    const cidParam = params.get('xs')
    const cid = cidParam?.startsWith('jeju:') ? cidParam.slice(5) : undefined

    const torrentInfo: TorrentInfo = {
      infoHash,
      magnetUri,
      name,
      size: 0, // Unknown until downloaded
      files: [],
      cid: cid ?? infoHash,
      tier,
      category: 'data',
      createdAt: Date.now(),
    }

    this.torrents.set(infoHash, torrentInfo)
    if (cid) {
      this.cidToInfoHash.set(cid, infoHash)
    }

    // Initialize stats
    this.stats.set(infoHash, {
      infoHash,
      downloaded: 0,
      uploaded: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      ratio: 0,
      peers: 0,
      seeds: 0,
      progress: 0,
      status: 'downloading',
    })

    this.downloading.add(infoHash)
    this.emit('torrent:added', torrentInfo)

    console.log(`[WebTorrent] Added magnet: ${name} (${infoHash})`)
    return torrentInfo
  }

  /**
   * Download content via torrent
   */
  async download(cidOrInfoHash: string): Promise<Buffer> {
    // Look up by CID first
    let infoHash = this.cidToInfoHash.get(cidOrInfoHash)
    if (!infoHash && cidOrInfoHash.length === 40) {
      infoHash = cidOrInfoHash
    }

    if (!infoHash) {
      throw new Error(`Torrent not found: ${cidOrInfoHash}`)
    }

    const torrent = this.torrents.get(infoHash)
    if (!torrent) {
      throw new Error(`Torrent info not found: ${infoHash}`)
    }

    const stats = this.stats.get(infoHash)
    if (!stats || stats.progress < 1) {
      // Simulate download - in production, wait for actual download
      await this.simulateDownload(infoHash)
    }

    // In production, read from disk
    // For now, return placeholder
    const content = Buffer.from(`Torrent content: ${torrent.name}`)

    this.emit('torrent:downloaded', torrent)
    return content
  }

  /**
   * Start seeding a torrent
   */
  async startSeeding(infoHash: string): Promise<void> {
    const torrent = this.torrents.get(infoHash)
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`)
    }

    if (this.seeding.has(infoHash)) {
      return
    }

    // Check concurrent limit
    if (this.seeding.size >= this.config.maxConcurrentTorrents) {
      // Remove lowest priority torrent
      await this.evictLowestPriority()
    }

    this.seeding.add(infoHash)
    this.downloading.delete(infoHash)

    const stats = this.stats.get(infoHash)
    if (stats) {
      stats.status = 'seeding'
    }

    this.emit('torrent:seeding', torrent)
    console.log(`[WebTorrent] Started seeding: ${torrent.name}`)
  }

  /**
   * Stop seeding a torrent
   */
  async stopSeeding(infoHash: string): Promise<void> {
    const torrent = this.torrents.get(infoHash)
    if (!torrent) return

    // Don't allow stopping system content seeding
    if (torrent.tier === 'system' && this.config.autoSeedSystemContent) {
      console.warn(
        `[WebTorrent] Cannot stop seeding system content: ${torrent.name}`,
      )
      return
    }

    this.seeding.delete(infoHash)

    const stats = this.stats.get(infoHash)
    if (stats) {
      stats.status = 'stopped'
    }

    this.emit('torrent:stopped', torrent)
    console.log(`[WebTorrent] Stopped seeding: ${torrent.name}`)
  }

  /**
   * Remove torrent completely
   */
  async removeTorrent(infoHash: string): Promise<void> {
    const torrent = this.torrents.get(infoHash)
    if (!torrent) return

    // Don't allow removing system content
    if (torrent.tier === 'system' && this.config.autoSeedSystemContent) {
      throw new Error('Cannot remove system content')
    }

    this.seeding.delete(infoHash)
    this.downloading.delete(infoHash)
    this.torrents.delete(infoHash)
    this.stats.delete(infoHash)
    this.cidToInfoHash.delete(torrent.cid)

    this.emit('torrent:removed', torrent)
    console.log(`[WebTorrent] Removed torrent: ${torrent.name}`)
  }

  /**
   * Get torrent info by CID or infoHash
   */
  getTorrent(cidOrInfoHash: string): TorrentInfo | null {
    let infoHash = this.cidToInfoHash.get(cidOrInfoHash)
    if (!infoHash && cidOrInfoHash.length === 40) {
      infoHash = cidOrInfoHash
    }
    return infoHash ? (this.torrents.get(infoHash) ?? null) : null
  }

  /**
   * Get torrent stats
   */
  getTorrentStats(infoHash: string): TorrentStats | null {
    return this.stats.get(infoHash) ?? null
  }

  /**
   * Get all torrents by tier
   */
  getTorrentsByTier(tier: ContentTier): TorrentInfo[] {
    return Array.from(this.torrents.values()).filter((t) => t.tier === tier)
  }

  /**
   * Get magnet URI for CID
   */
  getMagnetUri(cid: string): string | null {
    const infoHash = this.cidToInfoHash.get(cid)
    if (!infoHash) return null
    return this.torrents.get(infoHash)?.magnetUri ?? null
  }

  /**
   * Check if content is available via torrent
   */
  hasTorrent(cidOrInfoHash: string): boolean {
    const infoHash = this.cidToInfoHash.get(cidOrInfoHash) ?? cidOrInfoHash
    return this.torrents.has(infoHash)
  }

  /**
   * Seed system content manifest
   */
  async seedSystemContent(
    content: Array<{ cid: string; name: string; data: Buffer }>,
  ): Promise<Map<string, TorrentInfo>> {
    const results = new Map<string, TorrentInfo>()

    for (const item of content) {
      const torrent = await this.createTorrent(item.data, {
        name: item.name,
        cid: item.cid,
        tier: 'system',
        category: 'app-bundle',
      })
      results.set(item.cid, torrent)
    }

    console.log(`[WebTorrent] Seeding ${results.size} system content items`)
    return results
  }

  /**
   * Auto-replicate popular content
   */
  async replicatePopular(
    content: Array<{ cid: string; magnetUri: string; score: number }>,
  ): Promise<void> {
    // Filter by minimum popularity score
    const eligible = content.filter(
      (c) => c.score >= this.config.minPopularityScore,
    )

    // Sort by score descending
    eligible.sort((a, b) => b.score - a.score)

    // Add top content up to cache limit
    let addedSize = 0
    const maxSize = this.config.maxCacheSizeGB * 1024 * 1024 * 1024

    for (const item of eligible) {
      if (addedSize >= maxSize) break
      if (this.hasTorrent(item.cid)) continue

      const torrent = await this.addMagnet(item.magnetUri, { tier: 'popular' })
      addedSize += torrent.size
    }

    console.log(`[WebTorrent] Replicating ${eligible.length} popular items`)
  }

  /**
   * Get node storage stats
   */
  getNodeStats(): Partial<NodeStorageStats> {
    let systemSize = 0
    let popularSize = 0
    let privateSize = 0
    let totalUploaded = 0

    for (const [infoHash, torrent] of this.torrents) {
      const stats = this.stats.get(infoHash)
      if (!stats) continue

      totalUploaded += stats.uploaded

      switch (torrent.tier) {
        case 'system':
          systemSize += torrent.size
          break
        case 'popular':
          popularSize += torrent.size
          break
        case 'private':
          privateSize += torrent.size
          break
      }
    }

    return {
      systemContentCount: this.getTorrentsByTier('system').length,
      systemContentSize: systemSize,
      popularContentCount: this.getTorrentsByTier('popular').length,
      popularContentSize: popularSize,
      privateContentCount: this.getTorrentsByTier('private').length,
      privateContentSize: privateSize,
      activeTorrents: this.seeding.size + this.downloading.size,
      seedingTorrents: this.seeding.size,
      downloadingTorrents: this.downloading.size,
      peersConnected: this.getTotalPeers(),
      bytesServed24h: totalUploaded,
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    // In production, check WebTorrent client status
    return this.config.dhtEnabled || this.config.trackers.length > 0
  }

  // Private Helpers

  private extractInfoHash(magnetUri: string): string | null {
    const match = magnetUri.match(/btih:([a-fA-F0-9]{40})/)
    return match ? match[1].toLowerCase() : null
  }

  private canUseBandwidth(tier: ContentTier): boolean {
    if (tier === 'system') {
      const limitBytes = this.config.systemContentBandwidthMbps * 125000 // Mbps to bytes/sec
      return this.bandwidthUsed.system < limitBytes
    }
    return true
  }

  private async simulateDownload(infoHash: string): Promise<void> {
    const stats = this.stats.get(infoHash)
    if (!stats) return

    // Simulate download progress
    stats.progress = 1
    stats.status = 'seeding'
    this.downloading.delete(infoHash)
    this.seeding.add(infoHash)
  }

  private async evictLowestPriority(): Promise<void> {
    // Find lowest priority popular content to evict
    const popularTorrents = this.getTorrentsByTier('popular')
    if (popularTorrents.length === 0) return

    // Sort by ratio (evict highest ratio first - already contributed enough)
    const sorted = popularTorrents
      .map((t) => ({ torrent: t, stats: this.stats.get(t.infoHash) }))
      .filter((x) => x.stats)
      .sort((a, b) => (b.stats?.ratio ?? 0) - (a.stats?.ratio ?? 0))

    if (sorted.length > 0 && sorted[0]) {
      await this.removeTorrent(sorted[0].torrent.infoHash)
    }
  }

  private getTotalPeers(): number {
    let total = 0
    for (const stats of this.stats.values()) {
      total += stats.peers
    }
    return total
  }
}

// Factory

let globalWebTorrentBackend: WebTorrentBackend | null = null

export function getWebTorrentBackend(
  config?: Partial<WebTorrentConfig>,
): WebTorrentBackend {
  if (!globalWebTorrentBackend) {
    globalWebTorrentBackend = new WebTorrentBackend(config)
  }
  return globalWebTorrentBackend
}

export function resetWebTorrentBackend(): void {
  globalWebTorrentBackend = null
}
