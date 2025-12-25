/**
 * WebTorrent Backend - P2P Content Distribution
 *
 * Provides BitTorrent/WebTorrent-based content distribution:
 * - System content: All nodes seed core apps (free, capped bandwidth)
 * - Popular content: Incentivized seeding for hot content
 * - Private content: Encrypted, access-controlled seeding
 */

import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ContentCategory,
  ContentTier,
  NodeStorageStats,
  StorageBackendType,
} from './types'

// Lazy-load webtorrent to avoid native module issues in test environments
type WebTorrentInstance = {
  destroyed: boolean
  torrents: Array<{
    infoHash: string
    magnetURI: string
    name: string
    length: number
    files: Array<{
      name: string
      path: string
      length: number
      createReadStream(): NodeJS.ReadableStream
    }>
    done: boolean
    paused: boolean
    downloaded: number
    uploaded: number
    downloadSpeed: number
    uploadSpeed: number
    ratio: number
    numPeers: number
    progress: number
    on(event: string, cb: (...args: unknown[]) => void): void
    pause(): void
    resume(): void
  }>
  seed(
    path: string,
    opts: Record<string, unknown>,
    cb: (torrent: WebTorrentInstance['torrents'][0]) => void,
  ): void
  add(
    magnetUri: string,
    opts: Record<string, unknown>,
    cb: (torrent: WebTorrentInstance['torrents'][0]) => void,
  ): void
  get(infoHash: string): WebTorrentInstance['torrents'][0] | null
  remove(
    infoHash: string,
    opts: { destroyStore?: boolean },
    cb: (err: Error | null) => void,
  ): void
  destroy(cb: () => void): void
  on(event: string, cb: (...args: unknown[]) => void): void
  once(event: string, cb: (...args: unknown[]) => void): void
}

let WebTorrent: {
  new (opts?: Record<string, unknown>): WebTorrentInstance
} | null = null

async function loadWebTorrent(): Promise<NonNullable<typeof WebTorrent>> {
  if (!WebTorrent) {
    const mod = await import('webtorrent')
    WebTorrent = mod.default as NonNullable<typeof WebTorrent>
  }
  return WebTorrent
}

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
  private client: WebTorrentInstance | null = null
  private clientInitPromise: Promise<WebTorrentInstance> | null = null

  /** Get client, asserting it's initialized (use after await getClient()) */
  private get clientOrThrow(): WebTorrentInstance {
    if (!this.client) {
      throw new Error('WebTorrent client not initialized')
    }
    return this.client
  }
  private torrentMetadata: Map<string, TorrentInfo> = new Map()
  private cidToInfoHash: Map<string, string> = new Map()

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

    // Ensure download path exists
    if (!existsSync(this.config.downloadPath)) {
      mkdirSync(this.config.downloadPath, { recursive: true })
    }
  }

  /**
   * Lazily initialize the WebTorrent client
   */
  private async getClient(): Promise<WebTorrentInstance> {
    if (this.client) return this.client

    if (!this.clientInitPromise) {
      this.clientInitPromise = (async () => {
        const WT = await loadWebTorrent()
        if (!WT) throw new Error('Failed to load WebTorrent')

        const client = new WT({
          dht: this.config.dhtEnabled,
          downloadLimit: this.config.maxDownloadSpeedMbps * 125000,
          uploadLimit: this.config.maxUploadSpeedMbps * 125000,
          maxConns: 100,
        })

        client.on('error', (err) => {
          console.error('[WebTorrent] Client error:', err)
          this.emit('error', err)
        })

        this.client = client
        console.log('[WebTorrent] Client initialized')
        return client
      })()
    }

    return this.clientInitPromise
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
    const client = await this.getClient()

    // Write content to temp file for seeding
    const tempPath = join(this.config.downloadPath, options.name)
    writeFileSync(tempPath, content)

    return new Promise((resolve, reject) => {
      client.seed(
        tempPath,
        {
          name: options.name,
          announce: this.config.trackers,
          comment: `jeju:${options.cid}`, // Cross-seed with CID
        },
        (torrent) => {
          const torrentInfo: TorrentInfo = {
            infoHash: torrent.infoHash,
            magnetUri: torrent.magnetURI,
            name: torrent.name,
            size: torrent.length,
            files: torrent.files.map((f) => ({
              name: f.name,
              path: f.path,
              size: f.length,
            })),
            cid: options.cid,
            tier: options.tier,
            category: options.category,
            createdAt: Date.now(),
          }

          this.torrentMetadata.set(torrent.infoHash, torrentInfo)
          this.cidToInfoHash.set(options.cid, torrent.infoHash)

          // Set up event listeners
          this.setupTorrentEvents(torrent, torrentInfo)

          this.emit('torrent:created', torrentInfo)
          console.log(
            `[WebTorrent] Created torrent: ${options.name} (${torrent.infoHash})`,
          )
          resolve(torrentInfo)
        },
      )

      // Handle seed error
      client.once('error', reject)
    })
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
    const existing = this.torrentMetadata.get(infoHash)
    if (existing) {
      return existing
    }

    // Check bandwidth limits for tier
    const tier = options?.tier ?? 'popular'
    if (tier === 'system' && !this.canUseBandwidth('system')) {
      throw new Error('System content bandwidth limit reached')
    }

    // Check concurrent limit
    if (this.clientOrThrow.torrents.length >= this.config.maxConcurrentTorrents) {
      await this.evictLowestPriority()
    }

    return new Promise((resolve, reject) => {
      this.clientOrThrow.add(
        magnetUri,
        {
          path: this.config.downloadPath,
          announce: this.config.trackers,
        },
        (torrent) => {
          // Parse magnet URI for CID
          const params = new URLSearchParams(magnetUri.replace('magnet:?', ''))
          const cidParam = params.get('xs')
          const cid = cidParam?.startsWith('jeju:')
            ? cidParam.slice(5)
            : undefined

          const torrentInfo: TorrentInfo = {
            infoHash: torrent.infoHash,
            magnetUri: torrent.magnetURI,
            name: torrent.name,
            size: torrent.length,
            files: torrent.files.map((f) => ({
              name: f.name,
              path: f.path,
              size: f.length,
            })),
            cid: cid ?? torrent.infoHash,
            tier,
            category: 'data',
            createdAt: Date.now(),
          }

          this.torrentMetadata.set(torrent.infoHash, torrentInfo)
          if (cid) {
            this.cidToInfoHash.set(cid, torrent.infoHash)
          }

          // Set up event listeners
          this.setupTorrentEvents(torrent, torrentInfo)

          this.emit('torrent:added', torrentInfo)
          console.log(
            `[WebTorrent] Added magnet: ${torrent.name} (${torrent.infoHash})`,
          )
          resolve(torrentInfo)
        },
      )

      this.clientOrThrow.once('error', reject)
    })
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

    const torrent = this.clientOrThrow.get(infoHash)
    if (!torrent) {
      throw new Error(`Torrent not in client: ${infoHash}`)
    }

    // Wait for download to complete if not done
    if (!torrent.done) {
      await new Promise<void>((resolve) => {
        torrent.on('done', () => resolve())
      })
    }

    // Read the first file's content
    const file = torrent.files[0]
    if (!file) {
      throw new Error('Torrent has no files')
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = file.createReadStream()

      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        const content = Buffer.concat(chunks)
        this.emit('torrent:downloaded', this.torrentMetadata.get(infoHash))
        resolve(content)
      })
      stream.on('error', reject)
    })
  }

  /**
   * Start seeding a torrent (already downloaded)
   */
  async startSeeding(infoHash: string): Promise<void> {
    const torrent = this.clientOrThrow.get(infoHash)
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`)
    }

    // WebTorrent automatically seeds after download completes
    // Just ensure it's not paused
    torrent.resume()

    this.emit('torrent:seeding', this.torrentMetadata.get(infoHash))
    console.log(`[WebTorrent] Started seeding: ${torrent.name}`)
  }

  /**
   * Stop seeding a torrent
   */
  async stopSeeding(infoHash: string): Promise<void> {
    const torrentInfo = this.torrentMetadata.get(infoHash)
    if (!torrentInfo) return

    // Don't allow stopping system content seeding
    if (torrentInfo.tier === 'system' && this.config.autoSeedSystemContent) {
      console.warn(
        `[WebTorrent] Cannot stop seeding system content: ${torrentInfo.name}`,
      )
      return
    }

    const torrent = this.clientOrThrow.get(infoHash)
    if (torrent) {
      torrent.pause()
    }

    this.emit('torrent:stopped', torrentInfo)
    console.log(`[WebTorrent] Stopped seeding: ${torrentInfo.name}`)
  }

  /**
   * Remove torrent completely
   */
  async removeTorrent(infoHash: string): Promise<void> {
    const torrentInfo = this.torrentMetadata.get(infoHash)
    if (!torrentInfo) return

    // Don't allow removing system content
    if (torrentInfo.tier === 'system' && this.config.autoSeedSystemContent) {
      throw new Error('Cannot remove system content')
    }

    return new Promise((resolve, reject) => {
      this.clientOrThrow.remove(infoHash, { destroyStore: true }, (err) => {
        if (err) {
          reject(err)
          return
        }

        this.torrentMetadata.delete(infoHash)
        this.cidToInfoHash.delete(torrentInfo.cid)

        this.emit('torrent:removed', torrentInfo)
        console.log(`[WebTorrent] Removed torrent: ${torrentInfo.name}`)
        resolve()
      })
    })
  }

  /**
   * Get torrent info by CID or infoHash
   */
  getTorrent(cidOrInfoHash: string): TorrentInfo | null {
    let infoHash = this.cidToInfoHash.get(cidOrInfoHash)
    if (!infoHash && cidOrInfoHash.length === 40) {
      infoHash = cidOrInfoHash
    }
    return infoHash ? (this.torrentMetadata.get(infoHash) ?? null) : null
  }

  /**
   * Get torrent stats
   */
  getTorrentStats(infoHash: string): TorrentStats | null {
    const torrent = this.clientOrThrow.get(infoHash)
    if (!torrent) return null

    return {
      infoHash,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      ratio: torrent.ratio,
      peers: torrent.numPeers,
      seeds: torrent.numPeers, // WebTorrent doesn't distinguish seeds
      progress: torrent.progress,
      status: torrent.done
        ? torrent.paused
          ? 'paused'
          : 'seeding'
        : 'downloading',
    }
  }

  /**
   * Get all torrents by tier
   */
  getTorrentsByTier(tier: ContentTier): TorrentInfo[] {
    return Array.from(this.torrentMetadata.values()).filter(
      (t) => t.tier === tier,
    )
  }

  /**
   * Get magnet URI for CID
   */
  getMagnetUri(cid: string): string | null {
    const infoHash = this.cidToInfoHash.get(cid)
    if (!infoHash) return null
    return this.torrentMetadata.get(infoHash)?.magnetUri ?? null
  }

  /**
   * Check if content is available via torrent
   */
  hasTorrent(cidOrInfoHash: string): boolean {
    const infoHash = this.cidToInfoHash.get(cidOrInfoHash) ?? cidOrInfoHash
    return this.torrentMetadata.has(infoHash)
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
    let seedingCount = 0
    let downloadingCount = 0

    for (const torrent of this.clientOrThrow.torrents) {
      const info = this.torrentMetadata.get(torrent.infoHash)
      if (!info) continue

      totalUploaded += torrent.uploaded

      if (torrent.done) {
        seedingCount++
      } else {
        downloadingCount++
      }

      switch (info.tier) {
        case 'system':
          systemSize += torrent.length
          break
        case 'popular':
          popularSize += torrent.length
          break
        case 'private':
          privateSize += torrent.length
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
      activeTorrents: this.clientOrThrow.torrents.length,
      seedingTorrents: seedingCount,
      downloadingTorrents: downloadingCount,
      peersConnected: this.getTotalPeers(),
      bytesServed24h: totalUploaded,
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return !this.clientOrThrow.destroyed
  }

  /**
   * Destroy the client
   */
  async destroy(): Promise<void> {
    return new Promise((resolve) => {
      this.clientOrThrow.destroy(() => {
        console.log('[WebTorrent] Client destroyed')
        resolve()
      })
    })
  }

  // Private Helpers

  private setupTorrentEvents(
    torrent: WebTorrentInstance['torrents'][0],
    info: TorrentInfo,
  ): void {
    torrent.on('done', () => {
      console.log(`[WebTorrent] Download complete: ${info.name}`)
      this.emit('torrent:done', info)
    })

    torrent.on('error', (err) => {
      console.error(`[WebTorrent] Torrent error (${info.name}):`, err)
      this.emit('torrent:error', { info, error: err as Error })
    })

    torrent.on('warning', (warning) => {
      console.warn(`[WebTorrent] Torrent warning (${info.name}):`, warning)
    })
  }

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

  private async evictLowestPriority(): Promise<void> {
    // Find lowest priority popular content to evict
    const popularTorrents = this.getTorrentsByTier('popular')
    if (popularTorrents.length === 0) return

    // Sort by ratio (evict highest ratio first - already contributed enough)
    const sorted = popularTorrents
      .map((t) => ({
        torrent: t,
        stats: this.getTorrentStats(t.infoHash),
      }))
      .filter((x) => x.stats)
      .sort((a, b) => (b.stats?.ratio ?? 0) - (a.stats?.ratio ?? 0))

    if (sorted.length > 0 && sorted[0]) {
      await this.removeTorrent(sorted[0].torrent.infoHash)
    }
  }

  private getTotalPeers(): number {
    let total = 0
    for (const torrent of this.clientOrThrow.torrents) {
      total += torrent.numPeers
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
  if (globalWebTorrentBackend) {
    globalWebTorrentBackend.destroy().catch(console.error)
  }
  globalWebTorrentBackend = null
}
