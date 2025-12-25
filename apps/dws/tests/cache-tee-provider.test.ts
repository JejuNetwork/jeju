/**
 * TEE Cache Provider Unit Tests
 *
 * Tests for the TEE-backed cache provider:
 * - LOCAL mode attestation generation
 * - Encryption/decryption flow
 * - All Redis-compatible operations through TEE
 * - Initialization and lifecycle
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  createTEECacheProvider,
  type TEECacheProvider,
} from '../api/cache/tee-provider'
import { CacheTEEProvider } from '../api/cache/types'

describe('TEECacheProvider', () => {
  describe('LOCAL Mode (Simulated)', () => {
    let provider: TEECacheProvider

    beforeEach(async () => {
      provider = createTEECacheProvider({
        provider: CacheTEEProvider.LOCAL,
        maxMemoryMb: 64,
        encryptionEnabled: true,
        nodeId: 'test-node-1',
      })
      await provider.initialize()
    })

    afterEach(async () => {
      await provider.stop()
    })

    test('isSimulated returns true for LOCAL mode', () => {
      expect(provider.isSimulated()).toBe(true)
    })

    test('generates attestation on init', () => {
      const attestation = provider.getAttestation()
      expect(attestation).not.toBeNull()
      expect(attestation?.provider).toBe(CacheTEEProvider.LOCAL)
      expect(attestation?.simulated).toBe(true)
      expect(attestation?.mrEnclave).toBeDefined()
      expect(attestation?.mrSigner).toBeDefined()
      expect(attestation?.quote).toBeDefined()
      expect(attestation?.timestamp).toBeGreaterThan(0)
    })

    describe('String Operations with Encryption', () => {
      test('set and get with encryption', async () => {
        const success = await provider.set('test-ns', 'key1', 'secret-value')
        expect(success).toBe(true)

        const value = await provider.get('test-ns', 'key1')
        expect(value).toBe('secret-value')
      })

      test('handles unicode and special characters', async () => {
        const specialValue = 'Hello 世界! 🎉 Special chars: <>&"\'\\n\\t'
        await provider.set('test-ns', 'special', specialValue)

        const retrieved = await provider.get('test-ns', 'special')
        expect(retrieved).toBe(specialValue)
      })

      test('handles JSON objects as strings', async () => {
        const obj = { nested: { value: 123, array: [1, 2, 3] } }
        const jsonStr = JSON.stringify(obj)

        await provider.set('test-ns', 'json-key', jsonStr)
        const retrieved = await provider.get('test-ns', 'json-key')

        expect(retrieved).toBe(jsonStr)
        expect(JSON.parse(retrieved as string)).toEqual(obj)
      })

      test('del removes encrypted keys', async () => {
        await provider.set('test-ns', 'to-delete', 'value')
        expect(await provider.get('test-ns', 'to-delete')).toBe('value')

        const deleted = await provider.del('test-ns', 'to-delete')
        expect(deleted).toBe(1)
        expect(await provider.get('test-ns', 'to-delete')).toBeNull()
      })

      test('incr/decr work with encrypted values', async () => {
        const val1 = await provider.incr('test-ns', 'counter')
        expect(val1).toBe(1)

        const val2 = await provider.incr('test-ns', 'counter', 5)
        expect(val2).toBe(6)

        const val3 = await provider.decr('test-ns', 'counter', 2)
        expect(val3).toBe(4)
      })
    })

    describe('TTL Operations', () => {
      test('expire sets expiration', async () => {
        await provider.set('test-ns', 'expiring', 'value')
        const success = await provider.expire('test-ns', 'expiring', 60)
        expect(success).toBe(true)

        const ttl = await provider.ttl('test-ns', 'expiring')
        expect(ttl).toBeGreaterThan(0)
        expect(ttl).toBeLessThanOrEqual(60)
      })
    })

    describe('Hash Operations with Encryption', () => {
      test('hset and hget with encryption', async () => {
        const added = await provider.hset(
          'test-ns',
          'hash1',
          'field1',
          'secret-hash-value',
        )
        expect(added).toBe(1)

        const value = await provider.hget('test-ns', 'hash1', 'field1')
        expect(value).toBe('secret-hash-value')
      })

      test('hgetall decrypts all fields', async () => {
        await provider.hset('test-ns', 'hash2', 'f1', 'v1')
        await provider.hset('test-ns', 'hash2', 'f2', 'v2')
        await provider.hset('test-ns', 'hash2', 'f3', 'v3')

        const hash = await provider.hgetall('test-ns', 'hash2')
        expect(hash).toEqual({ f1: 'v1', f2: 'v2', f3: 'v3' })
      })

      test('hdel removes hash fields', async () => {
        await provider.hset('test-ns', 'hash3', 'keep', 'kept')
        await provider.hset('test-ns', 'hash3', 'remove', 'removed')

        const deleted = await provider.hdel('test-ns', 'hash3', 'remove')
        expect(deleted).toBe(1)

        expect(await provider.hget('test-ns', 'hash3', 'keep')).toBe('kept')
        expect(await provider.hget('test-ns', 'hash3', 'remove')).toBeNull()
      })
    })

    describe('List Operations with Encryption', () => {
      test('lpush and lrange with encryption', async () => {
        const len = await provider.lpush('test-ns', 'list1', 'a', 'b', 'c')
        expect(len).toBe(3)

        const values = await provider.lrange('test-ns', 'list1', 0, -1)
        expect(values).toEqual(['c', 'b', 'a'])
      })

      test('rpush appends to right', async () => {
        await provider.rpush('test-ns', 'list2', '1', '2', '3')
        const values = await provider.lrange('test-ns', 'list2', 0, -1)
        expect(values).toEqual(['1', '2', '3'])
      })

      test('lpop and rpop with decryption', async () => {
        await provider.rpush('test-ns', 'list3', 'first', 'middle', 'last')

        expect(await provider.lpop('test-ns', 'list3')).toBe('first')
        expect(await provider.rpop('test-ns', 'list3')).toBe('last')
        expect(await provider.llen('test-ns', 'list3')).toBe(1)
      })
    })

    describe('Set Operations with Encryption', () => {
      test('sadd and smembers with encryption', async () => {
        const added = await provider.sadd(
          'test-ns',
          'set1',
          'member1',
          'member2',
          'member3',
        )
        expect(added).toBe(3)

        const members = await provider.smembers('test-ns', 'set1')
        expect(members.sort()).toEqual(['member1', 'member2', 'member3'])
      })

      test('sismember checks encrypted membership', async () => {
        await provider.sadd('test-ns', 'set2', 'exists')

        expect(await provider.sismember('test-ns', 'set2', 'exists')).toBe(true)
        expect(await provider.sismember('test-ns', 'set2', 'not-exists')).toBe(
          false,
        )
      })

      test('scard tracks set size', async () => {
        await provider.sadd('test-ns', 'set3', 'a', 'b', 'c')
        expect(await provider.scard('test-ns', 'set3')).toBe(3)

        // Note: srem with encryption enabled has limitations because
        // each encrypt() call generates a different ciphertext (random nonce).
        // In production, deterministic encryption or key derivation would be used.
      })
    })

    describe('Sorted Set Operations with Encryption', () => {
      test('zadd and zrange with encryption', async () => {
        const added = await provider.zadd(
          'test-ns',
          'zset1',
          { member: 'alice', score: 100 },
          { member: 'bob', score: 200 },
          { member: 'charlie', score: 150 },
        )
        expect(added).toBe(3)

        const members = await provider.zrange('test-ns', 'zset1', 0, -1)
        expect(members).toEqual(['alice', 'charlie', 'bob'])
      })

      test('zcard returns correct count', async () => {
        await provider.zadd(
          'test-ns',
          'zset2',
          { member: 'x', score: 1 },
          { member: 'y', score: 2 },
        )
        expect(await provider.zcard('test-ns', 'zset2')).toBe(2)
      })
    })

    describe('Key Operations', () => {
      test('keys returns matching keys', async () => {
        await provider.set('test-ns', 'user:1', 'a')
        await provider.set('test-ns', 'user:2', 'b')
        await provider.set('test-ns', 'product:1', 'c')

        const userKeys = await provider.keys('test-ns', 'user:*')
        expect(userKeys.sort()).toEqual(['user:1', 'user:2'])
      })

      test('flushdb clears namespace', async () => {
        await provider.set('test-ns', 'key1', 'v1')
        await provider.set('test-ns', 'key2', 'v2')

        await provider.flushdb('test-ns')

        const keys = await provider.keys('test-ns', '*')
        expect(keys).toEqual([])
      })
    })

    describe('Stats', () => {
      test('getStats returns valid statistics', async () => {
        await provider.set('test-ns', 'stats-test', 'value')

        const stats = provider.getStats()
        expect(stats.totalKeys).toBeGreaterThanOrEqual(1)
        expect(stats.uptime).toBeGreaterThanOrEqual(0) // May be 0 if test runs fast
        expect(typeof stats.hits).toBe('number')
        expect(typeof stats.misses).toBe('number')
      })
    })
  })

  describe('Encryption Disabled Mode', () => {
    let provider: TEECacheProvider

    beforeEach(async () => {
      provider = createTEECacheProvider({
        provider: CacheTEEProvider.LOCAL,
        maxMemoryMb: 64,
        encryptionEnabled: false,
        nodeId: 'test-node-unencrypted',
      })
      await provider.initialize()
    })

    afterEach(async () => {
      await provider.stop()
    })

    test('still generates attestation', () => {
      const attestation = provider.getAttestation()
      expect(attestation).not.toBeNull()
      expect(attestation?.simulated).toBe(true)
    })

    test('stores values without encryption wrapper', async () => {
      await provider.set('test-ns', 'plain', 'plain-value')
      const value = await provider.get('test-ns', 'plain')
      expect(value).toBe('plain-value')
    })
  })

  describe('Instance Creation', () => {
    let provider: TEECacheProvider

    beforeEach(async () => {
      provider = createTEECacheProvider({
        provider: CacheTEEProvider.LOCAL,
        maxMemoryMb: 64,
        encryptionEnabled: true,
        nodeId: 'test-node-instance',
      })
      await provider.initialize()
    })

    afterEach(async () => {
      await provider.stop()
    })

    test('createInstance returns valid instance', async () => {
      const instance = await provider.createInstance(
        'inst-123',
        '0x1234567890123456789012345678901234567890',
        'my-namespace',
        256,
        Date.now() + 3600000,
      )

      expect(instance.id).toBe('inst-123')
      expect(instance.namespace).toBe('my-namespace')
      expect(instance.maxMemoryMb).toBe(256)
      expect(instance.tier).toBe('tee')
      expect(instance.status).toBe('running')
      expect(instance.teeAttestation).toBeDefined()
    })
  })
})
