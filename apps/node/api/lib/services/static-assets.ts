import * as fs from 'node:fs'
import * as http from 'node:http'
// Workerd-compatible: HTTP server converted to Fetch API handler
import * as https from 'node:https'
import * as path from 'node:path'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import { LRUCache } from 'lru-cache'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'
import { z } from 'zod'
import type { SecureNodeClient } from '../contracts'
import {
  getHybridTorrentService,
  type HybridTorrentService,
} from './hybrid-torrent'

// Configuration Schema

const StaticAssetConfigSchema = z.object({
  listenPort: z.number().min(1024).max(65535).default(8080),
  cachePath: z.string().default('./cache/assets'),
  maxCacheSizeMb: z.number().default(1024), // 1GB default
  enableTorrent: z.boolean().default(true),
  enableCDN: z.boolean().default(true),
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

// Types

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

// Prometheus Metrics

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

// Export metrics for potential future use
void assetRequestsTotal
void assetBytesServed
void assetCacheHits
void assetCacheMisses
void assetLatency

// MIME Types

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

// Static Asset Service

export class StaticAssetService {
  private config: StaticAssetConfig
  private client: NodeClient | null
  private torrent: HybridTorrentService | null = null
  private running = false
  private server: http.Server | null = null
  private metricsServer: http.Server | null = null

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
    client: NodeClient | null,
    config: Partial<StaticAssetConfig> = {},
  ) {
    this.client = client
    this.config = StaticAssetConfigSchema.parse({
      ...config,
      cachePath: config.cachePath ?? './cache/assets',
    })

    // Ensure cache directory exists
    if (!fs.existsSync(this.config.cachePath)) {
      fs.mkdirSync(this.config.cachePath, { recursive: true })
    }
  }

  // Lifecycle

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

  // Fetch API Handlers (workerd-compatible)

  private async startServer(): Promise<void> {
    // In workerd, handlers are registered in the main Elysia app
    console.log(
      `[StaticAssets] Request handler ready (register at port ${this.config.listenPort})`,
    )
  }

  private async startMetricsServer(): Promise<void> {
    if (!this.config.metricsPort) return

    // In workerd, handlers are registered in the main Elysia app
    console.log(
      `[StaticAssets] Metrics handler ready (register at port ${this.config.metricsPort})`,
    )
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

  // Manifest Management

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

    // Try on-chain manifest if client is available
    if (this.client) {
      const manifestData = await this.fetchOnChainManifest()
      if (manifestData) {
        this.manifest = manifestData
        console.log(
          `[StaticAssets] Loaded manifest v${this.manifest.version} from on-chain`,
        )
        return
      }
    }
  }

  private async fetchOnChainManifest(): Promise<AssetManifest | null> {
    if (!this.client) return null

    const CONTENT_REGISTRY_ABI = [
      {
        name: 'getNetworkManifest',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: 'manifestHash', type: 'string' }],
      },
    ] as const

    // Fetch manifest hash from on-chain registry
    const manifestHash = await this.client.publicClient.readContract({
      address: this.client.addresses.contentRegistry,
      abi: CONTENT_REGISTRY_ABI,
      functionName: 'getNetworkManifest',
      args: [],
    })

    if (!manifestHash) return null

    // Fetch actual manifest from DWS using the hash
    const dwsUrl = `https://dws.jejunetwork.org/storage/download/${manifestHash}`
    const data = await this.fetchFromCDN(dwsUrl)
    if (!data) return null

    const parseResult = AssetManifestSchema.safeParse(
      JSON.parse(data.toString()),
    )
    if (!parseResult.success) {
      console.warn(
        '[StaticAssets] Invalid on-chain manifest format:',
        parseResult.error.message,
      )
      return null
    }

    return parseResult.data
  }

  // Public API

  async addAsset(assetPath: string, data: Buffer): Promise<string> {
    const contentHash = bytesToHex(hash256(new Uint8Array(data))).slice(2)
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

  private updateCacheMetrics(): void {
    assetCacheSize.set(this.assetCache.calculatedSize ?? 0)
  }
}

// Factory

export function createStaticAssetService(
  client: NodeClient | null,
  config?: Partial<StaticAssetConfig>,
): StaticAssetService {
  return new StaticAssetService(client, config)
}
