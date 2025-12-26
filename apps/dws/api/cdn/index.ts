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
  etag?: string
  lastModified?: number
  createdAt: number
  expiresAt: number
}

export interface CacheEntry {
  data: Buffer
  metadata: CacheMetadata
  size: number
}

export interface CacheStats {
  entries: number
  sizeBytes: number
  maxSizeBytes: number
  maxEntries: number
  hitRate: number
  hitCount: number
  missCount: number
}

export type CacheStatus = 'HIT' | 'MISS' | 'STALE' | 'REVALIDATED'

export interface KeyOptions {
  path: string
  query?: string
  varyHeaders?: Record<string, string>
}

export interface TTLOptions {
  cacheControl?: string
  contentType?: string
}

export interface ConditionalResult {
  entry: CacheEntry | null
  status: CacheStatus
  notModified: boolean
}

export interface EdgeCache {
  get(key: string): { entry: CacheEntry | null; status: CacheStatus }
  getConditional(
    key: string,
    ifNoneMatch?: string,
    ifModifiedSince?: number,
  ): ConditionalResult
  set(
    key: string,
    data: ArrayBuffer | Buffer,
    metadata: Partial<Omit<CacheMetadata, 'createdAt' | 'expiresAt'>>,
  ): void
  delete(key: string): boolean
  clear(): void
  purge(pathPattern: string): number
  generateKey(opts: KeyOptions): string
  calculateTTL(path: string, opts: TTLOptions): number
  getStats(): CacheStats
  resetStats(): void
  startRevalidation(key: string): void
  completeRevalidation(key: string): void
  isRevalidating(key: string): boolean
}

const TTL_CONFIG = {
  immutable: 31536000,
  html: 60,
  js: 86400,
  css: 86400,
  image: 604800,
  font: 31536000,
  api: 0,
  default: 3600,
}

class LRUEdgeCache implements EdgeCache {
  private cache = new Map<string, CacheEntry>()
  private accessOrder: string[] = []
  private config: CacheConfig
  private currentSize = 0
  private hitCount = 0
  private missCount = 0
  private revalidating = new Set<string>()

  constructor(config: CacheConfig) {
    this.config = config
  }

  generateKey(opts: KeyOptions): string {
    let key = opts.path
    if (opts.query) {
      key += `?${opts.query}`
    }
    if (opts.varyHeaders) {
      const sortedHeaders = Object.entries(opts.varyHeaders)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&')
      key += `#vary:${sortedHeaders}`
    }
    return key
  }

  calculateTTL(path: string, opts: TTLOptions): number {
    if (opts.cacheControl) {
      if (opts.cacheControl.includes('no-store') || opts.cacheControl.includes('no-cache')) return 0
      const maxAgeMatch = opts.cacheControl.match(/max-age=(\d+)/)
      if (maxAgeMatch) return parseInt(maxAgeMatch[1], 10)
      if (opts.cacheControl.includes('immutable')) return TTL_CONFIG.immutable
    }

    // Content-hashed assets are immutable
    if (/\.[a-f0-9]{8,}\.(js|css|woff2?|ttf|eot|png|jpg|jpeg|gif|webp|svg|avif)$/i.test(path)) {
      return TTL_CONFIG.immutable
    }

    const contentType = opts.contentType?.toLowerCase() ?? ''
    if (contentType.includes('html')) return TTL_CONFIG.html
    if (contentType.includes('javascript')) return TTL_CONFIG.js
    if (contentType.includes('css')) return TTL_CONFIG.css
    if (contentType.includes('image')) return TTL_CONFIG.image
    if (contentType.includes('font')) return TTL_CONFIG.font
    if (contentType.includes('json') && path.includes('/api/'))
      return TTL_CONFIG.api

    return this.config.defaultTTL
  }

  get(key: string): { entry: CacheEntry | null; status: CacheStatus } {
    const entry = this.cache.get(key)
    if (!entry) {
      this.missCount++
      return { entry: null, status: 'MISS' }
    }

    const idx = this.accessOrder.indexOf(key)
    if (idx >= 0) {
      this.accessOrder.splice(idx, 1)
      this.accessOrder.push(key)
    }

    this.hitCount++
    return { entry, status: Date.now() > entry.metadata.expiresAt ? 'STALE' : 'HIT' }
  }

  getConditional(key: string, ifNoneMatch?: string, ifModifiedSince?: number): ConditionalResult {
    const { entry, status } = this.get(key)
    if (!entry || status === 'MISS') return { entry: null, status: 'MISS', notModified: false }

    if (ifNoneMatch && entry.metadata.etag === ifNoneMatch) return { entry, status: 'REVALIDATED', notModified: true }
    if (ifModifiedSince && entry.metadata.lastModified && entry.metadata.lastModified <= ifModifiedSince) {
      return { entry, status: 'REVALIDATED', notModified: true }
    }
    return { entry, status, notModified: false }
  }

  set(key: string, data: ArrayBuffer | Buffer, metadata: Partial<Omit<CacheMetadata, 'createdAt' | 'expiresAt'>>): void {
    const now = Date.now()
    const buffer = data instanceof Buffer ? data : Buffer.from(new Uint8Array(data))
    const ttl = metadata.immutable ? TTL_CONFIG.immutable : this.calculateTTL(key, metadata)

    const entry: CacheEntry = {
      data: buffer,
      metadata: {
        contentType: metadata.contentType,
        headers: metadata.headers ?? {},
        origin: metadata.origin ?? 'unknown',
        cacheControl: metadata.cacheControl,
        immutable: metadata.immutable,
        etag: metadata.etag,
        lastModified: metadata.lastModified,
        createdAt: now,
        expiresAt: now + ttl * 1000,
      },
      size: buffer.length,
    }

    const existing = this.cache.get(key)
    if (existing) {
      this.currentSize -= existing.size
      const idx = this.accessOrder.indexOf(key)
      if (idx >= 0) this.accessOrder.splice(idx, 1)
    }

    while ((this.currentSize + entry.size > this.config.maxSizeBytes || this.cache.size >= this.config.maxEntries) && this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift()
      if (lruKey) {
        const evicted = this.cache.get(lruKey)
        if (evicted) {
          this.currentSize -= evicted.size
          this.cache.delete(lruKey)
        }
      }
    }

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
    this.hitCount = 0
    this.missCount = 0
    this.revalidating.clear()
  }

  purge(pathPattern: string): number {
    const regex = pathPattern.includes('*')
      ? new RegExp(`^${pathPattern.replace(/\*/g, '.*').replace(/\?/g, '.')}`)
      : null

    let purged = 0
    for (const key of this.cache.keys()) {
      if (regex ? regex.test(key) : key.includes(pathPattern)) {
        if (this.delete(key)) purged++
      }
    }
    return purged
  }

  getStats(): CacheStats {
    const total = this.hitCount + this.missCount
    return {
      entries: this.cache.size,
      sizeBytes: this.currentSize,
      maxSizeBytes: this.config.maxSizeBytes,
      maxEntries: this.config.maxEntries,
      hitRate: total > 0 ? this.hitCount / total : 0,
      hitCount: this.hitCount,
      missCount: this.missCount,
    }
  }

  resetStats(): void {
    this.hitCount = 0
    this.missCount = 0
  }

  startRevalidation(key: string): void {
    this.revalidating.add(key)
  }

  completeRevalidation(key: string): void {
    this.revalidating.delete(key)
  }

  isRevalidating(key: string): boolean {
    return this.revalidating.has(key)
  }
}

const DEFAULT_CACHE_CONFIG: CacheConfig = { maxSizeBytes: 512 * 1024 * 1024, maxEntries: 100000, defaultTTL: 3600 }

let edgeCache: EdgeCache | null = null

export function getEdgeCache(config?: Partial<CacheConfig>): EdgeCache {
  if (config) return new LRUEdgeCache({ ...DEFAULT_CACHE_CONFIG, ...config })
  edgeCache ??= new LRUEdgeCache(DEFAULT_CACHE_CONFIG)
  return edgeCache
}

export function resetEdgeCache(): void {
  edgeCache = null
}

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

  async fetch(path: string, _query: string | undefined, options: FetchOptions): Promise<FetchResult> {
    let url: string
    let origin: string

    if (path.startsWith('/ipfs/')) {
      const pathWithoutPrefix = path.slice(6)
      const cidEndIndex = pathWithoutPrefix.indexOf('/')
      const cid = cidEndIndex >= 0 ? pathWithoutPrefix.slice(0, cidEndIndex) : pathWithoutPrefix
      const subpath = cidEndIndex >= 0 ? pathWithoutPrefix.slice(cidEndIndex) : ''
      url = `${this.ipfsApiUrl}/api/v0/cat?arg=${cid}${subpath}`
      origin = 'ipfs'
    } else if (path.startsWith('/ipns/')) {
      url = `${this.ipfsGateway}${path}`
      origin = 'ipns'
    } else if (path.startsWith('/ar/') || path.startsWith('/arweave/')) {
      url = `${this.arweaveGateway}/${path.replace(/^\/(ar|arweave)\//, '')}`
      origin = 'arweave'
    } else {
      return { success: false, body: new ArrayBuffer(0), headers: {}, origin: 'unknown', error: `Unknown path format: ${path}` }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 30000)

    try {
      const response = await fetch(url, {
        method: origin === 'ipfs' ? 'POST' : 'GET',
        headers: options.headers,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        return { success: false, body: new ArrayBuffer(0), headers: {}, origin, error: `HTTP ${response.status}: ${response.statusText}` }
      }

      const body = await response.arrayBuffer()
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })
      if (origin === 'ipfs') headers['cache-control'] = 'public, max-age=31536000, immutable'

      return { success: true, body, headers, origin }
    } catch (error) {
      clearTimeout(timeoutId)
      return { success: false, body: new ArrayBuffer(0), headers: {}, origin, error: error instanceof Error ? error.message : 'Unknown fetch error' }
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
