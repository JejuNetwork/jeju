import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'
import { LRUCache } from 'lru-cache'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'
import { z } from 'zod'
import type { NodeClient } from '../contracts'
import {
  getHybridTorrentService,
  type HybridTorrentService,
} from './hybrid-torrent'

// ============================================================================
// Configuration Schema
// ============================================================================

const StaticAssetConfigSchema = z.object({
  listenPort: z.number().min(1024).max(65535).default(8080),
  cachePath: z.string().default('./cache/assets'),
  maxCacheSizeMb: z.number().default(1024), // 1GB default
  enableTorrent: z.boolean().default(true),
  enableCDN: z.boolean().default(true),
  cdnFallbackUrl: z.string().url().optional(),
  metricsPort: z.number().optional(),
  // Network asset manifest
  manifestUrl: z.string().url().optional(),
  manifestRefreshMs: z.number().default(3600000), // 1 hour
})

export type StaticAssetConfig = z.infer<typeof StaticAssetConfigSchema>

// Schema for network assets in manifest
const NetworkAssetSchema = z.object({
  contentHash: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  size: z.number().int().positive(),
  mimeType: z.string().min(1),
  version: z.string().min(1),
  priority: z.enum(['critical', 'high', 'normal', 'low']),
  magnetUri: z.string().optional(),
  ipfsCid: z.string().optional(),
})

// Schema for asset manifest
const AssetManifestSchema = z.object({
  version: z.string().min(1),
  timestamp: z.number().int().positive(),
  assets: z.array(NetworkAssetSchema),
  checksum: z.string().min(1),
})

// ============================================================================
// Types
// ============================================================================

export interface NetworkAsset {
  contentHash: string
  name: string
  path: string
  size: number
  mimeType: string
  version: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  magnetUri?: string
  ipfsCid?: string
}

export interface AssetManifest {
  version: string
  timestamp: number
  assets: NetworkAsset[]
  checksum: string
}

interface CachedAsset {
  contentHash: string
  data: Buffer
  mimeType: string
  size: number
  lastAccessed: number
  accessCount: number
}

// ============================================================================
// Prometheus Metrics
// ============================================================================

const metricsRegistry = new Registry()

const assetRequestsTotal = new Counter({
  name: 'static_asset_requests_total',
  help: 'Total asset requests',
  labelNames: ['path', 'status', 'source'],
  registers: [metricsRegistry],
})

const assetBytesServed = new Counter({
  name: 'static_asset_bytes_served_total',
  help: 'Total bytes served',
  labelNames: ['source'],
  registers: [metricsRegistry],
})

const assetCacheHits = new Counter({
  name: 'static_asset_cache_hits_total',
  help: 'Cache hits',
  registers: [metricsRegistry],
})

const assetCacheMisses = new Counter({
  name: 'static_asset_cache_misses_total',
  help: 'Cache misses',
  registers: [metricsRegistry],
})

const assetCacheSize = new Gauge({
  name: 'static_asset_cache_size_bytes',
  help: 'Current cache size in bytes',
  registers: [metricsRegistry],
})

const assetLatency = new Histogram({
  name: 'static_asset_latency_seconds',
  help: 'Asset serving latency',
  labelNames: ['source'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
})

// ============================================================================
// MIME Types
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

// ============================================================================
// Static Asset Service
// ============================================================================

export class StaticAssetService {
  private config: StaticAssetConfig
  private torrent: HybridTorrentService | null = null
  private server: http.Server | null = null
  private metricsServer: http.Server | null = null
  private running = false

  // Asset caching
  private assetCache = new LRUCache<string, CachedAsset>({
    max: 10000,
    maxSize: 1024 * 1024 * 1024, // 1GB
    sizeCalculation: (value) => value.size,
    ttl: 24 * 60 * 60 * 1000, // 24 hours
  })

  // Cache stats for hit rate calculation
  private cacheHits = 0
  private cacheMisses = 0

  // Network asset manifest
  private manifest: AssetManifest | null = null
  private manifestRefreshInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    _client: NodeClient | null,
    config: Partial<StaticAssetConfig> = {},
  ) {
    // Note: client parameter reserved for future on-chain manifest support
    this.config = StaticAssetConfigSchema.parse({
      ...config,
      cachePath: config.cachePath ?? './cache/assets',
    })

    // Ensure cache directory exists
    if (!fs.existsSync(this.config.cachePath)) {
      fs.mkdirSync(this.config.cachePath, { recursive: true })
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    // Initialize torrent service if enabled
    if (this.config.enableTorrent) {
      this.torrent = getHybridTorrentService()
      await this.torrent.start()
    }

    // Start HTTP server
    await this.startServer()

    // Start metrics server if configured
    if (this.config.metricsPort) {
      await this.startMetricsServer()
    }

    // Load initial manifest
    await this.refreshManifest()

    // Start manifest refresh interval
    this.manifestRefreshInterval = setInterval(
      () => this.refreshManifest(),
      this.config.manifestRefreshMs,
    )

    console.log(`[StaticAssets] Started on port ${this.config.listenPort}`)
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    if (this.manifestRefreshInterval) {
      clearInterval(this.manifestRefreshInterval)
    }

    if (this.server) {
      this.server.close()
    }

    if (this.metricsServer) {
      this.metricsServer.close()
    }

    console.log('[StaticAssets] Stopped')
  }

  // ============================================================================
  // HTTP Server
  // ============================================================================

  private async startServer(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const startTime = Date.now()
      const urlPath = req.url ?? '/'

      // Health check
      if (urlPath === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            status: 'healthy',
            cacheSize: this.assetCache.size,
            manifestLoaded: this.manifest !== null,
          }),
        )
        return
      }

      // Metrics endpoint
      if (urlPath === '/metrics') {
        res.setHeader('Content-Type', metricsRegistry.contentType)
        res.end(await metricsRegistry.metrics())
        return
      }

      // Serve asset
      try {
        const asset = await this.getAsset(urlPath)
        if (asset) {
          res.writeHead(200, {
            'Content-Type': asset.mimeType,
            'Content-Length': asset.size,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Hash': asset.contentHash,
          })
          res.end(asset.data)

          assetRequestsTotal.inc({
            path: urlPath,
            status: 'hit',
            source: 'cache',
          })
          assetBytesServed.inc({ source: 'local' }, asset.size)
          assetLatency.observe(
            { source: 'cache' },
            (Date.now() - startTime) / 1000,
          )
        } else {
          res.writeHead(404)
          res.end('Not found')
          assetRequestsTotal.inc({
            path: urlPath,
            status: 'miss',
            source: 'none',
          })
        }
      } catch (error) {
        console.error('[StaticAssets] Error serving asset:', error)
        res.writeHead(500)
        res.end('Internal server error')
        assetRequestsTotal.inc({
          path: urlPath,
          status: 'error',
          source: 'none',
        })
      }
    })

    await new Promise<void>((resolve) => {
      this.server?.listen(this.config.listenPort, resolve)
    })
  }

  private async startMetricsServer(): Promise<void> {
    this.metricsServer = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', metricsRegistry.contentType)
        res.end(await metricsRegistry.metrics())
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    await new Promise<void>((resolve) => {
      this.metricsServer?.listen(this.config.metricsPort, resolve)
    })

    console.log(
      `[StaticAssets] Metrics server on port ${this.config.metricsPort}`,
    )
  }

  // ============================================================================
  // Asset Retrieval
  // ============================================================================

  private async getAsset(urlPath: string): Promise<CachedAsset | null> {
    // Normalize path
    const normalizedPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath
    const contentHash = this.pathToContentHash(normalizedPath)

    // Check memory cache
    const cached = this.assetCache.get(contentHash)
    if (cached) {
      cached.lastAccessed = Date.now()
      cached.accessCount++
      this.cacheHits++
      assetCacheHits.inc()
      return cached
    }

    this.cacheMisses++
    assetCacheMisses.inc()

    // Check disk cache
    const diskPath = path.join(this.config.cachePath, contentHash)
    if (fs.existsSync(diskPath)) {
      const data = fs.readFileSync(diskPath)
      const mimeType = getMimeType(normalizedPath)
      const asset: CachedAsset = {
        contentHash,
        data,
        mimeType,
        size: data.length,
        lastAccessed: Date.now(),
        accessCount: 1,
      }
      this.assetCache.set(contentHash, asset)
      this.updateCacheMetrics()
      return asset
    }

    // Try to fetch from network
    return await this.fetchAsset(normalizedPath, contentHash)
  }

  private async fetchAsset(
    assetPath: string,
    contentHash: string,
  ): Promise<CachedAsset | null> {
    // Find asset in manifest
    const manifestAsset = this.manifest?.assets.find(
      (a) => a.path === assetPath || a.contentHash === contentHash,
    )

    // Try torrent first if available
    if (this.config.enableTorrent && this.torrent && manifestAsset?.magnetUri) {
      try {
        const stats = await this.torrent.addTorrent(
          manifestAsset.magnetUri,
          contentHash,
        )
        const data = await this.torrent.getContent(stats.infohash)

        // Verify content hash
        const hash = createHash('sha256').update(data).digest('hex')
        if (hash !== contentHash && `0x${hash}` !== contentHash) {
          console.warn(`[StaticAssets] Content hash mismatch for ${assetPath}`)
          return null
        }

        const asset: CachedAsset = {
          contentHash,
          data,
          mimeType: manifestAsset.mimeType,
          size: data.length,
          lastAccessed: Date.now(),
          accessCount: 1,
        }

        // Cache to disk and memory
        await this.cacheAsset(contentHash, asset)
        return asset
      } catch (error) {
        console.warn(
          `[StaticAssets] Torrent fetch failed for ${assetPath}:`,
          error,
        )
      }
    }

    // Try CDN fallback
    if (this.config.enableCDN && this.config.cdnFallbackUrl) {
      try {
        const cdnUrl = `${this.config.cdnFallbackUrl}/${assetPath}`
        const data = await this.fetchFromCDN(cdnUrl)

        if (data) {
          const hash = createHash('sha256').update(data).digest('hex')
          const mimeType = getMimeType(assetPath)

          const asset: CachedAsset = {
            contentHash: hash,
            data,
            mimeType,
            size: data.length,
            lastAccessed: Date.now(),
            accessCount: 1,
          }

          await this.cacheAsset(hash, asset)
          return asset
        }
      } catch (error) {
        console.warn(`[StaticAssets] CDN fetch failed for ${assetPath}:`, error)
      }
    }

    return null
  }

  private async fetchFromCDN(url: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http
      const req = protocol.get(url, { timeout: 30000 }, (res) => {
        if (res.statusCode !== 200) {
          resolve(null)
          return
        }

        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', () => resolve(null))
      })

      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
    })
  }

  private async cacheAsset(
    contentHash: string,
    asset: CachedAsset,
  ): Promise<void> {
    // Write to disk
    const diskPath = path.join(this.config.cachePath, contentHash)
    fs.writeFileSync(diskPath, asset.data)

    // Add to memory cache
    this.assetCache.set(contentHash, asset)
    this.updateCacheMetrics()
  }

  // ============================================================================
  // Manifest Management
  // ============================================================================

  private async refreshManifest(): Promise<void> {
    // Try URL-based manifest first (primary method)
    if (this.config.manifestUrl) {
      const data = await this.fetchFromCDN(this.config.manifestUrl)
      if (data) {
        const parseResult = AssetManifestSchema.safeParse(
          JSON.parse(data.toString()),
        )
        if (parseResult.success) {
          this.manifest = parseResult.data
          console.log(
            `[StaticAssets] Loaded manifest v${this.manifest.version} from URL`,
          )
          return
        }
        console.warn(
          '[StaticAssets] Invalid manifest format:',
          parseResult.error.message,
        )
      }
    }

    // Note: On-chain manifest support requires ContentRegistry to have getNetworkManifest()
    // This is not yet implemented - when added, use:
    // const manifestHash = await this.client.publicClient.readContract({
    //   address: this.client.addresses.contentRegistry,
    //   abi: CONTENT_REGISTRY_ABI,
    //   functionName: 'getNetworkManifest',
    //   args: [],
    // }) as string;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  async addAsset(assetPath: string, data: Buffer): Promise<string> {
    const contentHash = createHash('sha256').update(data).digest('hex')
    const mimeType = getMimeType(assetPath)

    const asset: CachedAsset = {
      contentHash,
      data,
      mimeType,
      size: data.length,
      lastAccessed: Date.now(),
      accessCount: 0,
    }

    await this.cacheAsset(contentHash, asset)

    // Seed via torrent if enabled
    if (this.config.enableTorrent && this.torrent) {
      const stats = await this.torrent.seedContent(data, assetPath, contentHash)
      console.log(
        `[StaticAssets] Seeding ${assetPath} via torrent: ${stats.infohash}`,
      )
    }

    return contentHash
  }

  getManifest(): AssetManifest | null {
    return this.manifest
  }

  getCacheStats(): {
    entries: number
    sizeBytes: number
    hitRate: number
  } {
    const total = this.cacheHits + this.cacheMisses
    return {
      entries: this.assetCache.size,
      sizeBytes: this.assetCache.calculatedSize ?? 0,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private pathToContentHash(urlPath: string): string {
    // Check if path matches a known asset in manifest
    const asset = this.manifest?.assets.find((a) => a.path === urlPath)
    if (asset) {
      return asset.contentHash
    }

    // Generate hash from path for lookup
    return createHash('sha256').update(urlPath).digest('hex')
  }

  private updateCacheMetrics(): void {
    assetCacheSize.set(this.assetCache.calculatedSize ?? 0)
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createStaticAssetService(
  client: NodeClient | null,
  config?: Partial<StaticAssetConfig>,
): StaticAssetService {
  return new StaticAssetService(client, config)
}
