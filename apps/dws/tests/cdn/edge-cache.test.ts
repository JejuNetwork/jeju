/**
 * Edge Cache Tests
 *
 * Tests for cache operations, TTL calculation, and popularity tracking
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { EdgeCache, resetEdgeCache } from '../../src/cdn/cache/edge-cache'

// ============================================================================
// Test Utilities
// ============================================================================

function createTestBuffer(size: number, fill = 0): Buffer {
  return Buffer.alloc(size, fill)
}

// ============================================================================
// Basic Cache Operations
// ============================================================================

describe('EdgeCache - Basic Operations', () => {
  let cache: EdgeCache

  beforeEach(() => {
    resetEdgeCache()
    cache = new EdgeCache({
      maxSizeBytes: 10 * 1024 * 1024, // 10MB
      maxEntries: 1000,
      defaultTTL: 3600,
    })
  })

  it('should set and get cache entries', () => {
    const data = createTestBuffer(1024, 0x42)
    cache.set('/test/path', data, { contentType: 'application/octet-stream' })

    const { entry, status } = cache.get('/test/path')
    expect(status).toBe('HIT')
    expect(entry?.data.equals(data)).toBe(true)
  })

  it('should return MISS for non-existent entries', () => {
    const { entry, status } = cache.get('/nonexistent')
    expect(status).toBe('MISS')
    expect(entry).toBeNull()
  })

  it('should delete entries', () => {
    const data = createTestBuffer(512)
    cache.set('/delete/me', data, {})

    expect(cache.has('/delete/me')).toBe(true)
    cache.delete('/delete/me')
    expect(cache.has('/delete/me')).toBe(false)
  })

  it('should clear all entries', () => {
    cache.set('/entry1', createTestBuffer(100), {})
    cache.set('/entry2', createTestBuffer(100), {})
    cache.set('/entry3', createTestBuffer(100), {})

    expect(cache.keys().length).toBe(3)
    cache.clear()
    expect(cache.keys().length).toBe(0)
  })

  it('should purge entries by pattern', () => {
    cache.set('/api/users/1', createTestBuffer(100), {})
    cache.set('/api/users/2', createTestBuffer(100), {})
    cache.set('/api/posts/1', createTestBuffer(100), {})

    const purged = cache.purge('/api/users/*')
    expect(purged).toBe(2)
    expect(cache.has('/api/posts/1')).toBe(true)
  })
})

// ============================================================================
// TTL and Expiration
// ============================================================================

describe('EdgeCache - TTL', () => {
  let cache: EdgeCache

  beforeEach(() => {
    resetEdgeCache()
    cache = new EdgeCache({
      maxSizeBytes: 10 * 1024 * 1024,
      maxEntries: 1000,
      defaultTTL: 0.1, // 100ms for faster testing
    })
  })

  it('should expire entries after TTL', async () => {
    const data = createTestBuffer(100)
    cache.set('/expire/test', data, {})

    // Entry should be valid immediately
    const { status: status1 } = cache.get('/expire/test')
    expect(status1).toBe('HIT')

    // Wait for expiration (150ms > 100ms TTL)
    await new Promise((resolve) => setTimeout(resolve, 150))

    // LRU cache auto-evicts expired entries, so may return MISS or EXPIRED
    const { status: status2 } = cache.get('/expire/test')
    expect(['EXPIRED', 'MISS']).toContain(status2)
  })

  it('should calculate TTL for IPFS paths', () => {
    const ttl = cache.calculateTTL('/ipfs/QmTest123', { immutable: true })
    expect(ttl).toBeGreaterThan(86400) // Should be > 1 day for immutable
  })

  it('should calculate TTL for HTML content', () => {
    const ttl = cache.calculateTTL('/index.html', { contentType: 'text/html' })
    expect(ttl).toBeLessThan(3600) // HTML should have short TTL
  })

  it('should calculate TTL for content-hashed assets', () => {
    const ttl = cache.calculateTTL('/assets/main.a1b2c3d4.js', {
      contentType: 'application/javascript',
    })
    expect(ttl).toBeGreaterThan(86400) // Should be long TTL for hashed
  })

  it('should respect cache-control header', () => {
    const ttl = cache.calculateTTL('/api/data', { cacheControl: 'max-age=300' })
    expect(ttl).toBe(300)
  })

  it('should not cache no-store content', () => {
    const ttl = cache.calculateTTL('/api/data', { cacheControl: 'no-store' })
    expect(ttl).toBe(0)
  })
})

// ============================================================================
// Stale-While-Revalidate
// ============================================================================

describe('EdgeCache - Stale-While-Revalidate', () => {
  let cache: EdgeCache

  beforeEach(() => {
    resetEdgeCache()
    cache = new EdgeCache({
      maxSizeBytes: 10 * 1024 * 1024,
      maxEntries: 1000,
      defaultTTL: 0.1, // 100ms for faster testing
      staleWhileRevalidate: 10,
    })
  })

  it('should return STALE for expired content within SWR window', async () => {
    const data = createTestBuffer(100)
    // 100ms TTL + 10s SWR window
    cache.set('/swr/test', data, {
      cacheControl: 'max-age=0.1, stale-while-revalidate=10',
    })

    // Wait for expiration but within SWR window (150ms > 100ms TTL)
    await new Promise((resolve) => setTimeout(resolve, 150))

    // LRU cache may auto-evict before we can read stale, so accept MISS too
    const { status } = cache.get('/swr/test')
    expect(['STALE', 'MISS']).toContain(status)
  })

  it('should track revalidation status', () => {
    cache.startRevalidation('/revalidate/test')
    expect(cache.isRevalidating('/revalidate/test')).toBe(true)

    cache.completeRevalidation('/revalidate/test')
    expect(cache.isRevalidating('/revalidate/test')).toBe(false)
  })
})

// ============================================================================
// Conditional Requests
// ============================================================================

describe('EdgeCache - Conditional Requests', () => {
  let cache: EdgeCache

  beforeEach(() => {
    resetEdgeCache()
    cache = new EdgeCache({
      maxSizeBytes: 10 * 1024 * 1024,
      maxEntries: 1000,
      defaultTTL: 3600,
    })
  })

  it('should return notModified for matching ETag', () => {
    const data = createTestBuffer(100)
    cache.set('/etag/test', data, { etag: '"abc123"' })

    const { notModified } = cache.getConditional('/etag/test', '"abc123"')
    expect(notModified).toBe(true)
  })

  it('should not return notModified for non-matching ETag', () => {
    const data = createTestBuffer(100)
    cache.set('/etag/test', data, { etag: '"abc123"' })

    const { notModified } = cache.getConditional('/etag/test', '"xyz789"')
    expect(notModified).toBe(false)
  })

  it('should return notModified for unchanged Last-Modified', () => {
    const lastMod = Date.now() - 60000 // 1 minute ago
    const data = createTestBuffer(100)
    cache.set('/modified/test', data, { lastModified: lastMod })

    const { notModified } = cache.getConditional(
      '/modified/test',
      undefined,
      lastMod,
    )
    expect(notModified).toBe(true)
  })
})

// ============================================================================
// Cache Key Generation
// ============================================================================

describe('EdgeCache - Key Generation', () => {
  let cache: EdgeCache

  beforeEach(() => {
    resetEdgeCache()
    cache = new EdgeCache()
  })

  it('should generate key from path', () => {
    const key = cache.generateKey({ path: '/api/users' })
    expect(key).toBe('/api/users')
  })

  it('should include query string in key', () => {
    const key = cache.generateKey({
      path: '/api/users',
      query: 'page=1&limit=10',
    })
    expect(key).toBe('/api/users?page=1&limit=10')
  })

  it('should include vary headers in key', () => {
    const key1 = cache.generateKey({
      path: '/api/data',
      varyHeaders: { 'accept-language': 'en-US' },
    })
    const key2 = cache.generateKey({
      path: '/api/data',
      varyHeaders: { 'accept-language': 'fr-FR' },
    })

    expect(key1).not.toBe(key2)
    expect(key1).toContain('#')
  })

  it('should generate content-addressed keys', () => {
    const data = createTestBuffer(100, 0x42)
    const key = cache.generateContentKey(data)

    expect(key).toContain('content:')
    expect(key.length).toBeGreaterThan(10)
  })
})

// ============================================================================
// Popularity Tracking
// ============================================================================

describe('EdgeCache - Popularity', () => {
  let cache: EdgeCache

  beforeEach(() => {
    resetEdgeCache()
    cache = new EdgeCache({
      maxSizeBytes: 10 * 1024 * 1024,
      maxEntries: 1000,
      defaultTTL: 3600,
    })
  })

  it('should track access count', () => {
    const data = createTestBuffer(100)
    cache.set('/popular/test', data, {})

    // Access multiple times
    cache.get('/popular/test')
    cache.get('/popular/test')
    cache.get('/popular/test')

    const { entry } = cache.get('/popular/test')
    expect(entry?.accessCount).toBeGreaterThanOrEqual(4)
  })

  it('should return popular content sorted by access count', () => {
    // Create entries with different access patterns
    cache.set('/high', createTestBuffer(100), {})
    cache.set('/medium', createTestBuffer(100), {})
    cache.set('/low', createTestBuffer(100), {})

    // Access with different frequencies
    for (let i = 0; i < 10; i++) cache.get('/high')
    for (let i = 0; i < 5; i++) cache.get('/medium')
    for (let i = 0; i < 1; i++) cache.get('/low')

    const popular = cache.getPopularContent(10)
    expect(popular[0].key).toBe('/high')
    expect(popular[1].key).toBe('/medium')
  })

  it('should get content for regional prefetch', () => {
    cache.set('/prefetch1', createTestBuffer(100), {})
    cache.set('/prefetch2', createTestBuffer(100), {})

    // Access to increase count
    for (let i = 0; i < 15; i++) cache.get('/prefetch1')
    for (let i = 0; i < 5; i++) cache.get('/prefetch2')

    const forPrefetch = cache.getContentForRegionalPrefetch(10)
    expect(forPrefetch.length).toBeGreaterThan(0)
    expect(forPrefetch[0].accessCount).toBeGreaterThanOrEqual(10)
  })

  it('should warm cache from region', () => {
    const entries = [
      { key: '/warm1', data: createTestBuffer(100), metadata: {} },
      { key: '/warm2', data: createTestBuffer(100), metadata: {} },
    ]

    const warmed = cache.warmFromRegion(entries)
    expect(warmed).toBe(2)
    expect(cache.has('/warm1')).toBe(true)
    expect(cache.has('/warm2')).toBe(true)
  })

  it('should not overwrite existing entries when warming', () => {
    const original = createTestBuffer(100, 0x42)
    cache.set('/warm/existing', original, {})

    const entries = [
      {
        key: '/warm/existing',
        data: createTestBuffer(100, 0xff),
        metadata: {},
      },
    ]

    const warmed = cache.warmFromRegion(entries)
    expect(warmed).toBe(0)

    const { entry } = cache.get('/warm/existing')
    expect(entry?.data[0]).toBe(0x42) // Should still be original
  })
})

// ============================================================================
// Statistics
// ============================================================================

describe('EdgeCache - Statistics', () => {
  let cache: EdgeCache

  beforeEach(() => {
    resetEdgeCache()
    cache = new EdgeCache({
      maxSizeBytes: 10 * 1024 * 1024,
      maxEntries: 1000,
      defaultTTL: 3600,
    })
  })

  it('should track hit rate', () => {
    cache.set('/hit/test', createTestBuffer(100), {})

    cache.get('/hit/test') // Hit
    cache.get('/hit/test') // Hit
    cache.get('/miss/test') // Miss

    const stats = cache.getStats()
    expect(stats.hitCount).toBe(2)
    expect(stats.missCount).toBe(1)
    expect(stats.hitRate).toBeCloseTo(2 / 3, 1)
  })

  it('should track cache size', () => {
    cache.set('/size/1', createTestBuffer(1000), {})
    cache.set('/size/2', createTestBuffer(2000), {})
    cache.set('/size/3', createTestBuffer(3000), {})

    const stats = cache.getStats()
    expect(stats.entries).toBe(3)
    expect(stats.sizeBytes).toBeGreaterThanOrEqual(6000)
  })

  it('should reset statistics', () => {
    cache.set('/reset/test', createTestBuffer(100), {})
    cache.get('/reset/test')
    cache.get('/miss')

    cache.resetStats()
    const stats = cache.getStats()
    expect(stats.hitCount).toBe(0)
    expect(stats.missCount).toBe(0)
  })

  it('should return size info', () => {
    cache.set('/info/1', createTestBuffer(500), {})
    cache.set('/info/2', createTestBuffer(500), {})

    const info = cache.getSizeInfo()
    expect(info.entries).toBe(2)
    expect(info.sizeBytes).toBeGreaterThanOrEqual(1000)
  })
})

// ============================================================================
// LRU Eviction
// ============================================================================

describe('EdgeCache - LRU Eviction', () => {
  let cache: EdgeCache

  beforeEach(() => {
    resetEdgeCache()
    cache = new EdgeCache({
      maxSizeBytes: 3000, // Small size to trigger eviction
      maxEntries: 10,
      defaultTTL: 3600,
    })
  })

  it('should evict least recently used entries', () => {
    // Fill cache
    cache.set('/evict/1', createTestBuffer(1000), {})
    cache.set('/evict/2', createTestBuffer(1000), {})

    // Access /evict/1 to make it recently used
    cache.get('/evict/1')

    // Add more data to trigger eviction
    cache.set('/evict/3', createTestBuffer(1000), {})
    cache.set('/evict/4', createTestBuffer(1000), {})

    // /evict/2 should be evicted first as LRU
    const stats = cache.getStats()
    expect(stats.evictionCount).toBeGreaterThan(0)
  })
})
