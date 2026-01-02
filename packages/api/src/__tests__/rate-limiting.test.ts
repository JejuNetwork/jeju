import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  createRateLimitHeaders,
  createRateLimitKey,
  extractClientIp,
  getRateLimiter,
  InMemoryRateLimitStore,
  initRateLimiter,
  RateLimiter,
  resetRateLimiter,
} from '../rate-limiting/core'
import { type RateLimitTier, RateLimitTiers } from '../rate-limiting/types'

describe('Rate Limiting Core', () => {
  describe('InMemoryRateLimitStore', () => {
    test('stores and retrieves entries', async () => {
      const store = new InMemoryRateLimitStore()

      await store.set('key1', { count: 5, resetAt: Date.now() + 60000 })
      const entry = await store.get('key1')

      expect(entry).toBeDefined()
      expect(entry?.count).toBe(5)
    })

    test('returns undefined for missing keys', async () => {
      const store = new InMemoryRateLimitStore()
      const entry = await store.get('nonexistent')

      expect(entry).toBeUndefined()
    })

    test('deletes entries', async () => {
      const store = new InMemoryRateLimitStore()

      await store.set('key1', { count: 5, resetAt: Date.now() + 60000 })
      await store.delete('key1')
      const entry = await store.get('key1')

      expect(entry).toBeUndefined()
    })

    test('clears all entries', async () => {
      const store = new InMemoryRateLimitStore()

      await store.set('key1', { count: 5, resetAt: Date.now() + 60000 })
      await store.set('key2', { count: 10, resetAt: Date.now() + 60000 })
      await store.clear()

      expect(await store.get('key1')).toBeUndefined()
      expect(await store.get('key2')).toBeUndefined()
    })

    test('cleans up expired entries', async () => {
      const store = new InMemoryRateLimitStore()

      // Add expired entry
      await store.set('expired', { count: 5, resetAt: Date.now() - 1000 })
      // Add valid entry
      await store.set('valid', { count: 3, resetAt: Date.now() + 60000 })

      const removed = store.cleanup()

      expect(removed).toBe(1)
      expect(await store.get('expired')).toBeUndefined()
      expect(await store.get('valid')).toBeDefined()
    })

    test('evicts oldest entries when at capacity', async () => {
      const store = new InMemoryRateLimitStore(5) // Small capacity

      // Fill the store
      for (let i = 0; i < 5; i++) {
        await store.set(`key${i}`, { count: i, resetAt: Date.now() + i * 1000 })
      }

      // Add one more - should trigger eviction
      await store.set('new-key', { count: 99, resetAt: Date.now() + 99000 })

      // New key should exist
      expect(await store.get('new-key')).toBeDefined()
      // Store should have evicted some entries
      expect(store.size).toBeLessThanOrEqual(5)
    })

    test('handles maxSize of 1', async () => {
      const store = new InMemoryRateLimitStore(1)

      await store.set('key1', { count: 1, resetAt: Date.now() + 60000 })
      expect(store.size).toBe(1)

      await store.set('key2', { count: 2, resetAt: Date.now() + 60000 })
      expect(store.size).toBe(1)
      expect(await store.get('key2')).toBeDefined()
    })

    test('does not evict when updating existing key at capacity', async () => {
      const store = new InMemoryRateLimitStore(3)

      await store.set('key1', { count: 1, resetAt: Date.now() + 60000 })
      await store.set('key2', { count: 2, resetAt: Date.now() + 60000 })
      await store.set('key3', { count: 3, resetAt: Date.now() + 60000 })

      // Update existing key - should not evict anything
      await store.set('key2', { count: 10, resetAt: Date.now() + 60000 })

      expect(store.size).toBe(3)
      expect(await store.get('key1')).toBeDefined()
      expect(await store.get('key2')).toBeDefined()
      expect((await store.get('key2'))?.count).toBe(10)
      expect(await store.get('key3')).toBeDefined()
    })

    test('cleanup handles empty store', () => {
      const store = new InMemoryRateLimitStore()
      const removed = store.cleanup()
      expect(removed).toBe(0)
    })

    test('get returns undefined for expired entry and removes it', async () => {
      const store = new InMemoryRateLimitStore()

      // Add already expired entry directly
      await store.set('expired', { count: 5, resetAt: Date.now() - 1 })

      // Get should return undefined and clean up
      const entry = await store.get('expired')
      expect(entry).toBeUndefined()
    })

    test('handles concurrent operations', async () => {
      const store = new InMemoryRateLimitStore()

      // Run concurrent sets and gets
      const operations = Array.from({ length: 100 }, async (_, i) => {
        await store.set(`key${i % 10}`, {
          count: i,
          resetAt: Date.now() + 60000,
        })
        return store.get(`key${i % 10}`)
      })

      const results = await Promise.all(operations)

      // All operations should complete without error
      expect(results.length).toBe(100)
      // Each result should be defined
      results.forEach((result) => {
        expect(result).toBeDefined()
      })
    })
  })

  describe('RateLimiter', () => {
    let limiter: RateLimiter

    beforeEach(() => {
      // Use InMemoryRateLimitStore explicitly for unit tests
      limiter = new RateLimiter(
        { defaultTier: { maxRequests: 10, windowMs: 60000 } },
        new InMemoryRateLimitStore(),
      )
    })

    afterEach(() => {
      limiter.stop()
    })

    test('allows requests under limit', async () => {
      const result = await limiter.check('test-key')

      expect(result.allowed).toBe(true)
      expect(result.current).toBe(1)
      expect(result.remaining).toBe(9)
    })

    test('blocks requests over limit', async () => {
      // Make 10 requests (the limit)
      for (let i = 0; i < 10; i++) {
        await limiter.check('test-key')
      }

      // 11th request should be blocked
      const result = await limiter.check('test-key')

      expect(result.allowed).toBe(false)
      expect(result.current).toBe(11)
      expect(result.remaining).toBe(0)
      expect(result.error).toBe('Rate limit exceeded')
    })

    test('resets after window expires', async () => {
      // Use InMemoryRateLimitStore explicitly for unit tests
      const fastLimiter = new RateLimiter(
        { defaultTier: { maxRequests: 2, windowMs: 100 } },
        new InMemoryRateLimitStore(),
      )

      try {
        // Use up the limit
        await fastLimiter.check('test-key')
        await fastLimiter.check('test-key')
        const blocked = await fastLimiter.check('test-key')
        expect(blocked.allowed).toBe(false)

        // Wait for window to expire
        await new Promise((resolve) => setTimeout(resolve, 150))

        // Should be allowed again
        const result = await fastLimiter.check('test-key')
        expect(result.allowed).toBe(true)
        expect(result.current).toBe(1)
      } finally {
        fastLimiter.stop()
      }
    })

    test('uses custom tier', async () => {
      const customTier: RateLimitTier = { maxRequests: 3, windowMs: 60000 }

      await limiter.check('test-key', customTier)
      await limiter.check('test-key', customTier)
      await limiter.check('test-key', customTier)
      const result = await limiter.check('test-key', customTier)

      expect(result.allowed).toBe(false)
      expect(result.limit).toBe(3)
    })

    test('status does not increment count', async () => {
      await limiter.check('test-key')
      await limiter.check('test-key')

      const status = await limiter.status('test-key')

      expect(status.current).toBe(2)
      expect(status.allowed).toBe(true)

      // Check again - should still be 2
      const status2 = await limiter.status('test-key')
      expect(status2.current).toBe(2)
    })

    test('reset clears the limit', async () => {
      await limiter.check('test-key')
      await limiter.check('test-key')

      await limiter.reset('test-key')

      const result = await limiter.check('test-key')
      expect(result.current).toBe(1)
    })
  })

  describe('extractClientIp', () => {
    test('extracts from x-forwarded-for', () => {
      const ip = extractClientIp({
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
      })

      expect(ip).toBe('1.2.3.4')
    })

    test('extracts from x-real-ip', () => {
      const ip = extractClientIp({
        'x-real-ip': '1.2.3.4',
      })

      expect(ip).toBe('1.2.3.4')
    })

    test('extracts from cf-connecting-ip', () => {
      const ip = extractClientIp({
        'cf-connecting-ip': '1.2.3.4',
      })

      expect(ip).toBe('1.2.3.4')
    })

    test('returns unknown when no headers', () => {
      const ip = extractClientIp({})
      expect(ip).toBe('unknown')
    })

    test('prefers x-forwarded-for over x-real-ip', () => {
      const ip = extractClientIp({
        'x-forwarded-for': '1.1.1.1',
        'x-real-ip': '2.2.2.2',
      })

      expect(ip).toBe('1.1.1.1')
    })

    test('handles Headers object', () => {
      const headers = new Headers()
      headers.set('x-forwarded-for', '10.0.0.1, 10.0.0.2')
      const ip = extractClientIp(headers)
      expect(ip).toBe('10.0.0.1')
    })

    test('handles empty x-forwarded-for', () => {
      const ip = extractClientIp({ 'x-forwarded-for': '' })
      expect(ip).toBe('unknown')
    })

    test('handles x-forwarded-for with only whitespace', () => {
      const ip = extractClientIp({ 'x-forwarded-for': '   ' })
      expect(ip).toBe('unknown')
    })

    test('extracts single IP from x-forwarded-for', () => {
      const ip = extractClientIp({ 'x-forwarded-for': '192.168.1.1' })
      expect(ip).toBe('192.168.1.1')
    })

    test('handles case-insensitive headers object', () => {
      const ip = extractClientIp({
        'X-Forwarded-For': '172.16.0.1',
      })
      expect(ip).toBe('172.16.0.1')
    })
  })

  describe('createRateLimitHeaders', () => {
    test('creates headers for allowed request', () => {
      const headers = createRateLimitHeaders({
        allowed: true,
        current: 5,
        limit: 100,
        remaining: 95,
        resetInSeconds: 60,
      })

      expect(headers['X-RateLimit-Limit']).toBe('100')
      expect(headers['X-RateLimit-Remaining']).toBe('95')
      expect(headers['X-RateLimit-Reset']).toBe('60')
      expect(headers['Retry-After']).toBeUndefined()
    })

    test('creates headers with Retry-After for blocked request', () => {
      const headers = createRateLimitHeaders({
        allowed: false,
        current: 101,
        limit: 100,
        remaining: 0,
        resetInSeconds: 45,
      })

      expect(headers['Retry-After']).toBe('45')
    })
  })

  describe('createRateLimitKey', () => {
    test('creates key from IP only', () => {
      const key = createRateLimitKey('1.2.3.4')
      expect(key).toBe('1.2.3.4')
    })

    test('creates key from IP and user ID', () => {
      const key = createRateLimitKey('1.2.3.4', 'user123')
      expect(key).toBe('1.2.3.4:user123')
    })

    test('creates key with path', () => {
      const key = createRateLimitKey('1.2.3.4', 'user123', '/api/v1/todos')
      expect(key).toBe('1.2.3.4:user123:_api_v1_todos')
    })
  })

  describe('RateLimitTiers', () => {
    test('FREE tier has correct values', () => {
      expect(RateLimitTiers.FREE.maxRequests).toBe(60)
      expect(RateLimitTiers.FREE.windowMs).toBe(60000)
    })

    test('PREMIUM tier is higher than FREE', () => {
      expect(RateLimitTiers.PREMIUM.maxRequests).toBeGreaterThan(
        RateLimitTiers.FREE.maxRequests,
      )
    })

    test('UNLIMITED has very high limit', () => {
      expect(RateLimitTiers.UNLIMITED.maxRequests).toBe(Number.MAX_SAFE_INTEGER)
    })
  })

  describe('Named Tier Lookup', () => {
    let limiter: RateLimiter

    beforeEach(() => {
      // Use InMemoryRateLimitStore explicitly for unit tests
      limiter = new RateLimiter(
        {
          defaultTier: RateLimitTiers.FREE,
          tiers: {
            FREE: RateLimitTiers.FREE,
            BASIC: RateLimitTiers.BASIC,
            PREMIUM: RateLimitTiers.PREMIUM,
          },
        },
        new InMemoryRateLimitStore(),
      )
    })

    afterEach(() => {
      limiter.stop()
    })

    test('uses named tier by string', async () => {
      const result = await limiter.check('test-key', 'PREMIUM')

      expect(result.limit).toBe(RateLimitTiers.PREMIUM.maxRequests)
    })

    test('throws for unknown tier name', async () => {
      await expect(limiter.check('test-key', 'UNKNOWN_TIER')).rejects.toThrow(
        'Unknown rate limit tier: UNKNOWN_TIER',
      )
    })

    test('uses default tier when no tier specified', async () => {
      const result = await limiter.check('test-key')

      expect(result.limit).toBe(RateLimitTiers.FREE.maxRequests)
    })

    test('uses tier object directly', async () => {
      const customTier: RateLimitTier = { maxRequests: 42, windowMs: 1000 }
      const result = await limiter.check('test-key', customTier)

      expect(result.limit).toBe(42)
    })
  })

  describe('Skip Configuration', () => {
    let limiter: RateLimiter

    beforeEach(() => {
      limiter = new RateLimiter({
        defaultTier: RateLimitTiers.FREE,
        skipIps: ['127.0.0.1', '::1'],
        skipPaths: ['/health', '/api/v1/docs'],
      })
    })

    afterEach(() => {
      limiter.stop()
    })

    test('skips configured IPs', () => {
      expect(limiter.shouldSkipIp('127.0.0.1')).toBe(true)
      expect(limiter.shouldSkipIp('::1')).toBe(true)
      expect(limiter.shouldSkipIp('192.168.1.1')).toBe(false)
    })

    test('skips configured paths', () => {
      expect(limiter.shouldSkipPath('/health')).toBe(true)
      expect(limiter.shouldSkipPath('/api/v1/docs')).toBe(true)
      expect(limiter.shouldSkipPath('/api/v1/docs/swagger')).toBe(true)
      expect(limiter.shouldSkipPath('/api/v1/users')).toBe(false)
    })
  })

  describe('Global Rate Limiter', () => {
    afterEach(() => {
      resetRateLimiter()
    })

    test('throws when not initialized', () => {
      expect(() => getRateLimiter()).toThrow(
        'Rate limiter not initialized. Call initRateLimiter first.',
      )
    })

    test('initializes and returns rate limiter', () => {
      const limiter = initRateLimiter({
        defaultTier: RateLimitTiers.FREE,
      })

      expect(limiter).toBeInstanceOf(RateLimiter)
      expect(getRateLimiter()).toBe(limiter)
    })

    test('replaces existing rate limiter on reinit', () => {
      const limiter1 = initRateLimiter({
        defaultTier: RateLimitTiers.FREE,
      })

      const limiter2 = initRateLimiter({
        defaultTier: RateLimitTiers.PREMIUM,
      })

      expect(getRateLimiter()).toBe(limiter2)
      expect(getRateLimiter()).not.toBe(limiter1)
    })

    test('reset clears the rate limiter', () => {
      initRateLimiter({
        defaultTier: RateLimitTiers.FREE,
      })

      resetRateLimiter()

      expect(() => getRateLimiter()).toThrow()
    })

    test('reset is safe when not initialized', () => {
      expect(() => resetRateLimiter()).not.toThrow()
    })
  })
})
