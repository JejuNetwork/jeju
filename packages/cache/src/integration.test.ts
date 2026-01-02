/**
 * Integration tests for @jejunetwork/cache
 *
 * These tests require a running DWS server and test the full client-server flow.
 * Run with: INTEGRATION=1 bun test src/integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CacheClient, getCacheClient, resetCacheClients } from './client'

// Skip integration tests unless INTEGRATION=1 is set
const SKIP_INTEGRATION = !process.env.INTEGRATION
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'

describe.skipIf(SKIP_INTEGRATION)('Cache Client Integration', () => {
  let client: CacheClient
  const namespace = `test-${Date.now()}`

  beforeAll(() => {
    client = new CacheClient({
      serverUrl: DWS_URL,
      namespace,
    })
  })

  afterAll(async () => {
    // Clean up test namespace
    await client.flushdb()
    resetCacheClients()
  })

  it('should set and get a value', async () => {
    const key = 'test-key'
    const value = 'test-value'

    const setResult = await client.set(key, value)
    expect(setResult.success).toBe(true)

    const result = await client.get(key)
    expect(result).toBe(value)
  })

  it('should set with TTL', async () => {
    const key = 'ttl-key'
    await client.set(key, 'expires', { ttl: 60 })

    const ttl = await client.ttl(key)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })

  it('should set with numeric TTL (backwards compat)', async () => {
    const key = 'numeric-ttl-key'
    await client.set(key, 'expires', 120)

    const ttl = await client.ttl(key)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(120)
  })

  it('should return null for non-existent key', async () => {
    const result = await client.get('non-existent-key-12345')
    expect(result).toBeNull()
  })

  it('should delete keys', async () => {
    const key = 'delete-key'
    await client.set(key, 'to-delete')

    const deleted = await client.del(key)
    expect(deleted).toBe(1)

    const result = await client.get(key)
    expect(result).toBeNull()
  })

  it('should delete via delete() alias', async () => {
    const key = 'delete-alias-key'
    await client.set(key, 'to-delete')

    const deleted = await client.delete(key)
    expect(deleted).toBe(true)
  })

  it('should check key existence', async () => {
    const key = 'exists-key'
    await client.set(key, 'exists')

    const exists = await client.exists(key)
    expect(exists).toBe(1)

    await client.del(key)
    const notExists = await client.exists(key)
    expect(notExists).toBe(0)
  })

  it('should mget and mset multiple values', async () => {
    const entries = [
      { key: 'm1', value: 'v1' },
      { key: 'm2', value: 'v2' },
      { key: 'm3', value: 'v3' },
    ]

    await client.mset(entries)

    const result = await client.mget('m1', 'm2', 'm3')
    expect(result.get('m1')).toBe('v1')
    expect(result.get('m2')).toBe('v2')
    expect(result.get('m3')).toBe('v3')
  })

  it('should increment values', async () => {
    const key = 'counter'
    await client.set(key, '10')

    const result = await client.incr(key, 5)
    expect(result).toBe(15)
  })

  it('should decrement values', async () => {
    const key = 'counter2'
    await client.set(key, '20')

    const result = await client.decr(key, 3)
    expect(result).toBe(17)
  })

  it('should work with hash operations', async () => {
    const key = 'user:1'

    await client.hset(key, 'name', 'Alice')
    await client.hset(key, 'age', '30')

    const name = await client.hget(key, 'name')
    expect(name).toBe('Alice')

    const all = await client.hgetall(key)
    expect(all.name).toBe('Alice')
    expect(all.age).toBe('30')
  })

  it('should work with hmset', async () => {
    const key = 'user:2'
    await client.hmset(key, { name: 'Bob', city: 'Tokyo' })

    const all = await client.hgetall(key)
    expect(all.name).toBe('Bob')
    expect(all.city).toBe('Tokyo')
  })

  it('should work with list operations', async () => {
    const key = 'queue'

    await client.rpush(key, 'first', 'second')
    await client.lpush(key, 'zeroth')

    const len = await client.llen(key)
    expect(len).toBe(3)

    const range = await client.lrange(key, 0, -1)
    expect(range).toContain('zeroth')
    expect(range).toContain('first')
    expect(range).toContain('second')

    const popped = await client.lpop(key)
    expect(popped).toBe('zeroth')
  })

  it('should work with set operations', async () => {
    const key = 'tags'

    const added = await client.sadd(key, 'a', 'b', 'c', 'a') // 'a' is duplicate
    expect(added).toBe(3) // Only 3 unique

    const isMember = await client.sismember(key, 'b')
    expect(isMember).toBe(true)

    const members = await client.smembers(key)
    expect(members.sort()).toEqual(['a', 'b', 'c'])

    const size = await client.scard(key)
    expect(size).toBe(3)
  })

  it('should work with sorted set operations', async () => {
    const key = 'leaderboard'

    await client.zadd(
      key,
      { member: 'player1', score: 100 },
      { member: 'player2', score: 200 },
      { member: 'player3', score: 150 },
    )

    const size = await client.zcard(key)
    expect(size).toBe(3)

    // Sorted by score ascending
    const top = await client.zrange(key, 0, -1)
    expect(top).toEqual(['player1', 'player3', 'player2'])
  })

  it('should expire keys', async () => {
    const key = 'expire-key'
    await client.set(key, 'value')

    const success = await client.expire(key, 300)
    expect(success).toBe(true)

    const ttl = await client.ttl(key)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(300)
  })

  it('should list keys with pattern', async () => {
    await client.set('pattern:one', '1')
    await client.set('pattern:two', '2')
    await client.set('other:key', '3')

    const keys = await client.keys('pattern:*')
    expect(keys.length).toBeGreaterThanOrEqual(2)
    expect(keys.some((k) => k.includes('pattern:'))).toBe(true)
  })

  it('should get stats', async () => {
    const stats = await client.stats()
    expect(typeof stats.totalKeys).toBe('number')
    expect(typeof stats.usedMemoryBytes).toBe('number')
    expect(typeof stats.hits).toBe('number')
    expect(typeof stats.misses).toBe('number')
    expect(typeof stats.hitRate).toBe('number')
    expect(typeof stats.uptime).toBe('number')
  })

  it('should get stats via getStats alias', async () => {
    const stats = await client.getStats()
    expect(typeof stats.totalKeys).toBe('number')
  })

  it('should check health', async () => {
    const health = await client.health()
    expect(health.status).toBe('healthy')
    expect(typeof health.uptime).toBe('number')
  })

  it('should ping', async () => {
    const pong = await client.ping()
    expect(pong).toBe(true)
  })

  it('should clear namespace', async () => {
    await client.set('clear1', 'v1')
    await client.set('clear2', 'v2')

    await client.clear()

    const keys = await client.keys('*')
    expect(keys.length).toBe(0)
  })
})

describe.skipIf(SKIP_INTEGRATION)('getCacheClient factory', () => {
  afterAll(() => {
    resetCacheClients()
  })

  it('should return singleton per namespace', () => {
    const client1 = getCacheClient('factory-test')
    const client2 = getCacheClient('factory-test')
    const client3 = getCacheClient('different-namespace')

    expect(client1).toBe(client2) // Same reference
    expect(client1).not.toBe(client3) // Different reference
  })
})

