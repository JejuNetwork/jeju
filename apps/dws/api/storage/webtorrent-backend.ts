<<<<<<< HEAD
=======
/**
 * WebTorrent Backend - P2P Content Distribution
 *
 * Provides BitTorrent/WebTorrent-based content distribution:
 * - System content: All nodes seed core apps (free, capped bandwidth)
 * - Popular content: Incentivized seeding for hot content
 * - Private content: Encrypted, access-controlled seeding
 *
 * Workerd compatible: Uses S3-compatible DWS storage backend.
 * State persistence: Uses EQLite for distributed torrent metadata tracking.
 */

import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
>>>>>>> db0e2406eef4fd899ba4a5aa090db201bcbe36bf
import { WorkerdEventEmitter } from '../utils/event-emitter'
import type { BackendManager } from './backends'
import { S3Backend } from './s3-backend'
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

// ============ EQLite State Storage ============

const TORRENT_DB_ID = process.env.EQLITE_DATABASE_ID ?? 'dws-webtorrent'

let eqliteClient: EQLiteClient | null = null
let tablesInitialized = false

async function getTorrentEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite({
      databaseId: TORRENT_DB_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })
  }
  return eqliteClient
}

async function ensureTorrentTables(): Promise<void> {
  if (tablesInitialized) return

  const client = await getTorrentEQLiteClient()

  await client.exec(
    `CREATE TABLE IF NOT EXISTS torrent_metadata (
      info_hash TEXT PRIMARY KEY,
      magnet_uri TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      files TEXT NOT NULL,
      cid TEXT NOT NULL,
      tier TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    [],
    TORRENT_DB_ID,
  )

  await client.exec(
    `CREATE INDEX IF NOT EXISTS idx_torrent_cid ON torrent_metadata(cid)`,
    [],
    TORRENT_DB_ID,
  )
  await client.exec(
    `CREATE INDEX IF NOT EXISTS idx_torrent_tier ON torrent_metadata(tier)`,
    [],
    TORRENT_DB_ID,
  )

  tablesInitialized = true
}

interface TorrentMetadataRow {
  info_hash: string
  magnet_uri: string
  name: string
  size: number
  files: string
  cid: string
  tier: string
  category: string
  created_at: number
}

function rowToTorrentInfo(row: TorrentMetadataRow): TorrentInfo {
  return {
    infoHash: row.info_hash,
    magnetUri: row.magnet_uri,
    name: row.name,
    size: row.size,
    files: JSON.parse(row.files),
    cid: row.cid,
    tier: row.tier as ContentTier,
    category: row.category as ContentCategory,
    createdAt: row.created_at,
  }
}

const torrentState = {
  async saveTorrent(info: TorrentInfo): Promise<void> {
    await ensureTorrentTables()
    const client = await getTorrentEQLiteClient()
    await client.exec(
      `INSERT INTO torrent_metadata (info_hash, magnet_uri, name, size, files, cid, tier, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(info_hash) DO UPDATE SET
         magnet_uri = excluded.magnet_uri,
         name = excluded.name,
         size = excluded.size,
         files = excluded.files,
         cid = excluded.cid,
         tier = excluded.tier,
         category = excluded.category`,
      [
        info.infoHash,
        info.magnetUri,
        info.name,
        info.size,
        JSON.stringify(info.files),
        info.cid,
        info.tier,
        info.category,
        info.createdAt,
      ],
      TORRENT_DB_ID,
    )
  },

  async getTorrent(infoHash: string): Promise<TorrentInfo | null> {
    await ensureTorrentTables()
    const client = await getTorrentEQLiteClient()
    const result = await client.query<TorrentMetadataRow>(
      `SELECT * FROM torrent_metadata WHERE info_hash = ?`,
      [infoHash],
      TORRENT_DB_ID,
    )
    const row = result.rows[0]
    return row ? rowToTorrentInfo(row) : null
  },

  async getTorrentByCid(cid: string): Promise<TorrentInfo | null> {
    await ensureTorrentTables()
    const client = await getTorrentEQLiteClient()
    const result = await client.query<TorrentMetadataRow>(
      `SELECT * FROM torrent_metadata WHERE cid = ?`,
      [cid],
      TORRENT_DB_ID,
    )
    const row = result.rows[0]
    return row ? rowToTorrentInfo(row) : null
  },

  async deleteTorrent(infoHash: string): Promise<void> {
    await ensureTorrentTables()
    const client = await getTorrentEQLiteClient()
    await client.exec(
      `DELETE FROM torrent_metadata WHERE info_hash = ?`,
      [infoHash],
      TORRENT_DB_ID,
    )
  },

  async getTorrentsByTier(tier: ContentTier): Promise<TorrentInfo[]> {
    await ensureTorrentTables()
    const client = await getTorrentEQLiteClient()
    const result = await client.query<TorrentMetadataRow>(
      `SELECT * FROM torrent_metadata WHERE tier = ?`,
      [tier],
      TORRENT_DB_ID,
    )
    return result.rows.map(rowToTorrentInfo)
  },

  async getAllTorrents(): Promise<TorrentInfo[]> {
    await ensureTorrentTables()
    const client = await getTorrentEQLiteClient()
    const result = await client.query<TorrentMetadataRow>(
      `SELECT * FROM torrent_metadata`,
      [],
      TORRENT_DB_ID,
    )
    return result.rows.map(rowToTorrentInfo)
  },

  async hasTorrent(infoHash: string): Promise<boolean> {
    const torrent = await this.getTorrent(infoHash)
    return torrent !== null
  },

  async getInfoHashByCid(cid: string): Promise<string | null> {
    const torrent = await this.getTorrentByCid(cid)
    return torrent?.infoHash ?? null
  },
}

// WebTorrent Backend

const TORRENT_BUCKET = 'webtorrent-content'

export class WebTorrentBackend extends WorkerdEventEmitter {
  readonly name = 'webtorrent'
  readonly type: StorageBackendType = 'webtorrent'

  private config: WebTorrentConfig
  private client: WebTorrentInstance | null = null
  private clientInitPromise: Promise<WebTorrentInstance> | null = null
  private s3: S3Backend | null = null

  /** Get client, asserting it's initialized (use after await getClient()) */
  private get clientOrThrow(): WebTorrentInstance {
    if (!this.client) {
      throw new Error('WebTorrent client not initialized')
    }
    return this.client
  }

  // Bandwidth tracking (local per-instance metrics)
  private bandwidthUsed = {
    system: 0,
    popular: 0,
    private: 0,
  }

  constructor(
    config: Partial<WebTorrentConfig> = {},
    storageBackend?: BackendManager,
  ) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize S3 backend for storage operations
    if (storageBackend) {
      this.s3 = new S3Backend(storageBackend)
    }

    // Config injection for workerd compatibility
    // Note: Environment variables can still be used via configureWebTorrentBackend
  }

  /** Initialize storage bucket */
  async initializeStorage(): Promise<void> {
    if (!this.s3) return
    const existingBucket = await this.s3.getBucket(TORRENT_BUCKET)
    if (!existingBucket) {
      await this.s3.createBucket(TORRENT_BUCKET, 'webtorrent-system')
    }
  }

  /** Set storage backend for S3 operations */
  setStorageBackend(backend: BackendManager): void {
    this.s3 = new S3Backend(backend)
  }

  /** Get S3 backend for direct access */
  getS3Backend(): S3Backend | null {
    return this.s3
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
   * Uses S3-compatible DWS storage backend
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

    // Store content in S3-compatible storage
    if (this.s3) {
      const key = `${options.tier}/${options.cid}/${options.name}`
      await this.s3.putObject({
        bucket: TORRENT_BUCKET,
        key,
        body: content,
        contentType: 'application/octet-stream',
        metadata: {
          'x-torrent-tier': options.tier,
          'x-torrent-category': options.category,
          'x-torrent-cid': options.cid,
        },
      })
    }

    // Create a Blob for WebTorrent seeding (works in workerd)
    const blob = new Blob([new Uint8Array(content)])

    return new Promise((resolve, reject) => {
      client.seed(
        blob as unknown as string, // WebTorrent accepts Blob in browser environments
        {
          name: options.name,
          announce: this.config.trackers,
          comment: `jeju:${options.cid}`, // Cross-seed with CID
        },
        async (torrent) => {
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

          // Save to EQLite
          await torrentState.saveTorrent(torrentInfo)

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
    const existing = await torrentState.getTorrent(infoHash)
    if (existing) {
      return existing
    }

    // Check bandwidth limits for tier
    const tier = options?.tier ?? 'popular'
    if (tier === 'system' && !this.canUseBandwidth('system')) {
      throw new Error('System content bandwidth limit reached')
    }

    // Check concurrent limit
    if (
      this.clientOrThrow.torrents.length >= this.config.maxConcurrentTorrents
    ) {
      await this.evictLowestPriority()
    }

    return new Promise((resolve, reject) => {
      this.clientOrThrow.add(
        magnetUri,
        {
          // Use in-memory storage instead of filesystem path
          announce: this.config.trackers,
        },
        async (torrent) => {
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

          // Save to EQLite
          await torrentState.saveTorrent(torrentInfo)

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
   * Download content from S3 storage by CID
   */
  async downloadFromStorage(
    cid: string,
    tier: ContentTier = 'popular',
  ): Promise<Buffer | null> {
    if (!this.s3) return null

    // List objects with CID prefix to find the content
    const result = await this.s3.listObjects({
      bucket: TORRENT_BUCKET,
      prefix: `${tier}/${cid}/`,
      maxKeys: 1,
    })

    if (result.contents.length === 0) {
      // Try other tiers
      for (const t of ['system', 'popular', 'private'] as ContentTier[]) {
        if (t === tier) continue
        const altResult = await this.s3.listObjects({
          bucket: TORRENT_BUCKET,
          prefix: `${t}/${cid}/`,
          maxKeys: 1,
        })
        if (altResult.contents.length > 0 && altResult.contents[0]) {
          const obj = await this.s3.getObject({
            bucket: TORRENT_BUCKET,
            key: altResult.contents[0].key,
          })
          return obj.body
        }
      }
      return null
    }

    const firstContent = result.contents[0]
    if (!firstContent) return null
    const obj = await this.s3.getObject({
      bucket: TORRENT_BUCKET,
      key: firstContent.key,
    })
    return obj.body
  }

  /**
   * Download content via torrent, with S3 storage fallback
   */
  async download(cidOrInfoHash: string): Promise<Buffer> {
    // Look up by CID first
    let infoHash = await torrentState.getInfoHashByCid(cidOrInfoHash)
    if (!infoHash && cidOrInfoHash.length === 40) {
      infoHash = cidOrInfoHash
    }

    // If not in torrent metadata, try S3 storage
    if (!infoHash) {
      const stored = await this.downloadFromStorage(cidOrInfoHash)
      if (stored) return stored
      throw new Error(`Torrent not found: ${cidOrInfoHash}`)
    }

    const torrent = this.clientOrThrow.get(infoHash)
    if (!torrent) {
      // Fallback to S3 storage
      const metadata = await torrentState.getTorrent(infoHash)
      if (metadata) {
        const stored = await this.downloadFromStorage(
          metadata.cid,
          metadata.tier,
        )
        if (stored) return stored
      }
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

    const finalInfoHash = infoHash
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = file.createReadStream()

      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', async () => {
        const content = Buffer.concat(chunks)
        const metadata = await torrentState.getTorrent(finalInfoHash)
        this.emit('torrent:downloaded', metadata)
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

    const metadata = await torrentState.getTorrent(infoHash)
    this.emit('torrent:seeding', metadata)
    console.log(`[WebTorrent] Started seeding: ${torrent.name}`)
  }

  /**
   * Stop seeding a torrent
   */
  async stopSeeding(infoHash: string): Promise<void> {
    const torrentInfo = await torrentState.getTorrent(infoHash)
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
    const torrentInfo = await torrentState.getTorrent(infoHash)
    if (!torrentInfo) return

    // Don't allow removing system content
    if (torrentInfo.tier === 'system' && this.config.autoSeedSystemContent) {
      throw new Error('Cannot remove system content')
    }

    return new Promise((resolve, reject) => {
      this.clientOrThrow.remove(
        infoHash,
        { destroyStore: true },
        async (err) => {
          if (err) {
            reject(err)
            return
          }

          await torrentState.deleteTorrent(infoHash)

          this.emit('torrent:removed', torrentInfo)
          console.log(`[WebTorrent] Removed torrent: ${torrentInfo.name}`)
          resolve()
        },
      )
    })
  }

  /**
   * Get torrent info by CID or infoHash
   */
  async getTorrent(cidOrInfoHash: string): Promise<TorrentInfo | null> {
    let infoHash = await torrentState.getInfoHashByCid(cidOrInfoHash)
    if (!infoHash && cidOrInfoHash.length === 40) {
      infoHash = cidOrInfoHash
    }
    return infoHash ? await torrentState.getTorrent(infoHash) : null
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
  async getTorrentsByTier(tier: ContentTier): Promise<TorrentInfo[]> {
    return await torrentState.getTorrentsByTier(tier)
  }

  /**
   * Get magnet URI for CID
   */
  async getMagnetUri(cid: string): Promise<string | null> {
    const torrent = await torrentState.getTorrentByCid(cid)
    return torrent?.magnetUri ?? null
  }

  /**
   * Check if content is available via torrent
   */
  async hasTorrent(cidOrInfoHash: string): Promise<boolean> {
    const infoHash =
      (await torrentState.getInfoHashByCid(cidOrInfoHash)) ?? cidOrInfoHash
    return await torrentState.hasTorrent(infoHash)
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
      if (await this.hasTorrent(item.cid)) continue

      const torrent = await this.addMagnet(item.magnetUri, { tier: 'popular' })
      addedSize += torrent.size
    }

    console.log(`[WebTorrent] Replicating ${eligible.length} popular items`)
  }

  /**
   * Get node storage stats
   */
  async getNodeStats(): Promise<Partial<NodeStorageStats>> {
    // If client isn't initialized, return empty stats
    if (!this.client) {
      return {
        systemContentCount: 0,
        systemContentSize: 0,
        popularContentCount: 0,
        popularContentSize: 0,
        privateContentCount: 0,
        privateContentSize: 0,
        activeTorrents: 0,
        seedingTorrents: 0,
        downloadingTorrents: 0,
        peersConnected: 0,
        bytesServed24h: 0,
      }
    }

    let systemSize = 0
    let popularSize = 0
    let privateSize = 0
    let totalUploaded = 0
    let seedingCount = 0
    let downloadingCount = 0

    for (const torrent of this.client.torrents) {
      const info = await torrentState.getTorrent(torrent.infoHash)
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

    const systemTorrents = await this.getTorrentsByTier('system')
    const popularTorrents = await this.getTorrentsByTier('popular')
    const privateTorrents = await this.getTorrentsByTier('private')

    return {
      systemContentCount: systemTorrents.length,
      systemContentSize: systemSize,
      popularContentCount: popularTorrents.length,
      popularContentSize: popularSize,
      privateContentCount: privateTorrents.length,
      privateContentSize: privateSize,
      activeTorrents: this.client.torrents.length,
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
    // Client is lazily initialized - if not initialized, it's not healthy yet
    if (!this.client) return false
    return !this.client.destroyed
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
    const popularTorrents = await this.getTorrentsByTier('popular')
    if (popularTorrents.length === 0) return

    // Sort by ratio (evict highest ratio first - already contributed enough)
    const sorted = popularTorrents
      .map((t: TorrentInfo) => ({
        torrent: t,
        stats: this.getTorrentStats(t.infoHash),
      }))
      .filter(
        (x: { torrent: TorrentInfo; stats: TorrentStats | null }) => x.stats,
      )
      .sort(
        (
          a: { stats: TorrentStats | null },
          b: { stats: TorrentStats | null },
        ) => (b.stats?.ratio ?? 0) - (a.stats?.ratio ?? 0),
      )

    if (sorted.length > 0 && sorted[0]) {
      await this.removeTorrent(sorted[0].torrent.infoHash)
    }
  }

  private getTotalPeers(): number {
    if (!this.client) return 0
    let total = 0
    for (const torrent of this.client.torrents) {
      total += torrent.numPeers
    }
    return total
  }
}

// Config injection for workerd compatibility
let globalWebTorrentEnvConfig: Partial<WebTorrentConfig> | null = null

export function configureWebTorrentBackend(
  config: Partial<WebTorrentConfig>,
): void {
  globalWebTorrentEnvConfig = { ...globalWebTorrentEnvConfig, ...config }
}

// Factory

let globalWebTorrentBackend: WebTorrentBackend | null = null

export function getWebTorrentBackend(
  config?: Partial<WebTorrentConfig>,
  storageBackend?: BackendManager,
): WebTorrentBackend {
  if (!globalWebTorrentBackend) {
    // Merge injected config with provided config
    const mergedConfig = {
      ...globalWebTorrentEnvConfig,
      ...config,
    }
    globalWebTorrentBackend = new WebTorrentBackend(
      mergedConfig,
      storageBackend,
    )
    // Initialize storage bucket asynchronously
    if (storageBackend) {
      globalWebTorrentBackend.initializeStorage().catch((err: Error) => {
        console.warn('[WebTorrent] Failed to initialize storage:', err.message)
      })
    }
  } else if (storageBackend && !globalWebTorrentBackend.getS3Backend()) {
    globalWebTorrentBackend.setStorageBackend(storageBackend)
    globalWebTorrentBackend.initializeStorage().catch((err: Error) => {
      console.warn('[WebTorrent] Failed to initialize storage:', err.message)
    })
  }
  return globalWebTorrentBackend
}

export async function initializeWebTorrentBackend(
  config?: Partial<WebTorrentConfig>,
  storageBackend?: BackendManager,
): Promise<WebTorrentBackend> {
  const backend = getWebTorrentBackend(config, storageBackend)
  await backend.initializeStorage()
  return backend
}

export function resetWebTorrentBackend(): void {
  if (globalWebTorrentBackend) {
    globalWebTorrentBackend.destroy().catch(console.error)
  }
  globalWebTorrentBackend = null
}
