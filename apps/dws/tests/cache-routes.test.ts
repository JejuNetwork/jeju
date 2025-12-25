/**
 * Cache Routes Integration Tests
 *
 * Tests for the DWS cache HTTP API:
 * - String operations via HTTP
 * - Hash operations via HTTP
 * - List operations via HTTP
 * - Set operations via HTTP
 * - Sorted set operations via HTTP
 * - Batch operations (MGET, MSET)
 * - Plan management
 * - Statistics endpoints
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import {
  createCacheRoutes,
  initializeCacheProvisioning,
  resetCacheProvisioning,
} from '../api/cache'

describe('Cache API Routes', () => {
  let app: Elysia

  beforeAll(async () => {
    await initializeCacheProvisioning()
    app = new Elysia().use(createCacheRoutes())
  })

  afterAll(() => {
    resetCacheProvisioning()
  })

  async function request(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    return app.handle(
      new Request(`http://localhost${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      }),
    )
  }

  // ===========================================================================
  // Health and Stats
  // ===========================================================================

  describe('Health and Stats', () => {
    test('GET /cache/health returns healthy status', async () => {
      const res = await request('/cache/health')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.status).toBe('healthy')
      expect(data.timestamp).toBeGreaterThan(0)
    })

    test('GET /cache/stats returns statistics', async () => {
      const res = await request('/cache/stats')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.global).toBeDefined()
      expect(data.shared).toBeDefined()
      expect(typeof data.shared.totalKeys).toBe('number')
    })
  })

  // ===========================================================================
  // String Operations
  // ===========================================================================

  describe('String Operations', () => {
    test('POST /cache/set and GET /cache/get', async () => {
      const setRes = await request('/cache/set', {
        method: 'POST',
        body: JSON.stringify({
          key: 'test-key-1',
          value: 'test-value-1',
          ttl: 300,
        }),
      })
      expect(setRes.status).toBe(200)
      const setData = await setRes.json()
      expect(setData.success).toBe(true)

      const getRes = await request('/cache/get?key=test-key-1')
      expect(getRes.status).toBe(200)
      const getData = await getRes.json()
      expect(getData.value).toBe('test-value-1')
      expect(getData.found).toBe(true)
    })

    test('GET /cache/get returns null for non-existent key', async () => {
      const res = await request('/cache/get?key=nonexistent-xyz')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.value).toBeNull()
      expect(data.found).toBe(false)
    })

    test('POST /cache/del deletes keys', async () => {
      await request('/cache/set', {
        method: 'POST',
        body: JSON.stringify({ key: 'to-delete', value: 'value' }),
      })

      const delRes = await request('/cache/del', {
        method: 'POST',
        body: JSON.stringify({ keys: ['to-delete'] }),
      })
      expect(delRes.status).toBe(200)
      const delData = await delRes.json()
      expect(delData.deleted).toBe(1)
    })

    test('POST /cache/incr increments value', async () => {
      const res1 = await request('/cache/incr', {
        method: 'POST',
        body: JSON.stringify({ key: 'counter-1' }),
      })
      const data1 = await res1.json()
      expect(data1.value).toBe(1)

      const res2 = await request('/cache/incr', {
        method: 'POST',
        body: JSON.stringify({ key: 'counter-1', by: 5 }),
      })
      const data2 = await res2.json()
      expect(data2.value).toBe(6)
    })

    test('POST /cache/decr decrements value', async () => {
      await request('/cache/set', {
        method: 'POST',
        body: JSON.stringify({ key: 'counter-2', value: '10' }),
      })

      const res = await request('/cache/decr', {
        method: 'POST',
        body: JSON.stringify({ key: 'counter-2', by: 3 }),
      })
      const data = await res.json()
      expect(data.value).toBe(7)
    })
  })

  // ===========================================================================
  // TTL Operations
  // ===========================================================================

  describe('TTL Operations', () => {
    test('GET /cache/ttl returns remaining time', async () => {
      await request('/cache/set', {
        method: 'POST',
        body: JSON.stringify({ key: 'ttl-test', value: 'value', ttl: 300 }),
      })

      const res = await request('/cache/ttl?key=ttl-test')
      const data = await res.json()
      expect(data.ttl).toBeGreaterThan(0)
      expect(data.ttl).toBeLessThanOrEqual(300)
    })

    test('POST /cache/expire sets TTL', async () => {
      await request('/cache/set', {
        method: 'POST',
        body: JSON.stringify({ key: 'expire-test', value: 'value' }),
      })

      const res = await request('/cache/expire', {
        method: 'POST',
        body: JSON.stringify({ key: 'expire-test', ttl: 60 }),
      })
      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  describe('Batch Operations', () => {
    test('POST /cache/mset sets multiple keys', async () => {
      const res = await request('/cache/mset', {
        method: 'POST',
        body: JSON.stringify({
          entries: [
            { key: 'batch-1', value: 'value1' },
            { key: 'batch-2', value: 'value2' },
            { key: 'batch-3', value: 'value3' },
          ],
        }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)

      const get1 = await request('/cache/get?key=batch-1')
      const get2 = await request('/cache/get?key=batch-2')
      const get3 = await request('/cache/get?key=batch-3')

      expect((await get1.json()).value).toBe('value1')
      expect((await get2.json()).value).toBe('value2')
      expect((await get3.json()).value).toBe('value3')
    })

    test('POST /cache/mget gets multiple keys', async () => {
      await request('/cache/mset', {
        method: 'POST',
        body: JSON.stringify({
          entries: [
            { key: 'mget-1', value: 'val1' },
            { key: 'mget-2', value: 'val2' },
          ],
        }),
      })

      const res = await request('/cache/mget', {
        method: 'POST',
        body: JSON.stringify({
          keys: ['mget-1', 'mget-2', 'mget-nonexistent'],
        }),
      })
      const data = await res.json()

      expect(data.entries['mget-1']).toBe('val1')
      expect(data.entries['mget-2']).toBe('val2')
      expect(data.entries['mget-nonexistent']).toBeNull()
    })
  })

  // ===========================================================================
  // Hash Operations
  // ===========================================================================

  describe('Hash Operations', () => {
    test('POST /cache/hset and GET /cache/hget', async () => {
      const setRes = await request('/cache/hset', {
        method: 'POST',
        body: JSON.stringify({
          key: 'hash-1',
          field: 'field1',
          value: 'value1',
        }),
      })
      expect(setRes.status).toBe(200)

      const getRes = await request('/cache/hget?key=hash-1&field=field1')
      const getData = await getRes.json()
      expect(getData.value).toBe('value1')
    })

    test('POST /cache/hmset and GET /cache/hgetall', async () => {
      await request('/cache/hmset', {
        method: 'POST',
        body: JSON.stringify({
          key: 'hash-2',
          fields: { f1: 'v1', f2: 'v2', f3: 'v3' },
        }),
      })

      const res = await request('/cache/hgetall?key=hash-2')
      const data = await res.json()
      expect(data.hash).toEqual({ f1: 'v1', f2: 'v2', f3: 'v3' })
    })
  })

  // ===========================================================================
  // List Operations
  // ===========================================================================

  describe('List Operations', () => {
    test('POST /cache/lpush and POST /cache/lrange', async () => {
      await request('/cache/lpush', {
        method: 'POST',
        body: JSON.stringify({ key: 'list-1', values: ['a', 'b', 'c'] }),
      })

      const res = await request('/cache/lrange', {
        method: 'POST',
        body: JSON.stringify({ key: 'list-1', start: 0, stop: -1 }),
      })
      const data = await res.json()
      expect(data.values).toEqual(['c', 'b', 'a'])
    })

    test('POST /cache/rpush', async () => {
      await request('/cache/rpush', {
        method: 'POST',
        body: JSON.stringify({ key: 'list-2', values: ['x', 'y', 'z'] }),
      })

      const res = await request('/cache/lrange', {
        method: 'POST',
        body: JSON.stringify({ key: 'list-2', start: 0, stop: -1 }),
      })
      const data = await res.json()
      expect(data.values).toEqual(['x', 'y', 'z'])
    })

    test('GET /cache/lpop and GET /cache/rpop', async () => {
      await request('/cache/rpush', {
        method: 'POST',
        body: JSON.stringify({ key: 'list-3', values: ['1', '2', '3'] }),
      })

      const lpopRes = await request('/cache/lpop?key=list-3')
      expect((await lpopRes.json()).value).toBe('1')

      const rpopRes = await request('/cache/rpop?key=list-3')
      expect((await rpopRes.json()).value).toBe('3')
    })

    test('GET /cache/llen', async () => {
      await request('/cache/rpush', {
        method: 'POST',
        body: JSON.stringify({ key: 'list-4', values: ['a', 'b', 'c', 'd'] }),
      })

      const res = await request('/cache/llen?key=list-4')
      const data = await res.json()
      expect(data.length).toBe(4)
    })
  })

  // ===========================================================================
  // Set Operations
  // ===========================================================================

  describe('Set Operations', () => {
    test('POST /cache/sadd and GET /cache/smembers', async () => {
      const addRes = await request('/cache/sadd', {
        method: 'POST',
        body: JSON.stringify({ key: 'set-1', members: ['a', 'b', 'c'] }),
      })
      expect((await addRes.json()).added).toBe(3)

      const membersRes = await request('/cache/smembers?key=set-1')
      const membersData = await membersRes.json()
      expect(membersData.members.sort()).toEqual(['a', 'b', 'c'])
    })

    test('POST /cache/srem', async () => {
      await request('/cache/sadd', {
        method: 'POST',
        body: JSON.stringify({ key: 'set-2', members: ['x', 'y', 'z'] }),
      })

      const remRes = await request('/cache/srem', {
        method: 'POST',
        body: JSON.stringify({ key: 'set-2', members: ['x', 'y'] }),
      })
      expect((await remRes.json()).removed).toBe(2)

      const membersRes = await request('/cache/smembers?key=set-2')
      expect((await membersRes.json()).members).toEqual(['z'])
    })

    test('GET /cache/sismember', async () => {
      await request('/cache/sadd', {
        method: 'POST',
        body: JSON.stringify({ key: 'set-3', members: ['a', 'b'] }),
      })

      const res1 = await request('/cache/sismember?key=set-3&member=a')
      expect((await res1.json()).isMember).toBe(true)

      const res2 = await request('/cache/sismember?key=set-3&member=x')
      expect((await res2.json()).isMember).toBe(false)
    })

    test('GET /cache/scard', async () => {
      await request('/cache/sadd', {
        method: 'POST',
        body: JSON.stringify({
          key: 'set-4',
          members: ['1', '2', '3', '4', '5'],
        }),
      })

      const res = await request('/cache/scard?key=set-4')
      expect((await res.json()).size).toBe(5)
    })
  })

  // ===========================================================================
  // Sorted Set Operations
  // ===========================================================================

  describe('Sorted Set Operations', () => {
    test('POST /cache/zadd and GET /cache/zrange', async () => {
      await request('/cache/zadd', {
        method: 'POST',
        body: JSON.stringify({
          key: 'zset-1',
          members: [
            { member: 'alice', score: 100 },
            { member: 'bob', score: 200 },
            { member: 'charlie', score: 150 },
          ],
        }),
      })

      const res = await request('/cache/zrange?key=zset-1&start=0&stop=-1')
      const data = await res.json()
      expect(data.members).toEqual(['alice', 'charlie', 'bob'])
    })

    test('GET /cache/zcard', async () => {
      await request('/cache/zadd', {
        method: 'POST',
        body: JSON.stringify({
          key: 'zset-2',
          members: [
            { member: 'a', score: 1 },
            { member: 'b', score: 2 },
          ],
        }),
      })

      const res = await request('/cache/zcard?key=zset-2')
      expect((await res.json()).size).toBe(2)
    })
  })

  // ===========================================================================
  // Key Operations
  // ===========================================================================

  describe('Key Operations', () => {
    test('GET /cache/keys with pattern', async () => {
      await request('/cache/mset', {
        method: 'POST',
        body: JSON.stringify({
          entries: [
            { key: 'user:1', value: 'a' },
            { key: 'user:2', value: 'b' },
            { key: 'product:1', value: 'c' },
          ],
        }),
      })

      const res = await request('/cache/keys?pattern=user:*')
      const data = await res.json()
      expect(data.keys.sort()).toEqual(['user:1', 'user:2'])
    })

    test('DELETE /cache/clear clears namespace', async () => {
      // Set up some keys
      await request('/cache/mset', {
        method: 'POST',
        body: JSON.stringify({
          namespace: 'clear-test-ns',
          entries: [
            { key: 'clear-1', value: 'v' },
            { key: 'clear-2', value: 'v' },
          ],
        }),
      })

      // Clear the namespace
      const clearRes = await request('/cache/clear?namespace=clear-test-ns', {
        method: 'DELETE',
      })
      const clearData = await clearRes.json()
      expect(clearData.success).toBe(true)

      // Verify cleared
      const keysRes = await request('/cache/keys?namespace=clear-test-ns')
      const keysData = await keysRes.json()
      expect(keysData.keys.length).toBe(0)
    })
  })

  // ===========================================================================
  // Plans
  // ===========================================================================

  describe('Plans', () => {
    test('GET /cache/plans returns available plans', async () => {
      const res = await request('/cache/plans')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(Array.isArray(data.plans)).toBe(true)
      expect(data.plans.length).toBeGreaterThan(0)

      const plan = data.plans[0]
      expect(plan.id).toBeDefined()
      expect(plan.name).toBeDefined()
      expect(plan.tier).toBeDefined()
      expect(plan.maxMemoryMb).toBeDefined()
    })
  })

  // ===========================================================================
  // Namespace Isolation
  // ===========================================================================

  describe('Namespace Isolation', () => {
    test('Keys are isolated by namespace', async () => {
      await request('/cache/set', {
        method: 'POST',
        body: JSON.stringify({
          key: 'shared-key',
          value: 'ns1-value',
          namespace: 'ns1',
        }),
      })

      await request('/cache/set', {
        method: 'POST',
        body: JSON.stringify({
          key: 'shared-key',
          value: 'ns2-value',
          namespace: 'ns2',
        }),
      })

      const res1 = await request('/cache/get?key=shared-key&namespace=ns1')
      expect((await res1.json()).value).toBe('ns1-value')

      const res2 = await request('/cache/get?key=shared-key&namespace=ns2')
      expect((await res2.json()).value).toBe('ns2-value')
    })
  })
})
