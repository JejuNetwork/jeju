/**
 * Redis Client Compatibility Tests
 *
 * Tests that popular Redis clients work with DWS Cache's Redis protocol server.
 *
 * Tested clients:
 * - ioredis (most popular Node.js Redis client)
 * - node-redis (official Redis client)
 * - Upstash REST API (HTTP-based)
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test'
import { getLocalhostHost } from '@jejunetwork/config'
import { assertNotNull } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import Redis from 'ioredis'
import { createClient } from 'redis'
import { CacheEngine } from '../api/cache/engine'
import {
  createRedisProtocolServer,
  type RedisProtocolServer,
} from '../api/cache/redis-protocol'

const TEST_PORT = 16379 // Use non-standard port for testing

describe('Redis Client Compatibility', () => {
  let engine: CacheEngine
  let server: RedisProtocolServer

  beforeAll(async () => {
    engine = new CacheEngine({
      maxMemoryMb: 64,
      defaultTtlSeconds: 3600,
    })

    server = createRedisProtocolServer(engine, {
      port: TEST_PORT,
      namespace: 'test',
    })

    await server.start()
  })

  afterAll(() => {
    server.stop()
    engine.stop()
  })

  // =========================================================================
  // ioredis Tests
  // =========================================================================

  describe('ioredis', () => {
    let redis: Redis

    beforeEach(async () => {
      redis = new Redis({
        port: TEST_PORT,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      })
      await redis.connect()
    })

    afterEach(async () => {
      await redis.flushdb()
      redis.disconnect()
    })

    describe('Connection', () => {
      it('should connect successfully', async () => {
        const pong = await redis.ping()
        expect(pong).toBe('PONG')
      })

      it('should handle ECHO', async () => {
        const result = await redis.echo('hello')
        expect(result).toBe('hello')
      })
    })

    describe('String Commands', () => {
      it('should SET and GET', async () => {
        await redis.set('key1', 'value1')
        const result = await redis.get('key1')
        expect(result).toBe('value1')
      })

      it('should return null for non-existent key', async () => {
        const result = await redis.get('nonexistent')
        expect(result).toBeNull()
      })

      it('should SET with EX (expiry in seconds)', async () => {
        await redis.set('key1', 'value1', 'EX', 60)
        const ttl = await redis.ttl('key1')
        expect(ttl).toBeGreaterThan(0)
        expect(ttl).toBeLessThanOrEqual(60)
      })

      it('should SET with NX (only if not exists)', async () => {
        await redis.set('key1', 'value1')
        const result = await redis.set('key1', 'value2', 'NX')
        expect(result).toBeNull()
        expect(await redis.get('key1')).toBe('value1')
      })

      it('should MSET and MGET', async () => {
        await redis.mset('k1', 'v1', 'k2', 'v2', 'k3', 'v3')
        const result = await redis.mget('k1', 'k2', 'k3')
        expect(result).toEqual(['v1', 'v2', 'v3'])
      })

      it('should INCR and DECR', async () => {
        await redis.set('counter', '10')
        expect(await redis.incr('counter')).toBe(11)
        expect(await redis.decr('counter')).toBe(10)
        expect(await redis.incrby('counter', 5)).toBe(15)
        expect(await redis.decrby('counter', 3)).toBe(12)
      })

      it('should APPEND', async () => {
        await redis.set('key', 'Hello')
        const len = await redis.append('key', ' World')
        expect(len).toBe(11)
        expect(await redis.get('key')).toBe('Hello World')
      })
    })

    describe('Key Commands', () => {
      it('should DEL keys', async () => {
        await redis.set('key1', 'value1')
        await redis.set('key2', 'value2')
        const deleted = await redis.del('key1', 'key2')
        expect(deleted).toBe(2)
      })

      it('should check EXISTS', async () => {
        await redis.set('key1', 'value1')
        expect(await redis.exists('key1')).toBe(1)
        expect(await redis.exists('nonexistent')).toBe(0)
      })

      it('should EXPIRE and check TTL', async () => {
        await redis.set('key1', 'value1')
        await redis.expire('key1', 60)
        const ttl = await redis.ttl('key1')
        expect(ttl).toBeGreaterThan(0)
        expect(ttl).toBeLessThanOrEqual(60)
      })

      it('should PERSIST', async () => {
        await redis.set('key1', 'value1', 'EX', 60)
        await redis.persist('key1')
        const ttl = await redis.ttl('key1')
        expect(ttl).toBe(-1)
      })

      it('should get TYPE', async () => {
        await redis.set('str', 'value')
        await redis.hset('hash', 'field', 'value')
        await redis.lpush('list', 'value')
        await redis.sadd('set', 'value')
        await redis.zadd('zset', 1, 'value')

        expect(await redis.type('str')).toBe('string')
        expect(await redis.type('hash')).toBe('hash')
        expect(await redis.type('list')).toBe('list')
        expect(await redis.type('set')).toBe('set')
        expect(await redis.type('zset')).toBe('zset')
      })

      it('should list KEYS', async () => {
        await redis.set('user:1', 'a')
        await redis.set('user:2', 'b')
        await redis.set('order:1', 'c')

        const userKeys = await redis.keys('user:*')
        expect(userKeys.sort()).toEqual(['user:1', 'user:2'])
      })
    })

    describe('Hash Commands', () => {
      it('should HSET and HGET', async () => {
        await redis.hset('user:1', 'name', 'Alice', 'age', '30')
        expect(await redis.hget('user:1', 'name')).toBe('Alice')
        expect(await redis.hget('user:1', 'age')).toBe('30')
      })

      it('should HMGET', async () => {
        await redis.hset('user:1', 'name', 'Alice', 'age', '30', 'city', 'NYC')
        const result = await redis.hmget('user:1', 'name', 'age')
        expect(result).toEqual(['Alice', '30'])
      })

      it('should HGETALL', async () => {
        await redis.hset('user:1', 'name', 'Alice', 'age', '30')
        const result = await redis.hgetall('user:1')
        expect(result).toEqual({ name: 'Alice', age: '30' })
      })

      it('should HDEL', async () => {
        await redis.hset('user:1', 'name', 'Alice', 'age', '30')
        await redis.hdel('user:1', 'age')
        expect(await redis.hget('user:1', 'age')).toBeNull()
      })

      it('should check HEXISTS', async () => {
        await redis.hset('user:1', 'name', 'Alice')
        expect(await redis.hexists('user:1', 'name')).toBe(1)
        expect(await redis.hexists('user:1', 'age')).toBe(0)
      })

      it('should HINCRBY', async () => {
        await redis.hset('user:1', 'score', '100')
        expect(await redis.hincrby('user:1', 'score', 10)).toBe(110)
      })

      it('should get HKEYS and HVALS', async () => {
        await redis.hset('user:1', 'name', 'Alice', 'age', '30')
        expect((await redis.hkeys('user:1')).sort()).toEqual(['age', 'name'])
        expect((await redis.hvals('user:1')).sort()).toEqual(['30', 'Alice'])
      })
    })

    describe('List Commands', () => {
      it('should LPUSH and RPUSH', async () => {
        await redis.rpush('list', 'a', 'b')
        await redis.lpush('list', 'z')
        const result = await redis.lrange('list', 0, -1)
        expect(result).toEqual(['z', 'a', 'b'])
      })

      it('should LPOP and RPOP', async () => {
        await redis.rpush('list', 'a', 'b', 'c')
        expect(await redis.lpop('list')).toBe('a')
        expect(await redis.rpop('list')).toBe('c')
      })

      it('should get LLEN', async () => {
        await redis.rpush('list', 'a', 'b', 'c')
        expect(await redis.llen('list')).toBe(3)
      })

      it('should LINDEX', async () => {
        await redis.rpush('list', 'a', 'b', 'c')
        expect(await redis.lindex('list', 1)).toBe('b')
        expect(await redis.lindex('list', -1)).toBe('c')
      })

      it('should LSET', async () => {
        await redis.rpush('list', 'a', 'b', 'c')
        await redis.lset('list', 1, 'B')
        expect(await redis.lindex('list', 1)).toBe('B')
      })

      it('should LTRIM', async () => {
        await redis.rpush('list', 'a', 'b', 'c', 'd', 'e')
        await redis.ltrim('list', 1, 3)
        expect(await redis.lrange('list', 0, -1)).toEqual(['b', 'c', 'd'])
      })
    })

    describe('Set Commands', () => {
      it('should SADD and SMEMBERS', async () => {
        await redis.sadd('set', 'a', 'b', 'c')
        const members = await redis.smembers('set')
        expect(members.sort()).toEqual(['a', 'b', 'c'])
      })

      it('should SREM', async () => {
        await redis.sadd('set', 'a', 'b', 'c')
        await redis.srem('set', 'b')
        const members = await redis.smembers('set')
        expect(members.sort()).toEqual(['a', 'c'])
      })

      it('should check SISMEMBER', async () => {
        await redis.sadd('set', 'a', 'b')
        expect(await redis.sismember('set', 'a')).toBe(1)
        expect(await redis.sismember('set', 'z')).toBe(0)
      })

      it('should get SCARD', async () => {
        await redis.sadd('set', 'a', 'b', 'c')
        expect(await redis.scard('set')).toBe(3)
      })

      it('should SPOP', async () => {
        await redis.sadd('set', 'a', 'b', 'c')
        const popped = await redis.spop('set')
        expect(['a', 'b', 'c']).toContain(popped)
        expect(await redis.scard('set')).toBe(2)
      })
    })

    describe('Sorted Set Commands', () => {
      it('should ZADD and ZRANGE', async () => {
        await redis.zadd('zset', 1, 'one', 2, 'two', 3, 'three')
        const result = await redis.zrange('zset', 0, -1)
        expect(result).toEqual(['one', 'two', 'three'])
      })

      it('should ZRANGE WITHSCORES', async () => {
        await redis.zadd('zset', 1, 'one', 2, 'two')
        const result = await redis.zrange('zset', 0, -1, 'WITHSCORES')
        expect(result).toEqual(['one', '1', 'two', '2'])
      })

      it('should ZSCORE', async () => {
        await redis.zadd('zset', 1.5, 'member')
        expect(await redis.zscore('zset', 'member')).toBe('1.5')
      })

      it('should ZCARD', async () => {
        await redis.zadd('zset', 1, 'one', 2, 'two', 3, 'three')
        expect(await redis.zcard('zset')).toBe(3)
      })

      it('should ZREM', async () => {
        await redis.zadd('zset', 1, 'one', 2, 'two', 3, 'three')
        await redis.zrem('zset', 'two')
        expect(await redis.zcard('zset')).toBe(2)
      })

      it('should ZRANGEBYSCORE', async () => {
        await redis.zadd('zset', 1, 'one', 2, 'two', 3, 'three', 4, 'four')
        const result = await redis.zrangebyscore('zset', 2, 3)
        expect(result).toEqual(['two', 'three'])
      })
    })

    describe('Pub/Sub Commands', () => {
      it('should PUBLISH', async () => {
        // First subscribe in engine directly to receive
        let received: string | null = null
        engine.subscribe('channel1', (msg) => {
          received = msg.message
        })

        const count = await redis.publish('channel1', 'hello')
        expect(count).toBe(1)
        expect(received).toBe('hello')
      })

      it('should get PUBSUB CHANNELS', async () => {
        engine.subscribe('test-channel', () => {})
        const channels = await redis.pubsub('CHANNELS', '*')
        expect(channels).toContain('test-channel')
      })
    })

    describe('Pipeline', () => {
      it('should execute pipeline', async () => {
        const pipeline = redis.pipeline()
        pipeline.set('p1', 'v1')
        pipeline.set('p2', 'v2')
        pipeline.get('p1')
        pipeline.get('p2')

        const results = await pipeline.exec()

        expect(results).not.toBeNull()
        expect(results?.[2][1]).toBe('v1')
        expect(results?.[3][1]).toBe('v2')
      })
    })
  })

  // =========================================================================
  // node-redis Tests
  // =========================================================================

  describe('node-redis', () => {
    let redis: ReturnType<typeof createClient>

    beforeEach(async () => {
      redis = createClient({
        socket: {
          port: TEST_PORT,
        },
      })
      await redis.connect()
    })

    afterEach(async () => {
      await redis.flushDb()
      await redis.quit()
    })

    describe('Connection', () => {
      it('should connect successfully', async () => {
        const pong = await redis.ping()
        expect(pong).toBe('PONG')
      })
    })

    describe('String Commands', () => {
      it('should SET and GET', async () => {
        await redis.set('key1', 'value1')
        const result = await redis.get('key1')
        expect(result).toBe('value1')
      })

      it('should SET with EX option', async () => {
        await redis.set('key1', 'value1', { EX: 60 })
        const ttl = await redis.ttl('key1')
        expect(ttl).toBeGreaterThan(0)
      })

      it('should MSET and MGET', async () => {
        await redis.mSet(['k1', 'v1', 'k2', 'v2'])
        const result = await redis.mGet(['k1', 'k2'])
        expect(result).toEqual(['v1', 'v2'])
      })

      it('should INCR', async () => {
        await redis.set('num', '5')
        expect(await redis.incr('num')).toBe(6)
      })
    })

    describe('Key Commands', () => {
      it('should DEL', async () => {
        await redis.set('key1', 'value1')
        const deleted = await redis.del('key1')
        expect(deleted).toBe(1)
      })

      it('should EXISTS', async () => {
        await redis.set('key1', 'value1')
        expect(await redis.exists('key1')).toBe(1)
        expect(await redis.exists('nonexistent')).toBe(0)
      })
    })

    describe('Hash Commands', () => {
      it('should HSET and HGET', async () => {
        await redis.hSet('hash', 'field', 'value')
        expect(await redis.hGet('hash', 'field')).toBe('value')
      })

      it('should HGETALL', async () => {
        await redis.hSet('hash', { name: 'Alice', age: '30' })
        const result = await redis.hGetAll('hash')
        expect(result).toEqual({ name: 'Alice', age: '30' })
      })
    })

    describe('List Commands', () => {
      it('should LPUSH and LRANGE', async () => {
        await redis.lPush('list', ['c', 'b', 'a'])
        const result = await redis.lRange('list', 0, -1)
        expect(result).toEqual(['a', 'b', 'c'])
      })

      it('should RPOP', async () => {
        await redis.rPush('list', ['a', 'b', 'c'])
        expect(await redis.rPop('list')).toBe('c')
      })
    })

    describe('Set Commands', () => {
      it('should SADD and SMEMBERS', async () => {
        await redis.sAdd('set', ['a', 'b', 'c'])
        const members = await redis.sMembers('set')
        expect(members.sort()).toEqual(['a', 'b', 'c'])
      })
    })

    describe('Sorted Set Commands', () => {
      it('should ZADD and ZRANGE', async () => {
        await redis.zAdd('zset', [
          { score: 1, value: 'one' },
          { score: 2, value: 'two' },
        ])
        const result = await redis.zRange('zset', 0, -1)
        expect(result).toEqual(['one', 'two'])
      })
    })
  })
})

// =========================================================================
// Real-world Usage Patterns
// =========================================================================

describe('Real-world Usage Patterns', () => {
  let engine: CacheEngine
  let server: RedisProtocolServer
  let redis: Redis

  beforeAll(async () => {
    engine = new CacheEngine({ maxMemoryMb: 64 })
    server = createRedisProtocolServer(engine, {
      port: TEST_PORT + 1,
      namespace: 'realworld',
    })
    await server.start()

    redis = new Redis({
      port: TEST_PORT + 1,
      lazyConnect: true,
    })
    await redis.connect()
  })

  afterAll(async () => {
    await redis.flushdb()
    redis.disconnect()
    server.stop()
    engine.stop()
  })

  it('should work as a session store', async () => {
    const sessionId = 'sess:abc123'
    const sessionData = JSON.stringify({
      userId: 123,
      email: 'user@example.com',
      roles: ['user', 'admin'],
    })

    // Store session with 30 minute expiry
    await redis.set(sessionId, sessionData, 'EX', 1800)

    // Retrieve session
    const retrieved = await redis.get(sessionId)
    assertNotNull(retrieved, 'Session data should exist')
    expect(JSON.parse(retrieved)).toEqual({
      userId: 123,
      email: 'user@example.com',
      roles: ['user', 'admin'],
    })

    // Extend session
    await redis.expire(sessionId, 3600)
    expect(await redis.ttl(sessionId)).toBeGreaterThan(1800)
  })

  it('should work as a rate limiter', async () => {
    const key = 'ratelimit:user:123'
    const limit = 100
    const window = 60

    // Increment counter
    const current = await redis.incr(key)

    // Set expiry on first request
    if (current === 1) {
      await redis.expire(key, window)
    }

    // Check if over limit
    expect(current).toBeLessThanOrEqual(limit)
  })

  it('should work as a leaderboard', async () => {
    const leaderboard = 'leaderboard:weekly'

    // Add scores
    await redis.zadd(leaderboard, 1500, 'player:1')
    await redis.zadd(leaderboard, 2000, 'player:2')
    await redis.zadd(leaderboard, 1800, 'player:3')
    await redis.zadd(leaderboard, 1200, 'player:4')
    await redis.zadd(leaderboard, 2500, 'player:5')

    // Get top 3
    const top3 = await redis.zrevrange(leaderboard, 0, 2, 'WITHSCORES')
    expect(top3[0]).toBe('player:5')
    expect(top3[1]).toBe('2500')
  })

  it('should work as a job queue', async () => {
    const queue = 'jobs:email'

    // Enqueue jobs
    await redis.rpush(
      queue,
      JSON.stringify({ type: 'welcome', to: 'user1@example.com' }),
    )
    await redis.rpush(
      queue,
      JSON.stringify({ type: 'verify', to: 'user2@example.com' }),
    )
    await redis.rpush(
      queue,
      JSON.stringify({ type: 'reset', to: 'user3@example.com' }),
    )

    // Process jobs (FIFO)
    const job1 = await redis.lpop(queue)
    assertNotNull(job1, 'Job should exist')
    expect(JSON.parse(job1).type).toBe('welcome')

    const job2 = await redis.lpop(queue)
    assertNotNull(job2, 'Job should exist')
    expect(JSON.parse(job2).type).toBe('verify')

    // Check remaining
    expect(await redis.llen(queue)).toBe(1)
  })

  it('should work as a user profile cache', async () => {
    const userKey = 'user:123'

    // Store user profile
    await redis.hmset(userKey, {
      name: 'Alice Smith',
      email: 'alice@example.com',
      avatar: 'https://example.com/alice.jpg',
      joinedAt: '2024-01-15',
    })

    // Set expiry
    await redis.expire(userKey, 3600)

    // Get specific fields
    const [name, email] = await redis.hmget(userKey, 'name', 'email')
    expect(name).toBe('Alice Smith')
    expect(email).toBe('alice@example.com')

    // Update single field
    await redis.hset(userKey, 'lastLogin', new Date().toISOString())
    expect(await redis.hget(userKey, 'lastLogin')).toBeTruthy()
  })

  it('should work for counting unique visitors', async () => {
    const today = 'visitors:2024-01-15'

    // Add visitor IPs
    await redis.sadd(today, '192.168.1.1', '10.0.0.1', '172.16.0.1')
    await redis.sadd(today, '192.168.1.1') // Duplicate

    // Count unique visitors
    expect(await redis.scard(today)).toBe(3)

    // Check if IP seen before
    expect(await redis.sismember(today, '192.168.1.1')).toBe(1)
    expect(await redis.sismember(today, '8.8.8.8')).toBe(0)
  })

  it('should work for caching API responses', async () => {
    const cacheKey = 'api:products:list'
    const products = [
      { id: 1, name: 'Product A', price: 99.99 },
      { id: 2, name: 'Product B', price: 149.99 },
    ]

    // Cache response with TTL
    await redis.set(cacheKey, JSON.stringify(products), 'EX', 300)

    // Check cache
    const cached = await redis.get(cacheKey)
    assertNotNull(cached, 'Cached data should exist')
    expect(JSON.parse(cached)).toEqual(products)

    // TTL should be set
    const ttl = await redis.ttl(cacheKey)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(300)
  })
})

// =========================================================================
// Upstash REST API Compatibility Tests
// =========================================================================

describe('Upstash REST API Compatibility', () => {
  let engine: CacheEngine
  let app: Elysia

  /**
   * Simple REST client mimicking @upstash/redis behavior
   */
  class UpstashStyleClient {
    constructor(private baseUrl: string) {}

    async command<T = string | number | null>(args: string[]): Promise<T> {
      const response = await fetch(`${this.baseUrl}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      })
      const data = (await response.json()) as { result: T }
      return data.result
    }

    async pipeline<T = Array<string | number | null>>(
      commands: string[][],
    ): Promise<T> {
      const response = await fetch(`${this.baseUrl}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
      })
      return response.json() as Promise<T>
    }

    // Convenience methods
    async get(key: string): Promise<string | null> {
      return this.command(['GET', key])
    }

    async set(
      key: string,
      value: string,
      opts?: { ex?: number },
    ): Promise<string | null> {
      const args = ['SET', key, value]
      if (opts?.ex) args.push('EX', opts.ex.toString())
      return this.command(args)
    }

    async del(...keys: string[]): Promise<number> {
      return this.command(['DEL', ...keys])
    }

    async incr(key: string): Promise<number> {
      return this.command(['INCR', key])
    }

    async hset(key: string, field: string, value: string): Promise<number> {
      return this.command(['HSET', key, field, value])
    }

    async hget(key: string, field: string): Promise<string | null> {
      return this.command(['HGET', key, field])
    }

    async hgetall(key: string): Promise<Record<string, string>> {
      return this.command(['HGETALL', key])
    }

    async lpush(key: string, ...values: string[]): Promise<number> {
      return this.command(['LPUSH', key, ...values])
    }

    async lrange(key: string, start: number, stop: number): Promise<string[]> {
      return this.command(['LRANGE', key, start.toString(), stop.toString()])
    }

    async sadd(key: string, ...members: string[]): Promise<number> {
      return this.command(['SADD', key, ...members])
    }

    async smembers(key: string): Promise<string[]> {
      return this.command(['SMEMBERS', key])
    }

    async zadd(
      key: string,
      ...scoreMemberPairs: (string | number)[]
    ): Promise<number> {
      return this.command(['ZADD', key, ...scoreMemberPairs.map(String)])
    }

    async zrange(key: string, start: number, stop: number): Promise<string[]> {
      return this.command(['ZRANGE', key, start.toString(), stop.toString()])
    }
  }

  let client: UpstashStyleClient

  beforeAll(async () => {
    engine = new CacheEngine({ maxMemoryMb: 64 })

    // Create a minimal Elysia app with the command endpoints
    app = new Elysia()
      .post('/command', async ({ body, query }) => {
        const ns = (query as { namespace?: string }).namespace ?? 'default'
        const args = body as string[]

        if (!Array.isArray(args) || args.length === 0) {
          throw new Error('Invalid command format')
        }

        const cmd = args[0].toUpperCase()
        const cmdArgs = args.slice(1)
        const result = executeCommand(engine, ns, cmd, cmdArgs)
        return { result }
      })
      .post('/pipeline', async ({ body, query }) => {
        const ns = (query as { namespace?: string }).namespace ?? 'default'
        const commands = body as string[][]

        return commands.map((args) => {
          const cmd = args[0].toUpperCase()
          const cmdArgs = args.slice(1)
          try {
            return { result: executeCommand(engine, ns, cmd, cmdArgs) }
          } catch (e) {
            return { error: e instanceof Error ? e.message : 'Unknown error' }
          }
        })
      })
      .listen(0) // Use random port

    const port = app.server?.port
    const host = getLocalhostHost()
    client = new UpstashStyleClient(`http://${host}:${port}`)
  })

  afterAll(async () => {
    await app.stop()
    engine.stop()
  })

  afterEach(async () => {
    await client.command(['FLUSHDB'])
  })

  describe('Basic Commands', () => {
    it('should SET and GET', async () => {
      await client.set('key1', 'value1')
      const result = await client.get('key1')
      expect(result).toBe('value1')
    })

    it('should return null for non-existent key', async () => {
      const result = await client.get('nonexistent')
      expect(result).toBeNull()
    })

    it('should SET with EX option', async () => {
      await client.set('key1', 'value1', { ex: 60 })
      const ttl = await client.command<number>(['TTL', 'key1'])
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(60)
    })

    it('should DEL keys', async () => {
      await client.set('k1', 'v1')
      await client.set('k2', 'v2')
      const deleted = await client.del('k1', 'k2')
      expect(deleted).toBe(2)
    })

    it('should INCR', async () => {
      await client.set('counter', '5')
      const result = await client.incr('counter')
      expect(result).toBe(6)
    })
  })

  describe('Hash Commands', () => {
    it('should HSET and HGET', async () => {
      await client.hset('user:1', 'name', 'Alice')
      const result = await client.hget('user:1', 'name')
      expect(result).toBe('Alice')
    })

    it('should HGETALL', async () => {
      await client.hset('user:1', 'name', 'Alice')
      await client.hset('user:1', 'age', '30')
      const result = await client.hgetall('user:1')
      expect(result).toEqual({ name: 'Alice', age: '30' })
    })
  })

  describe('List Commands', () => {
    it('should LPUSH and LRANGE', async () => {
      await client.lpush('list', 'c', 'b', 'a')
      const result = await client.lrange('list', 0, -1)
      expect(result).toEqual(['a', 'b', 'c'])
    })
  })

  describe('Set Commands', () => {
    it('should SADD and SMEMBERS', async () => {
      await client.sadd('set', 'a', 'b', 'c')
      const result = await client.smembers('set')
      expect(result.sort()).toEqual(['a', 'b', 'c'])
    })
  })

  describe('Sorted Set Commands', () => {
    it('should ZADD and ZRANGE', async () => {
      await client.zadd('zset', 1, 'one', 2, 'two', 3, 'three')
      const result = await client.zrange('zset', 0, -1)
      expect(result).toEqual(['one', 'two', 'three'])
    })
  })

  describe('Pipeline', () => {
    it('should execute pipeline commands', async () => {
      const results = await client.pipeline([
        ['SET', 'p1', 'v1'],
        ['SET', 'p2', 'v2'],
        ['GET', 'p1'],
        ['GET', 'p2'],
      ])

      expect(results).toHaveLength(4)
      expect((results as Array<{ result: string }>)[2].result).toBe('v1')
      expect((results as Array<{ result: string }>)[3].result).toBe('v2')
    })
  })
})

/**
 * Execute a Redis command on the engine (helper for Upstash tests)
 */
function executeCommand(
  engine: CacheEngine,
  ns: string,
  cmd: string,
  args: string[],
): string | number | null | string[] | Record<string, string> {
  switch (cmd) {
    case 'PING':
      return 'PONG'
    case 'GET':
      return engine.get(ns, args[0])
    case 'SET': {
      let ttl: number | undefined
      for (let i = 2; i < args.length; i++) {
        const opt = args[i].toUpperCase()
        if (opt === 'EX' && args[i + 1]) {
          ttl = parseInt(args[i + 1], 10)
          i++
        }
      }
      engine.set(ns, args[0], args[1], { ttl })
      return 'OK'
    }
    case 'DEL':
      return engine.del(ns, ...args)
    case 'INCR':
      return engine.incr(ns, args[0])
    case 'TTL':
      return engine.ttl(ns, args[0])
    case 'FLUSHDB':
      engine.flushdb(ns)
      return 'OK'
    case 'HSET':
      return engine.hset(ns, args[0], args[1], args[2])
    case 'HGET':
      return engine.hget(ns, args[0], args[1])
    case 'HGETALL':
      return engine.hgetall(ns, args[0])
    case 'LPUSH':
      return engine.lpush(ns, args[0], ...args.slice(1))
    case 'LRANGE':
      return engine.lrange(
        ns,
        args[0],
        parseInt(args[1], 10),
        parseInt(args[2], 10),
      )
    case 'SADD':
      return engine.sadd(ns, args[0], ...args.slice(1))
    case 'SMEMBERS':
      return engine.smembers(ns, args[0])
    case 'ZADD': {
      const members: Array<{ member: string; score: number }> = []
      for (let i = 1; i < args.length; i += 2) {
        members.push({ score: parseFloat(args[i]), member: args[i + 1] })
      }
      return engine.zadd(ns, args[0], ...members)
    }
    case 'ZRANGE':
      return engine.zrange(
        ns,
        args[0],
        parseInt(args[1], 10),
        parseInt(args[2], 10),
      ) as string[]
    default:
      throw new Error(`Unknown command: ${cmd}`)
  }
}
