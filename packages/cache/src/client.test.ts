import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { CacheClient, createCacheClient } from './client'
import { CacheError } from './types'

/** Creates a mock fetch that satisfies Bun's typeof fetch (includes preconnect) */
function createMockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  const mockFn = mock(handler)
  return Object.assign(mockFn, { preconnect: () => {} }) as typeof fetch
}

describe('CacheClient', () => {
  let client: CacheClient
  let mockFetch: typeof fetch
  const originalFetch = global.fetch

  beforeEach(() => {
    client = new CacheClient({
      serverUrl: 'http://localhost:3000',
      namespace: 'test',
    })

    mockFetch = createMockFetch((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      const method = init?.method ?? 'GET'

      // Health endpoint
      if (path === '/cache/health' && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'healthy', uptime: 12345 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      // Stats endpoint
      if (path === '/cache/stats' && method === 'GET') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              shared: {
                totalKeys: 100,
                usedMemoryBytes: 1024000,
                maxMemoryBytes: 268435456,
                hits: 500,
                misses: 50,
                hitRate: 0.909,
                evictions: 10,
                expiredKeys: 20,
                avgKeySize: 50,
                avgValueSize: 200,
                oldestKeyAge: 3600000,
                namespaces: 3,
                uptime: 86400000,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      // Set endpoint
      if (path === '/cache/set' && method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      // Get endpoint
      if (path.startsWith('/cache/get') && method === 'GET') {
        const params = new URL(url).searchParams
        const key = params.get('key')
        if (key === 'exists') {
          return Promise.resolve(
            new Response(JSON.stringify({ value: 'test-value', found: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ value: null, found: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      // Del endpoint
      if (path === '/cache/del' && method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ deleted: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      // Incr endpoint
      if (path === '/cache/incr' && method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ value: 42 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      // Decr endpoint
      if (path === '/cache/decr' && method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ value: 41 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      // Default 404
      return Promise.resolve(
        new Response('Not Found', {
          status: 404,
        }),
      )
    })

    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('should create client with createCacheClient helper', () => {
    const c = createCacheClient('http://localhost:3000', { namespace: 'app' })
    expect(c).toBeInstanceOf(CacheClient)
  })

  it('should check health', async () => {
    const health = await client.health()
    expect(health.status).toBe('healthy')
    expect(health.uptime).toBe(12345)
  })

  it('should ping server', async () => {
    const pong = await client.ping()
    expect(pong).toBe(true)
  })

  it('should get stats', async () => {
    const stats = await client.stats()
    expect(stats.totalKeys).toBe(100)
    expect(stats.hitRate).toBeCloseTo(0.909, 2)
  })

  it('should set a value', async () => {
    const result = await client.set('key1', 'value1')
    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/cache/set',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          key: 'key1',
          value: 'value1',
          ttl: 3600,
          namespace: 'test',
          nx: undefined,
          xx: undefined,
        }),
      }),
    )
  })

  it('should set with custom TTL', async () => {
    await client.set('key1', 'value1', { ttl: 7200 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/cache/set',
      expect.objectContaining({
        body: JSON.stringify({
          key: 'key1',
          value: 'value1',
          ttl: 7200,
          namespace: 'test',
          nx: undefined,
          xx: undefined,
        }),
      }),
    )
  })

  it('should get an existing value', async () => {
    const value = await client.get('exists')
    expect(value).toBe('test-value')
  })

  it('should return null for non-existent key', async () => {
    const value = await client.get('missing')
    expect(value).toBeNull()
  })

  it('should delete keys', async () => {
    const deleted = await client.del('key1')
    expect(deleted).toBe(1)
  })

  it('should increment value', async () => {
    const value = await client.incr('counter')
    expect(value).toBe(42)
  })

  it('should decrement value', async () => {
    const value = await client.decr('counter')
    expect(value).toBe(41)
  })

  it('should retry on server error', async () => {
    let attempts = 0
    global.fetch = createMockFetch(() => {
      attempts++
      if (attempts < 3) {
        return Promise.resolve(new Response('Error', { status: 500 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      )
    })

    const result = await client.set('key', 'value')
    expect(result.success).toBe(true)
    expect(attempts).toBe(3)
  })

  it('should not retry on client error', async () => {
    let attempts = 0
    global.fetch = createMockFetch(() => {
      attempts++
      return Promise.resolve(new Response('Bad Request', { status: 400 }))
    })

    await expect(client.set('key', 'value')).rejects.toThrow(CacheError)
    expect(attempts).toBe(1) // No retries on 4xx
  })
})
