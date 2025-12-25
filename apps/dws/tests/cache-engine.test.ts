/**
 * Cache Engine Unit Tests
 *
 * Tests for the DWS serverless cache engine:
 * - String operations (GET, SET, DEL, INCR, etc.)
 * - Hash operations (HGET, HSET, HGETALL, etc.)
 * - List operations (LPUSH, RPUSH, LPOP, LRANGE, etc.)
 * - Set operations (SADD, SREM, SMEMBERS, etc.)
 * - Sorted set operations (ZADD, ZRANGE, ZSCORE, etc.)
 * - TTL and expiration
 * - LRU eviction
 * - Namespace isolation
 * - Memory limits
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { CacheEngine } from '../api/cache/engine'
import { CacheError, CacheErrorCode, CacheEventType } from '../api/cache/types'

describe('CacheEngine', () => {
  let engine: CacheEngine

  beforeEach(() => {
    engine = new CacheEngine({
      maxMemoryMb: 10,
      defaultTtlSeconds: 3600,
      maxTtlSeconds: 86400,
    })
  })

  afterEach(() => {
    engine.stop()
  })

  // ===========================================================================
  // String Operations
  // ===========================================================================

  describe('String Operations', () => {
    test('SET and GET basic string', () => {
      engine.set('test', 'key1', 'value1')
      const result = engine.get('test', 'key1')
      expect(result).toBe('value1')
    })

    test('GET returns null for non-existent key', () => {
      const result = engine.get('test', 'nonexistent')
      expect(result).toBeNull()
    })

    test('SET with TTL', () => {
      engine.set('test', 'key1', 'value1', { ttl: 1 })
      expect(engine.get('test', 'key1')).toBe('value1')
    })

    test('SET with NX flag (not exists)', () => {
      engine.set('test', 'key1', 'value1')
      const result = engine.set('test', 'key1', 'value2', { nx: true })
      expect(result).toBe(false)
      expect(engine.get('test', 'key1')).toBe('value1')
    })

    test('SET with NX flag succeeds for new key', () => {
      const result = engine.set('test', 'newkey', 'value', { nx: true })
      expect(result).toBe(true)
      expect(engine.get('test', 'newkey')).toBe('value')
    })

    test('SET with XX flag (exists)', () => {
      const result = engine.set('test', 'nonexistent', 'value', { xx: true })
      expect(result).toBe(false)
    })

    test('SET with XX flag succeeds for existing key', () => {
      engine.set('test', 'key1', 'value1')
      const result = engine.set('test', 'key1', 'value2', { xx: true })
      expect(result).toBe(true)
      expect(engine.get('test', 'key1')).toBe('value2')
    })

    test('SETNX', () => {
      const result1 = engine.setnx('test', 'key1', 'value1')
      const result2 = engine.setnx('test', 'key1', 'value2')
      expect(result1).toBe(true)
      expect(result2).toBe(false)
      expect(engine.get('test', 'key1')).toBe('value1')
    })

    test('SETEX', () => {
      engine.setex('test', 'key1', 60, 'value1')
      expect(engine.get('test', 'key1')).toBe('value1')
      const ttl = engine.ttl('test', 'key1')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(60)
    })

    test('GETDEL', () => {
      engine.set('test', 'key1', 'value1')
      const result = engine.getdel('test', 'key1')
      expect(result).toBe('value1')
      expect(engine.get('test', 'key1')).toBeNull()
    })

    test('DEL single key', () => {
      engine.set('test', 'key1', 'value1')
      const count = engine.del('test', 'key1')
      expect(count).toBe(1)
      expect(engine.get('test', 'key1')).toBeNull()
    })

    test('DEL multiple keys', () => {
      engine.set('test', 'key1', 'value1')
      engine.set('test', 'key2', 'value2')
      engine.set('test', 'key3', 'value3')
      const count = engine.del('test', 'key1', 'key2', 'nonexistent')
      expect(count).toBe(2)
    })

    test('EXISTS', () => {
      engine.set('test', 'key1', 'value1')
      engine.set('test', 'key2', 'value2')
      const count = engine.exists('test', 'key1', 'key2', 'nonexistent')
      expect(count).toBe(2)
    })

    test('INCR', () => {
      const result1 = engine.incr('test', 'counter')
      expect(result1).toBe(1)

      const result2 = engine.incr('test', 'counter')
      expect(result2).toBe(2)

      const result3 = engine.incr('test', 'counter', 5)
      expect(result3).toBe(7)
    })

    test('DECR', () => {
      engine.set('test', 'counter', '10')
      const result = engine.decr('test', 'counter')
      expect(result).toBe(9)

      const result2 = engine.decr('test', 'counter', 4)
      expect(result2).toBe(5)
    })

    test('INCR on non-integer throws', () => {
      engine.set('test', 'key1', 'notanumber')
      expect(() => engine.incr('test', 'key1')).toThrow(CacheError)
    })

    test('APPEND', () => {
      engine.set('test', 'key1', 'Hello')
      const len = engine.append('test', 'key1', ' World')
      expect(len).toBe(11)
      expect(engine.get('test', 'key1')).toBe('Hello World')
    })

    test('APPEND to non-existent key', () => {
      const len = engine.append('test', 'newkey', 'value')
      expect(len).toBe(5)
      expect(engine.get('test', 'newkey')).toBe('value')
    })
  })

  // ===========================================================================
  // TTL Operations
  // ===========================================================================

  describe('TTL Operations', () => {
    test('TTL returns seconds remaining', () => {
      engine.set('test', 'key1', 'value1', { ttl: 60 })
      const ttl = engine.ttl('test', 'key1')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(60)
    })

    test('TTL returns -2 for non-existent key', () => {
      const ttl = engine.ttl('test', 'nonexistent')
      expect(ttl).toBe(-2)
    })

    test('PTTL returns milliseconds', () => {
      engine.set('test', 'key1', 'value1', { ttl: 60 })
      const pttl = engine.pttl('test', 'key1')
      expect(pttl).toBeGreaterThan(0)
      expect(pttl).toBeLessThanOrEqual(60000)
    })

    test('EXPIRE sets expiration', () => {
      engine.set('test', 'key1', 'value1')
      const result = engine.expire('test', 'key1', 30)
      expect(result).toBe(true)

      const ttl = engine.ttl('test', 'key1')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(30)
    })

    test('EXPIREAT sets timestamp', () => {
      engine.set('test', 'key1', 'value1')
      const futureTimestamp = Math.floor(Date.now() / 1000) + 60
      const result = engine.expireat('test', 'key1', futureTimestamp)
      expect(result).toBe(true)
    })

    test('PERSIST removes expiration', () => {
      engine.set('test', 'key1', 'value1', { ttl: 60 })
      const result = engine.persist('test', 'key1')
      expect(result).toBe(true)

      const ttl = engine.ttl('test', 'key1')
      expect(ttl).toBe(-1) // No expiration
    })
  })

  // ===========================================================================
  // Hash Operations
  // ===========================================================================

  describe('Hash Operations', () => {
    test('HSET and HGET', () => {
      engine.hset('test', 'hash1', 'field1', 'value1')
      const result = engine.hget('test', 'hash1', 'field1')
      expect(result).toBe('value1')
    })

    test('HGET returns null for non-existent field', () => {
      engine.hset('test', 'hash1', 'field1', 'value1')
      const result = engine.hget('test', 'hash1', 'nonexistent')
      expect(result).toBeNull()
    })

    test('HSET returns 1 for new field, 0 for existing', () => {
      const result1 = engine.hset('test', 'hash1', 'field1', 'value1')
      const result2 = engine.hset('test', 'hash1', 'field1', 'value2')
      expect(result1).toBe(1)
      expect(result2).toBe(0)
    })

    test('HMSET', () => {
      engine.hmset('test', 'hash1', {
        field1: 'value1',
        field2: 'value2',
        field3: 'value3',
      })
      expect(engine.hget('test', 'hash1', 'field1')).toBe('value1')
      expect(engine.hget('test', 'hash1', 'field2')).toBe('value2')
      expect(engine.hget('test', 'hash1', 'field3')).toBe('value3')
    })

    test('HMGET', () => {
      engine.hmset('test', 'hash1', {
        field1: 'value1',
        field2: 'value2',
      })
      const results = engine.hmget('test', 'hash1', 'field1', 'field2', 'nonexistent')
      expect(results).toEqual(['value1', 'value2', null])
    })

    test('HGETALL', () => {
      engine.hmset('test', 'hash1', {
        field1: 'value1',
        field2: 'value2',
      })
      const result = engine.hgetall('test', 'hash1')
      expect(result).toEqual({ field1: 'value1', field2: 'value2' })
    })

    test('HDEL', () => {
      engine.hmset('test', 'hash1', {
        field1: 'value1',
        field2: 'value2',
        field3: 'value3',
      })
      const count = engine.hdel('test', 'hash1', 'field1', 'field2', 'nonexistent')
      expect(count).toBe(2)
      expect(engine.hget('test', 'hash1', 'field3')).toBe('value3')
    })

    test('HEXISTS', () => {
      engine.hset('test', 'hash1', 'field1', 'value1')
      expect(engine.hexists('test', 'hash1', 'field1')).toBe(true)
      expect(engine.hexists('test', 'hash1', 'nonexistent')).toBe(false)
    })

    test('HLEN', () => {
      engine.hmset('test', 'hash1', {
        field1: 'value1',
        field2: 'value2',
        field3: 'value3',
      })
      expect(engine.hlen('test', 'hash1')).toBe(3)
    })

    test('HKEYS', () => {
      engine.hmset('test', 'hash1', {
        field1: 'value1',
        field2: 'value2',
      })
      const keys = engine.hkeys('test', 'hash1')
      expect(keys.sort()).toEqual(['field1', 'field2'])
    })

    test('HVALS', () => {
      engine.hmset('test', 'hash1', {
        field1: 'value1',
        field2: 'value2',
      })
      const vals = engine.hvals('test', 'hash1')
      expect(vals.sort()).toEqual(['value1', 'value2'])
    })

    test('HINCRBY', () => {
      engine.hset('test', 'hash1', 'counter', '10')
      const result = engine.hincrby('test', 'hash1', 'counter', 5)
      expect(result).toBe(15)
    })
  })

  // ===========================================================================
  // List Operations
  // ===========================================================================

  describe('List Operations', () => {
    test('LPUSH and LRANGE', () => {
      engine.lpush('test', 'list1', 'a', 'b', 'c')
      const result = engine.lrange('test', 'list1', 0, -1)
      expect(result).toEqual(['c', 'b', 'a'])
    })

    test('RPUSH', () => {
      engine.rpush('test', 'list1', 'a', 'b', 'c')
      const result = engine.lrange('test', 'list1', 0, -1)
      expect(result).toEqual(['a', 'b', 'c'])
    })

    test('LPOP', () => {
      engine.rpush('test', 'list1', 'a', 'b', 'c')
      const result = engine.lpop('test', 'list1')
      expect(result).toBe('a')
      expect(engine.lrange('test', 'list1', 0, -1)).toEqual(['b', 'c'])
    })

    test('RPOP', () => {
      engine.rpush('test', 'list1', 'a', 'b', 'c')
      const result = engine.rpop('test', 'list1')
      expect(result).toBe('c')
      expect(engine.lrange('test', 'list1', 0, -1)).toEqual(['a', 'b'])
    })

    test('LLEN', () => {
      engine.rpush('test', 'list1', 'a', 'b', 'c')
      expect(engine.llen('test', 'list1')).toBe(3)
    })

    test('LINDEX', () => {
      engine.rpush('test', 'list1', 'a', 'b', 'c')
      expect(engine.lindex('test', 'list1', 0)).toBe('a')
      expect(engine.lindex('test', 'list1', -1)).toBe('c')
      expect(engine.lindex('test', 'list1', 10)).toBeNull()
    })

    test('LSET', () => {
      engine.rpush('test', 'list1', 'a', 'b', 'c')
      const result = engine.lset('test', 'list1', 1, 'B')
      expect(result).toBe(true)
      expect(engine.lindex('test', 'list1', 1)).toBe('B')
    })

    test('LTRIM', () => {
      engine.rpush('test', 'list1', 'a', 'b', 'c', 'd', 'e')
      engine.ltrim('test', 'list1', 1, 3)
      expect(engine.lrange('test', 'list1', 0, -1)).toEqual(['b', 'c', 'd'])
    })

    test('LRANGE with negative indices', () => {
      engine.rpush('test', 'list1', 'a', 'b', 'c', 'd', 'e')
      expect(engine.lrange('test', 'list1', -3, -1)).toEqual(['c', 'd', 'e'])
    })
  })

  // ===========================================================================
  // Set Operations
  // ===========================================================================

  describe('Set Operations', () => {
    test('SADD and SMEMBERS', () => {
      const added = engine.sadd('test', 'set1', 'a', 'b', 'c')
      expect(added).toBe(3)

      const members = engine.smembers('test', 'set1')
      expect(members.sort()).toEqual(['a', 'b', 'c'])
    })

    test('SADD ignores duplicates', () => {
      engine.sadd('test', 'set1', 'a', 'b')
      const added = engine.sadd('test', 'set1', 'b', 'c')
      expect(added).toBe(1) // Only 'c' was new
    })

    test('SREM', () => {
      engine.sadd('test', 'set1', 'a', 'b', 'c')
      const removed = engine.srem('test', 'set1', 'a', 'b', 'nonexistent')
      expect(removed).toBe(2)
      expect(engine.smembers('test', 'set1')).toEqual(['c'])
    })

    test('SISMEMBER', () => {
      engine.sadd('test', 'set1', 'a', 'b', 'c')
      expect(engine.sismember('test', 'set1', 'a')).toBe(true)
      expect(engine.sismember('test', 'set1', 'x')).toBe(false)
    })

    test('SCARD', () => {
      engine.sadd('test', 'set1', 'a', 'b', 'c')
      expect(engine.scard('test', 'set1')).toBe(3)
    })

    test('SPOP', () => {
      engine.sadd('test', 'set1', 'a')
      const popped = engine.spop('test', 'set1')
      expect(popped).toBe('a')
      expect(engine.scard('test', 'set1')).toBe(0)
    })

    test('SRANDMEMBER', () => {
      engine.sadd('test', 'set1', 'a', 'b', 'c')
      const member = engine.srandmember('test', 'set1')
      expect(['a', 'b', 'c']).toContain(member)
      expect(engine.scard('test', 'set1')).toBe(3) // Not removed
    })
  })

  // ===========================================================================
  // Sorted Set Operations
  // ===========================================================================

  describe('Sorted Set Operations', () => {
    test('ZADD and ZRANGE', () => {
      engine.zadd('test', 'zset1',
        { member: 'a', score: 1 },
        { member: 'b', score: 2 },
        { member: 'c', score: 3 },
      )
      const result = engine.zrange('test', 'zset1', 0, -1)
      expect(result).toEqual(['a', 'b', 'c'])
    })

    test('ZRANGE with scores', () => {
      engine.zadd('test', 'zset1',
        { member: 'a', score: 1 },
        { member: 'b', score: 2 },
      )
      const result = engine.zrange('test', 'zset1', 0, -1, true)
      expect(result).toEqual([
        { member: 'a', score: 1 },
        { member: 'b', score: 2 },
      ])
    })

    test('ZADD updates existing scores', () => {
      engine.zadd('test', 'zset1', { member: 'a', score: 1 })
      engine.zadd('test', 'zset1', { member: 'a', score: 5 })

      const score = engine.zscore('test', 'zset1', 'a')
      expect(score).toBe(5)
    })

    test('ZRANGEBYSCORE', () => {
      engine.zadd('test', 'zset1',
        { member: 'a', score: 1 },
        { member: 'b', score: 2 },
        { member: 'c', score: 3 },
        { member: 'd', score: 4 },
      )
      const result = engine.zrangebyscore('test', 'zset1', 2, 3)
      expect(result).toEqual(['b', 'c'])
    })

    test('ZSCORE', () => {
      engine.zadd('test', 'zset1', { member: 'a', score: 42 })
      expect(engine.zscore('test', 'zset1', 'a')).toBe(42)
      expect(engine.zscore('test', 'zset1', 'nonexistent')).toBeNull()
    })

    test('ZCARD', () => {
      engine.zadd('test', 'zset1',
        { member: 'a', score: 1 },
        { member: 'b', score: 2 },
      )
      expect(engine.zcard('test', 'zset1')).toBe(2)
    })

    test('ZREM', () => {
      engine.zadd('test', 'zset1',
        { member: 'a', score: 1 },
        { member: 'b', score: 2 },
        { member: 'c', score: 3 },
      )
      const removed = engine.zrem('test', 'zset1', 'a', 'b')
      expect(removed).toBe(2)
      expect(engine.zrange('test', 'zset1', 0, -1)).toEqual(['c'])
    })
  })

  // ===========================================================================
  // Key Operations
  // ===========================================================================

  describe('Key Operations', () => {
    test('KEYS with wildcard', () => {
      engine.set('test', 'user:1', 'a')
      engine.set('test', 'user:2', 'b')
      engine.set('test', 'product:1', 'c')

      const userKeys = engine.keys('test', 'user:*')
      expect(userKeys.sort()).toEqual(['user:1', 'user:2'])

      const allKeys = engine.keys('test', '*')
      expect(allKeys.length).toBe(3)
    })

    test('SCAN', () => {
      for (let i = 0; i < 25; i++) {
        engine.set('test', `key${i}`, `value${i}`)
      }

      const result1 = engine.scan('test', { count: 10 })
      expect(result1.keys.length).toBe(10)
      expect(result1.done).toBe(false)

      const result2 = engine.scan('test', { cursor: result1.cursor, count: 10 })
      expect(result2.keys.length).toBe(10)
    })

    test('TYPE', () => {
      engine.set('test', 'string1', 'value')
      engine.hset('test', 'hash1', 'field', 'value')
      engine.lpush('test', 'list1', 'value')
      engine.sadd('test', 'set1', 'value')
      engine.zadd('test', 'zset1', { member: 'value', score: 1 })

      expect(engine.type('test', 'string1')).toBe('string')
      expect(engine.type('test', 'hash1')).toBe('hash')
      expect(engine.type('test', 'list1')).toBe('list')
      expect(engine.type('test', 'set1')).toBe('set')
      expect(engine.type('test', 'zset1')).toBe('zset')
      expect(engine.type('test', 'nonexistent')).toBe('none')
    })

    test('RENAME', () => {
      engine.set('test', 'oldkey', 'value')
      const result = engine.rename('test', 'oldkey', 'newkey')
      expect(result).toBe(true)
      expect(engine.get('test', 'oldkey')).toBeNull()
      expect(engine.get('test', 'newkey')).toBe('value')
    })

    test('FLUSHDB', () => {
      engine.set('test', 'key1', 'value1')
      engine.set('test', 'key2', 'value2')
      engine.set('other', 'key1', 'value1')

      engine.flushdb('test')

      expect(engine.keys('test', '*').length).toBe(0)
      expect(engine.keys('other', '*').length).toBe(1)
    })

    test('FLUSHALL', () => {
      engine.set('ns1', 'key1', 'value1')
      engine.set('ns2', 'key1', 'value1')

      engine.flushall()

      expect(engine.keys('ns1', '*').length).toBe(0)
      expect(engine.keys('ns2', '*').length).toBe(0)
    })
  })

  // ===========================================================================
  // Namespace Isolation
  // ===========================================================================

  describe('Namespace Isolation', () => {
    test('Keys are isolated by namespace', () => {
      engine.set('ns1', 'key1', 'value1')
      engine.set('ns2', 'key1', 'value2')

      expect(engine.get('ns1', 'key1')).toBe('value1')
      expect(engine.get('ns2', 'key1')).toBe('value2')
    })

    test('Operations affect only their namespace', () => {
      engine.set('ns1', 'key1', 'value1')
      engine.set('ns2', 'key1', 'value2')

      engine.del('ns1', 'key1')

      expect(engine.get('ns1', 'key1')).toBeNull()
      expect(engine.get('ns2', 'key1')).toBe('value2')
    })

    test('Namespace stats are tracked separately', () => {
      engine.set('ns1', 'key1', 'value1')
      engine.get('ns1', 'key1') // Hit
      engine.get('ns1', 'nonexistent') // Miss

      engine.set('ns2', 'key1', 'value1')
      engine.get('ns2', 'key1') // Hit

      const stats1 = engine.getNamespaceStats('ns1')
      const stats2 = engine.getNamespaceStats('ns2')

      expect(stats1?.hits).toBe(1)
      expect(stats1?.misses).toBe(1)
      expect(stats2?.hits).toBe(1)
      expect(stats2?.misses).toBe(0)
    })
  })

  // ===========================================================================
  // Statistics
  // ===========================================================================

  describe('Statistics', () => {
    test('getStats returns global statistics', () => {
      engine.set('test', 'key1', 'value1')
      engine.get('test', 'key1') // Hit
      engine.get('test', 'nonexistent') // Miss

      const stats = engine.getStats()

      expect(stats.totalKeys).toBe(1)
      expect(stats.hits).toBeGreaterThan(0)
      expect(stats.misses).toBeGreaterThan(0)
      expect(stats.hitRate).toBeGreaterThan(0)
      expect(stats.hitRate).toBeLessThan(1)
      expect(stats.namespaces).toBe(1)
    })

    test('getAllNamespaceStats returns all namespaces', () => {
      engine.set('ns1', 'key1', 'value1')
      engine.set('ns2', 'key1', 'value1')

      const allStats = engine.getAllNamespaceStats()

      expect(allStats.length).toBe(2)
      expect(allStats.map((s) => s.namespace).sort()).toEqual(['ns1', 'ns2'])
    })
  })

  // ===========================================================================
  // Events
  // ===========================================================================

  describe('Events', () => {
    test('Emits KEY_SET event', () => {
      const events: { type: string; key: string }[] = []
      engine.on((event) => {
        events.push({ type: event.type, key: event.key ?? '' })
      })

      engine.set('test', 'key1', 'value1')

      expect(events.length).toBe(1)
      expect(events[0].type).toBe(CacheEventType.KEY_SET)
      expect(events[0].key).toBe('key1')
    })

    test('Emits KEY_DELETE event', () => {
      const events: { type: string; key: string }[] = []
      engine.set('test', 'key1', 'value1')

      engine.on((event) => {
        events.push({ type: event.type, key: event.key ?? '' })
      })

      engine.del('test', 'key1')

      expect(events.length).toBe(1)
      expect(events[0].type).toBe(CacheEventType.KEY_DELETE)
    })

    test('Unsubscribe works', () => {
      const events: string[] = []
      const unsubscribe = engine.on((event) => {
        events.push(event.type)
      })

      engine.set('test', 'key1', 'value1')
      expect(events.length).toBe(1)

      unsubscribe()

      engine.set('test', 'key2', 'value2')
      expect(events.length).toBe(1) // No new events
    })
  })

  // ===========================================================================
  // Memory Limits and LRU Eviction
  // ===========================================================================

  describe('Memory Limits and LRU Eviction', () => {
    test('Evicts LRU entries when memory limit exceeded', () => {
      // Create a small engine
      const smallEngine = new CacheEngine({
        maxMemoryMb: 0.001, // 1KB
        defaultTtlSeconds: 3600,
      })

      // Fill it up
      for (let i = 0; i < 100; i++) {
        smallEngine.set('test', `key${i}`, 'x'.repeat(100))
      }

      const stats = smallEngine.getStats()
      expect(stats.evictions).toBeGreaterThan(0)
      expect(stats.usedMemoryBytes).toBeLessThanOrEqual(1024)

      smallEngine.stop()
    })

    test('LRU evicts least recently used', () => {
      const smallEngine = new CacheEngine({
        maxMemoryMb: 0.0005, // 500 bytes
        defaultTtlSeconds: 3600,
      })

      // Set 3 keys
      smallEngine.set('test', 'key1', 'x'.repeat(150))
      smallEngine.set('test', 'key2', 'x'.repeat(150))
      smallEngine.set('test', 'key3', 'x'.repeat(150))

      // Access key1 to make it recently used
      smallEngine.get('test', 'key1')

      // Add another key, should evict key2 (least recently used)
      smallEngine.set('test', 'key4', 'x'.repeat(150))

      // key1 should still exist (was accessed), key2 might be evicted
      expect(smallEngine.get('test', 'key1')).not.toBeNull()

      smallEngine.stop()
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    test('SET with TTL exceeding max throws', () => {
      expect(() => {
        engine.set('test', 'key1', 'value1', { ttl: 999999999 })
      }).toThrow(CacheError)
    })

    test('HSET on non-hash key throws', () => {
      engine.set('test', 'string1', 'value')
      expect(() => {
        engine.hset('test', 'string1', 'field', 'value')
      }).toThrow(CacheError)
    })

    test('LPUSH on non-list key throws', () => {
      engine.set('test', 'string1', 'value')
      expect(() => {
        engine.lpush('test', 'string1', 'value')
      }).toThrow(CacheError)
    })

    test('CacheError has correct code', () => {
      engine.set('test', 'string1', 'value')
      try {
        engine.hset('test', 'string1', 'field', 'value')
      } catch (e) {
        expect(e).toBeInstanceOf(CacheError)
        expect((e as CacheError).code).toBe(CacheErrorCode.INVALID_OPERATION)
      }
    })
  })

  // ===========================================================================
  // Stream Operations
  // ===========================================================================

  describe('Stream Operations', () => {
    test('XADD and XLEN', () => {
      const id1 = engine.xadd('test', 'stream1', { field1: 'value1' })
      const id2 = engine.xadd('test', 'stream1', { field2: 'value2' })

      expect(id1).toBeTruthy()
      expect(id2).toBeTruthy()
      expect(engine.xlen('test', 'stream1')).toBe(2)
    })

    test('XRANGE', () => {
      engine.xadd('test', 'stream1', { f: '1' })
      engine.xadd('test', 'stream1', { f: '2' })
      engine.xadd('test', 'stream1', { f: '3' })

      const entries = engine.xrange('test', 'stream1', '-', '+')
      expect(entries.length).toBe(3)
      expect(entries[0].fields.f).toBe('1')
      expect(entries[2].fields.f).toBe('3')
    })

    test('XRANGE with count', () => {
      for (let i = 0; i < 10; i++) {
        engine.xadd('test', 'stream1', { num: i.toString() })
      }

      const entries = engine.xrange('test', 'stream1', '-', '+', 3)
      expect(entries.length).toBe(3)
    })
  })
})
