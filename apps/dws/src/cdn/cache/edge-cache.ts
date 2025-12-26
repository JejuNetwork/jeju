/**
 * Edge Cache
 *
 * High-performance LRU cache for CDN edge nodes.
 * Features:
 * - Content-addressed storage for immutable assets
 * - TTL-based expiration with Vercel-style defaults
 * - Vary header support for dynamic caching
 * - Compression support (gzip, brotli)
 * - Stale-while-revalidate support
 */

import { createHash } from '@jejunetwork/shared'
import type { CacheRule, CacheStatus, CacheTTLConfig } from '@jejunetwork/types'
import { DEFAULT_CACHE_RULES, DEFAULT_TTL_CONFIG } from '@jejunetwork/types'
import { LRUCache } from 'lru-cache'
import type {
  CacheEntry,
  CacheEntryMetadata,
  CacheKey,
  CacheStats,
} from '../types'

// ============================================================================
// Cache Configuration
// ============================================================================

export interface EdgeCacheConfig {
  maxSizeBytes: number
  maxEntries: number
  defaultTTL: number
  ttlConfig: CacheTTLConfig
  rules: CacheRule[]
  enableCompression: boolean
  compressionThreshold: number // Min size to compress
  staleWhileRevalidate: number
  staleIfError: number
}

const DEFAULT_CONFIG: EdgeCacheConfig = {
  maxSizeBytes: 512 * 1024 * 1024, // 512MB
  maxEntries: 100000,
  defaultTTL: 3600,
  ttlConfig: DEFAULT_TTL_CONFIG,
  rules: DEFAULT_CACHE_RULES,
  enableCompression: true,
  compressionThreshold: 1024, // 1KB
  staleWhileRevalidate: 60,
  staleIfError: 300,
}

// ============================================================================
// Edge Cache Implementation
// ============================================================================

export class EdgeCache {
  private cache: LRUCache<string, CacheEntry>
  private config: EdgeCacheConfig
  private stats: {
    hits: number
    misses: number
    staleHits: number
    evictions: number
    bytesServed: number
  }
  private revalidating: Set<string> = new Set()

  constructor(config: Partial<EdgeCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    this.cache = new LRUCache<string, CacheEntry>({
      max: this.config.maxEntries,
      maxSize: this.config.maxSizeBytes,
      sizeCalculation: (entry) => entry.data.length + 500, // Data + metadata overhead
      ttl: this.config.defaultTTL * 1000,
      updateAgeOnGet: true,
      dispose: () => {
        this.stats.evictions++
      },
    })

    this.stats = {
      hits: 0,
      misses: 0,
      staleHits: 0,
      evictions: 0,
      bytesServed: 0,
    }
  }

  // ============================================================================
  // Core Operations
  // ============================================================================

  /**
   * Get entry from cache
   */
  get(key: string): { entry: CacheEntry | null; status: CacheStatus } {
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      return { entry: null, status: 'MISS' }
    }

    const now = Date.now()

    // Check if expired
    if (entry.expiresAt > 0 && now > entry.expiresAt) {
      // Check stale-while-revalidate
      const swr = entry.metadata.cacheControl?.includes(
        'stale-while-revalidate',
      )
        ? this.config.staleWhileRevalidate * 1000
        : 0

      if (swr > 0 && now < entry.expiresAt + swr) {
        this.stats.staleHits++
        entry.accessCount++
        entry.lastAccessed = now
        return { entry, status: 'STALE' }
      }

      this.stats.misses++
      return { entry: null, status: 'EXPIRED' }
    }

    // Valid hit
    this.stats.hits++
    this.stats.bytesServed += entry.data.length
    entry.accessCount++
    entry.lastAccessed = now

    return { entry, status: 'HIT' }
  }

  /**
   * Get with conditional request support
   */
  getConditional(
    key: string,
    ifNoneMatch?: string,
    ifModifiedSince?: number,
  ): { entry: CacheEntry | null; status: CacheStatus; notModified: boolean } {
    const { entry, status } = this.get(key)

    if (!entry || status === 'MISS' || status === 'EXPIRED') {
      return { entry, status, notModified: false }
    }

    // Check ETag
    if (ifNoneMatch && entry.metadata.etag === ifNoneMatch) {
      this.stats.hits++
      return { entry, status: 'REVALIDATED', notModified: true }
    }

    // Check Last-Modified
    if (ifModifiedSince && entry.metadata.lastModified) {
      if (entry.metadata.lastModified <= ifModifiedSince) {
        this.stats.hits++
        return { entry, status: 'REVALIDATED', notModified: true }
      }
    }

    return { entry, status, notModified: false }
  }

  /**
   * Set entry in cache
   */
  set(key: string, data: Buffer, metadata: Partial<CacheEntryMetadata>): void {
    const now = Date.now()
    const ttl = this.calculateTTL(key, metadata)

    const fullMetadata: CacheEntryMetadata = {
      contentType: metadata.contentType ?? 'application/octet-stream',
      contentLength: data.length,
      contentHash: this.hashContent(data),
      etag: metadata.etag ?? `"${this.hashContent(data).slice(0, 16)}"`,
      lastModified: metadata.lastModified,
      cacheControl: metadata.cacheControl,
      encoding: metadata.encoding ?? 'identity',
      headers: metadata.headers ?? {},
      origin: metadata.origin ?? 'unknown',
      immutable: metadata.immutable ?? false,
    }

    const entry: CacheEntry = {
      key,
      data,
      metadata: fullMetadata,
      expiresAt: ttl > 0 ? now + ttl * 1000 : 0,
      createdAt: now,
      accessCount: 0,
      lastAccessed: now,
    }

    this.cache.set(key, entry, { ttl: ttl > 0 ? ttl * 1000 : undefined })
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Check if key exists (without updating access time)
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Purge entries matching pattern
   */
  purge(pattern: string): number {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
    let purged = 0

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key)
        purged++
      }
    }

    return purged
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear()
    this.stats.evictions += this.cache.size
  }

  // ============================================================================
  // Cache Key Generation
  // ============================================================================

  /**
   * Generate cache key from request
   */
  generateKey(request: CacheKey): string {
    let key = request.path

    // Include query string if present
    if (request.query) {
      key += `?${request.query}`
    }

    // Include vary headers
    if (request.varyHeaders && Object.keys(request.varyHeaders).length > 0) {
      const varyParts = Object.entries(request.varyHeaders)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join('|')
      key += `#${this.hashContent(Buffer.from(varyParts)).slice(0, 8)}`
    }

    return key
  }

  /**
   * Generate content-addressed key (for immutable content)
   */
  generateContentKey(data: Buffer): string {
    return `content:${this.hashContent(data)}`
  }

  // ============================================================================
  // TTL Calculation
  // ============================================================================

  /**
   * Calculate TTL based on path and cache rules
   */
  calculateTTL(path: string, metadata: Partial<CacheEntryMetadata>): number {
    // Respect origin cache-control header
    if (metadata.cacheControl) {
      const maxAge = this.parseCacheControl(metadata.cacheControl)
      if (maxAge !== null) {
        return maxAge
      }
    }

    // Immutable content gets long TTL
    if (metadata.immutable) {
      return this.config.ttlConfig.immutableAssets
    }

    // Check rules in order
    for (const rule of this.config.rules) {
      if (this.matchPattern(path, rule.pattern)) {
        return rule.ttl
      }
    }

    // Content type based defaults
    const contentType = metadata.contentType ?? ''

    if (contentType.includes('text/html')) {
      return this.config.ttlConfig.html
    }
    if (
      contentType.includes('application/javascript') ||
      contentType.includes('text/css')
    ) {
      // Check if path has content hash
      if (this.hasContentHash(path)) {
        return this.config.ttlConfig.immutableAssets
      }
      return this.config.defaultTTL
    }
    if (contentType.includes('font/')) {
      return this.config.ttlConfig.fonts
    }
    if (contentType.includes('image/')) {
      if (this.hasContentHash(path)) {
        return this.config.ttlConfig.immutableAssets
      }
      return this.config.ttlConfig.images
    }
    if (contentType.includes('application/json')) {
      return this.config.ttlConfig.data
    }

    return this.config.defaultTTL
  }

  /**
   * Check if path contains content hash (e.g., main.a1b2c3d4.js)
   */
  private hasContentHash(path: string): boolean {
    // Match patterns like: .a1b2c3d4. or -a1b2c3d4.
    return /[.-][a-f0-9]{8,}\.[a-z]+$/i.test(path)
  }

  /**
   * Parse max-age from Cache-Control header
   */
  private parseCacheControl(header: string): number | null {
    // Check for no-store or no-cache
    if (header.includes('no-store') || header.includes('no-cache')) {
      return 0
    }

    // Extract max-age
    const match = header.match(/max-age=(\d+)/)
    if (match?.[1]) {
      return parseInt(match[1], 10)
    }

    // Check for immutable
    if (header.includes('immutable')) {
      return this.config.ttlConfig.immutableAssets
    }

    return null
  }

  /**
   * Match path against glob pattern
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Convert glob to regex
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\{([^}]+)\}/g, '($1)') +
        '$',
    )
    return regex.test(path)
  }

  // ============================================================================
  // Stale-While-Revalidate
  // ============================================================================

  /**
   * Check if key is being revalidated
   */
  isRevalidating(key: string): boolean {
    return this.revalidating.has(key)
  }

  /**
   * Mark key as being revalidated
   */
  startRevalidation(key: string): void {
    this.revalidating.add(key)
  }

  /**
   * Complete revalidation
   */
  completeRevalidation(key: string): void {
    this.revalidating.delete(key)
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses
    let totalSize = 0
    let oldestEntry = Date.now()
    let newestEntry = 0

    for (const entry of this.cache.values()) {
      totalSize += entry.data.length
      if (entry.createdAt < oldestEntry) oldestEntry = entry.createdAt
      if (entry.createdAt > newestEntry) newestEntry = entry.createdAt
    }

    return {
      entries: this.cache.size,
      sizeBytes: totalSize,
      maxSizeBytes: this.config.maxSizeBytes,
      hitCount: this.stats.hits,
      missCount: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      evictionCount: this.stats.evictions,
      avgEntrySize: this.cache.size > 0 ? totalSize / this.cache.size : 0,
      oldestEntry,
      newestEntry,
    }
  }

  /**
   * Get most popular content by access count
   */
  getPopularContent(
    limit = 100,
  ): Array<{ key: string; accessCount: number; size: number }> {
    const entries: Array<{ key: string; accessCount: number; size: number }> =
      []

    for (const entry of this.cache.values()) {
      entries.push({
        key: entry.key,
        accessCount: entry.accessCount,
        size: entry.data.length,
      })
    }

    return entries.sort((a, b) => b.accessCount - a.accessCount).slice(0, limit)
  }

  /**
   * Get content that should be prefetched to other regions
   * Returns keys with high access counts that aren't yet widely distributed
   */
  getContentForRegionalPrefetch(
    minAccessCount = 10,
    maxAge = 3600000, // 1 hour
  ): Array<{ key: string; data: Buffer; accessCount: number }> {
    const now = Date.now()
    const results: Array<{ key: string; data: Buffer; accessCount: number }> =
      []

    for (const entry of this.cache.values()) {
      // Only consider content that:
      // 1. Has significant access count
      // 2. Is fresh (not about to expire)
      // 3. Is not immutable (already widely cached)
      if (
        entry.accessCount >= minAccessCount &&
        now - entry.createdAt < maxAge &&
        !entry.metadata.immutable
      ) {
        results.push({
          key: entry.key,
          data: entry.data,
          accessCount: entry.accessCount,
        })
      }
    }

    return results.sort((a, b) => b.accessCount - a.accessCount)
  }

  /**
   * Warm cache with content from another region
   */
  warmFromRegion(
    entries: Array<{
      key: string
      data: Buffer
      metadata: Partial<CacheEntryMetadata>
    }>,
  ): number {
    let warmed = 0

    for (const entry of entries) {
      // Don't overwrite existing entries
      if (!this.has(entry.key)) {
        this.set(entry.key, entry.data, entry.metadata)
        warmed++
      }
    }

    return warmed
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      staleHits: 0,
      evictions: 0,
      bytesServed: 0,
    }
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * Hash content for content-addressing
   */
  private hashContent(data: Buffer): string {
    return createHash('sha256').update(data).digestHex()
  }

  /**
   * Get all keys (for debugging/admin)
   */
  keys(): string[] {
    return [...this.cache.keys()]
  }

  /**
   * Get cache size info
   */
  getSizeInfo(): { entries: number; sizeBytes: number; maxBytes: number } {
    let size = 0
    for (const entry of this.cache.values()) {
      size += entry.data.length
    }
    return {
      entries: this.cache.size,
      sizeBytes: size,
      maxBytes: this.config.maxSizeBytes,
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalCache: EdgeCache | null = null

export function getEdgeCache(config?: Partial<EdgeCacheConfig>): EdgeCache {
  if (!globalCache) {
    globalCache = new EdgeCache({
      maxSizeBytes:
        parseInt(process.env.CDN_CACHE_SIZE_MB ?? '512', 10) * 1024 * 1024,
      maxEntries: parseInt(process.env.CDN_CACHE_MAX_ENTRIES ?? '100000', 10),
      defaultTTL: parseInt(process.env.CDN_CACHE_DEFAULT_TTL ?? '3600', 10),
      ...config,
    })
  }
  return globalCache
}

export function resetEdgeCache(): void {
  globalCache = null
}
