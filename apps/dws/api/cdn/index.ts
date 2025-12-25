/**
 * CDN Module
 * Provides edge caching and content delivery from IPFS/Arweave
 */

export interface CacheConfig {
  maxSizeBytes: number
  maxEntries: number
  defaultTTL: number
}

export interface CacheMetadata {
  contentType?: string
  headers: Record<string, string>
  origin: string
  cacheControl?: string
  immutable?: boolean
  createdAt: number
  expiresAt: number
}

export interface CacheEntry {
  data: ArrayBuffer
  metadata: CacheMetadata
  size: number
}

export interface CacheStats {
  entries: number
  sizeBytes: number
  maxSizeBytes: number
  maxEntries: number
  hitRate: number
  hits: number
  misses: number
}

export type CacheStatus = 'HIT' | 'MISS' | 'STALE'

export interface EdgeCache {
  get(key: string): { entry: CacheEntry | null; status: CacheStatus }
  set(
    key: string,
    data: ArrayBuffer,
    metadata: Omit<CacheMetadata, 'createdAt' | 'expiresAt'>,
  ): void
  delete(key: string): boolean
  clear(): void
  purge(pathPattern: string): number
  generateKey(opts: { path: string; query?: string }): string
  getStats(): CacheStats
}

// LRU cache implementation with size limits
class LRUEdgeCache implements EdgeCache {
  private cache = new Map<string, CacheEntry>()
  private accessOrder: string[] = []
  private config: CacheConfig
  private currentSize = 0
  private hits = 0
  private misses = 0

  constructor(config: CacheConfig) {
    this.config = config
  }

  generateKey(opts: { path: string; query?: string }): string {
    return opts.query ? `${opts.path}?${opts.query}` : opts.path
  }

  get(key: string): { entry: CacheEntry | null; status: CacheStatus } {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return { entry: null, status: 'MISS' }
    }

    const now = Date.now()

    // Update access order for LRU
    const idx = this.accessOrder.indexOf(key)
    if (idx >= 0) {
      this.accessOrder.splice(idx, 1)
      this.accessOrder.push(key)
    }

    // Check if stale
    if (now > entry.metadata.expiresAt) {
      // Stale but still usable for stale-while-revalidate
      this.hits++
      return { entry, status: 'STALE' }
    }

    this.hits++
    return { entry, status: 'HIT' }
  }

  set(
    key: string,
    data: ArrayBuffer,
    metadata: Omit<CacheMetadata, 'createdAt' | 'expiresAt'>,
  ): void {
    const now = Date.now()

    // Parse TTL from cache-control or use default
    let ttl = this.config.defaultTTL
    if (metadata.cacheControl) {
      const maxAgeMatch = metadata.cacheControl.match(/max-age=(\d+)/)
      if (maxAgeMatch) {
        ttl = parseInt(maxAgeMatch[1], 10)
      }
    }
    // Immutable content gets long TTL
    if (metadata.immutable) {
      ttl = 365 * 24 * 60 * 60 // 1 year
    }

    const entry: CacheEntry = {
      data,
      metadata: {
        ...metadata,
        createdAt: now,
        expiresAt: now + ttl * 1000,
      },
      size: data.byteLength,
    }

    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)
      if (existing) {
        this.currentSize -= existing.size
      }
      const idx = this.accessOrder.indexOf(key)
      if (idx >= 0) this.accessOrder.splice(idx, 1)
    }

    // Evict if necessary
    while (
      (this.currentSize + entry.size > this.config.maxSizeBytes ||
        this.cache.size >= this.config.maxEntries) &&
      this.accessOrder.length > 0
    ) {
      const lruKey = this.accessOrder.shift()
      if (lruKey) {
        const evicted = this.cache.get(lruKey)
        if (evicted) {
          this.currentSize -= evicted.size
          this.cache.delete(lruKey)
        }
      }
    }

    // Add new entry
    this.cache.set(key, entry)
    this.accessOrder.push(key)
    this.currentSize += entry.size
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    this.currentSize -= entry.size
    this.cache.delete(key)
    const idx = this.accessOrder.indexOf(key)
    if (idx >= 0) this.accessOrder.splice(idx, 1)
    return true
  }

  clear(): void {
    this.cache.clear()
    this.accessOrder = []
    this.currentSize = 0
    this.hits = 0
    this.misses = 0
  }

  purge(pathPattern: string): number {
    let purged = 0
    const keysToDelete: string[] = []

    for (const key of this.cache.keys()) {
      if (key.includes(pathPattern)) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      if (this.delete(key)) purged++
    }

    return purged
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      entries: this.cache.size,
      sizeBytes: this.currentSize,
      maxSizeBytes: this.config.maxSizeBytes,
      maxEntries: this.config.maxEntries,
      hitRate: total > 0 ? this.hits / total : 0,
      hits: this.hits,
      misses: this.misses,
    }
  }
}

let edgeCache: EdgeCache | null = null

export function getEdgeCache(config?: Partial<CacheConfig>): EdgeCache {
  if (!edgeCache) {
    edgeCache = new LRUEdgeCache({
      maxSizeBytes: config?.maxSizeBytes ?? 512 * 1024 * 1024, // 512MB default
      maxEntries: config?.maxEntries ?? 100000,
      defaultTTL: config?.defaultTTL ?? 3600, // 1 hour
    })
  }
  return edgeCache
}

// Origin Fetcher - fetches content from IPFS/Arweave

export interface FetchResult {
  success: boolean
  body: ArrayBuffer
  headers: Record<string, string>
  origin: string
  error?: string
}

export interface FetchOptions {
  headers: Record<string, string>
  timeout?: number
}

export interface OriginFetcher {
  fetch(
    path: string,
    query: string | undefined,
    options: FetchOptions,
  ): Promise<FetchResult>
}

class IPFSOriginFetcher implements OriginFetcher {
  private ipfsGateway: string
  private arweaveGateway: string
  private ipfsApiUrl: string

  constructor(
    ipfsGateway = process.env.IPFS_GATEWAY_URL || 'http://localhost:8080',
    arweaveGateway = process.env.ARWEAVE_GATEWAY_URL || 'https://arweave.net',
    ipfsApiUrl = process.env.IPFS_API_URL || 'http://localhost:5001',
  ) {
    this.ipfsGateway = ipfsGateway
    this.arweaveGateway = arweaveGateway
    this.ipfsApiUrl = ipfsApiUrl
  }

  async fetch(
    path: string,
    _query: string | undefined,
    options: FetchOptions,
  ): Promise<FetchResult> {
    let url: string
    let origin: string

    if (path.startsWith('/ipfs/')) {
      // Extract CID and subpath
      const pathWithoutPrefix = path.slice(6) // Remove '/ipfs/'
      const cidEndIndex = pathWithoutPrefix.indexOf('/')
      const cid =
        cidEndIndex >= 0
          ? pathWithoutPrefix.slice(0, cidEndIndex)
          : pathWithoutPrefix
      const subpath =
        cidEndIndex >= 0 ? pathWithoutPrefix.slice(cidEndIndex) : ''

      // Use IPFS API for reliable content retrieval
      url = `${this.ipfsApiUrl}/api/v0/cat?arg=${cid}${subpath}`
      origin = 'ipfs'
    } else if (path.startsWith('/ipns/')) {
      url = `${this.ipfsGateway}${path}`
      origin = 'ipns'
    } else if (path.startsWith('/ar/') || path.startsWith('/arweave/')) {
      const arPath = path.replace(/^\/(ar|arweave)\//, '')
      url = `${this.arweaveGateway}/${arPath}`
      origin = 'arweave'
    } else {
      return {
        success: false,
        body: new ArrayBuffer(0),
        headers: {},
        origin: 'unknown',
        error: `Unknown path format: ${path}`,
      }
    }

    const controller = new AbortController()
    const timeout = options.timeout ?? 30000
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        method: origin === 'ipfs' ? 'POST' : 'GET', // IPFS API uses POST for cat
        headers: options.headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          success: false,
          body: new ArrayBuffer(0),
          headers: {},
          origin,
          error: `HTTP ${response.status}: ${response.statusText}`,
        }
      }

      const body = await response.arrayBuffer()
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })

      // IPFS content is immutable
      if (origin === 'ipfs') {
        headers['cache-control'] = 'public, max-age=31536000, immutable'
      }

      return {
        success: true,
        body,
        headers,
        origin,
      }
    } catch (error) {
      clearTimeout(timeoutId)
      return {
        success: false,
        body: new ArrayBuffer(0),
        headers: {},
        origin,
        error: error instanceof Error ? error.message : 'Unknown fetch error',
      }
    }
  }
}

let originFetcher: OriginFetcher | null = null

export function getOriginFetcher(): OriginFetcher {
  if (!originFetcher) {
    originFetcher = new IPFSOriginFetcher()
  }
  return originFetcher
}
