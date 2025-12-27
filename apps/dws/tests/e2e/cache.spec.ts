/**
 * Cache E2E Tests
 *
 * Tests the decentralized cache service end-to-end
 */

import { expect, test } from '@playwright/test'

const DWS_API_URL = process.env.DWS_API_URL || 'http://localhost:4030'

test.describe('Cache Service E2E', () => {
  test('cache health endpoint returns healthy', async ({ request }) => {
    const response = await request.get(`${DWS_API_URL}/cache/health`)
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.status).toBe('healthy')
    expect(typeof data.uptime).toBe('number')
    expect(typeof data.timestamp).toBe('number')
  })

  test('cache stats endpoint returns statistics', async ({ request }) => {
    const response = await request.get(`${DWS_API_URL}/cache/stats`)
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data).toHaveProperty('global')
    expect(data).toHaveProperty('shared')
    expect(typeof data.shared.totalKeys).toBe('number')
    expect(typeof data.shared.usedMemoryBytes).toBe('number')
    expect(typeof data.shared.hits).toBe('number')
    expect(typeof data.shared.misses).toBe('number')
  })

  test('set and get a cache value', async ({ request }) => {
    const testKey = `test-key-${Date.now()}`
    const testValue = `test-value-${Date.now()}`

    // Set value
    const setResponse = await request.post(`${DWS_API_URL}/cache/set`, {
      data: {
        key: testKey,
        value: testValue,
        ttl: 60,
        namespace: 'e2e-test',
      },
    })
    expect(setResponse.ok()).toBe(true)
    const setData = await setResponse.json()
    expect(setData.success).toBe(true)

    // Get value
    const getResponse = await request.get(
      `${DWS_API_URL}/cache/get?key=${testKey}&namespace=e2e-test`
    )
    expect(getResponse.ok()).toBe(true)
    const getData = await getResponse.json()
    expect(getData.found).toBe(true)
    expect(getData.value).toBe(testValue)
  })

  test('delete cache keys', async ({ request }) => {
    const testKey = `delete-test-${Date.now()}`

    // Set value first
    await request.post(`${DWS_API_URL}/cache/set`, {
      data: {
        key: testKey,
        value: 'to-be-deleted',
        namespace: 'e2e-test',
      },
    })

    // Delete it
    const delResponse = await request.post(`${DWS_API_URL}/cache/del`, {
      data: {
        keys: [testKey],
        namespace: 'e2e-test',
      },
    })
    expect(delResponse.ok()).toBe(true)
    const delData = await delResponse.json()
    expect(delData.deleted).toBe(1)

    // Verify it's gone
    const getResponse = await request.get(
      `${DWS_API_URL}/cache/get?key=${testKey}&namespace=e2e-test`
    )
    const getData = await getResponse.json()
    expect(getData.found).toBe(false)
  })

  test('mset and mget multiple values', async ({ request }) => {
    const prefix = `mtest-${Date.now()}`
    const entries = [
      { key: `${prefix}-1`, value: 'value1' },
      { key: `${prefix}-2`, value: 'value2' },
      { key: `${prefix}-3`, value: 'value3' },
    ]

    // Set multiple values
    const msetResponse = await request.post(`${DWS_API_URL}/cache/mset`, {
      data: {
        entries,
        namespace: 'e2e-test',
      },
    })
    expect(msetResponse.ok()).toBe(true)

    // Get multiple values
    const mgetResponse = await request.post(`${DWS_API_URL}/cache/mget`, {
      data: {
        keys: entries.map((e) => e.key),
        namespace: 'e2e-test',
      },
    })
    expect(mgetResponse.ok()).toBe(true)
    const mgetData = await mgetResponse.json()

    expect(mgetData.entries[`${prefix}-1`]).toBe('value1')
    expect(mgetData.entries[`${prefix}-2`]).toBe('value2')
    expect(mgetData.entries[`${prefix}-3`]).toBe('value3')
  })

  test('increment and decrement operations', async ({ request }) => {
    const testKey = `counter-${Date.now()}`

    // Set initial value
    await request.post(`${DWS_API_URL}/cache/set`, {
      data: {
        key: testKey,
        value: '10',
        namespace: 'e2e-test',
      },
    })

    // Increment by 5
    const incrResponse = await request.post(`${DWS_API_URL}/cache/incr`, {
      data: {
        key: testKey,
        by: 5,
        namespace: 'e2e-test',
      },
    })
    expect(incrResponse.ok()).toBe(true)
    const incrData = await incrResponse.json()
    expect(incrData.value).toBe(15)

    // Decrement by 3
    const decrResponse = await request.post(`${DWS_API_URL}/cache/decr`, {
      data: {
        key: testKey,
        by: 3,
        namespace: 'e2e-test',
      },
    })
    expect(decrResponse.ok()).toBe(true)
    const decrData = await decrResponse.json()
    expect(decrData.value).toBe(12)
  })

  test('hash operations (hset, hget, hgetall)', async ({ request }) => {
    const testKey = `hash-${Date.now()}`

    // Set hash fields
    await request.post(`${DWS_API_URL}/cache/hset`, {
      data: {
        key: testKey,
        field: 'name',
        value: 'Alice',
        namespace: 'e2e-test',
      },
    })

    await request.post(`${DWS_API_URL}/cache/hset`, {
      data: {
        key: testKey,
        field: 'age',
        value: '30',
        namespace: 'e2e-test',
      },
    })

    // Get single field
    const hgetResponse = await request.get(
      `${DWS_API_URL}/cache/hget?key=${testKey}&field=name&namespace=e2e-test`
    )
    expect(hgetResponse.ok()).toBe(true)
    const hgetData = await hgetResponse.json()
    expect(hgetData.value).toBe('Alice')

    // Get all fields
    const hgetallResponse = await request.get(
      `${DWS_API_URL}/cache/hgetall?key=${testKey}&namespace=e2e-test`
    )
    expect(hgetallResponse.ok()).toBe(true)
    const hgetallData = await hgetallResponse.json()
    expect(hgetallData.hash.name).toBe('Alice')
    expect(hgetallData.hash.age).toBe('30')
  })

  test('list operations (lpush, rpush, lrange)', async ({ request }) => {
    const testKey = `list-${Date.now()}`

    // Push to left
    const lpushResponse = await request.post(`${DWS_API_URL}/cache/lpush`, {
      data: {
        key: testKey,
        values: ['first', 'second'],
        namespace: 'e2e-test',
      },
    })
    expect(lpushResponse.ok()).toBe(true)

    // Push to right
    await request.post(`${DWS_API_URL}/cache/rpush`, {
      data: {
        key: testKey,
        values: ['last'],
        namespace: 'e2e-test',
      },
    })

    // Get range
    const lrangeResponse = await request.post(`${DWS_API_URL}/cache/lrange`, {
      data: {
        key: testKey,
        start: 0,
        stop: -1,
        namespace: 'e2e-test',
      },
    })
    expect(lrangeResponse.ok()).toBe(true)
    const lrangeData = await lrangeResponse.json()
    // lpush adds to head, so order is reversed
    expect(lrangeData.values).toContain('first')
    expect(lrangeData.values).toContain('second')
    expect(lrangeData.values).toContain('last')
  })

  test('set operations (sadd, smembers)', async ({ request }) => {
    const testKey = `set-${Date.now()}`

    // Add members
    const saddResponse = await request.post(`${DWS_API_URL}/cache/sadd`, {
      data: {
        key: testKey,
        members: ['a', 'b', 'c', 'a'], // duplicate 'a'
        namespace: 'e2e-test',
      },
    })
    expect(saddResponse.ok()).toBe(true)
    const saddData = await saddResponse.json()
    expect(saddData.added).toBe(3) // Only 3 unique

    // Get members
    const smembersResponse = await request.get(
      `${DWS_API_URL}/cache/smembers?key=${testKey}&namespace=e2e-test`
    )
    expect(smembersResponse.ok()).toBe(true)
    const smembersData = await smembersResponse.json()
    expect(smembersData.members.sort()).toEqual(['a', 'b', 'c'])
  })

  test('sorted set operations (zadd, zrange)', async ({ request }) => {
    const testKey = `zset-${Date.now()}`

    // Add members with scores
    const zaddResponse = await request.post(`${DWS_API_URL}/cache/zadd`, {
      data: {
        key: testKey,
        members: [
          { member: 'low', score: 1 },
          { member: 'mid', score: 5 },
          { member: 'high', score: 10 },
        ],
        namespace: 'e2e-test',
      },
    })
    expect(zaddResponse.ok()).toBe(true)

    // Get range (sorted by score)
    const zrangeResponse = await request.get(
      `${DWS_API_URL}/cache/zrange?key=${testKey}&start=0&stop=-1&namespace=e2e-test`
    )
    expect(zrangeResponse.ok()).toBe(true)
    const zrangeData = await zrangeResponse.json()
    expect(zrangeData.members).toEqual(['low', 'mid', 'high'])
  })

  test('TTL and expire operations', async ({ request }) => {
    const testKey = `ttl-${Date.now()}`

    // Set with TTL
    await request.post(`${DWS_API_URL}/cache/set`, {
      data: {
        key: testKey,
        value: 'expires-soon',
        ttl: 300, // 5 minutes
        namespace: 'e2e-test',
      },
    })

    // Check TTL
    const ttlResponse = await request.get(
      `${DWS_API_URL}/cache/ttl?key=${testKey}&namespace=e2e-test`
    )
    expect(ttlResponse.ok()).toBe(true)
    const ttlData = await ttlResponse.json()
    expect(ttlData.ttl).toBeGreaterThan(0)
    expect(ttlData.ttl).toBeLessThanOrEqual(300)

    // Update expiry
    const expireResponse = await request.post(`${DWS_API_URL}/cache/expire`, {
      data: {
        key: testKey,
        ttl: 600, // 10 minutes
        namespace: 'e2e-test',
      },
    })
    expect(expireResponse.ok()).toBe(true)
    expect((await expireResponse.json()).success).toBe(true)
  })

  test('list keys with pattern', async ({ request }) => {
    const prefix = `pattern-${Date.now()}`

    // Create some keys
    await request.post(`${DWS_API_URL}/cache/mset`, {
      data: {
        entries: [
          { key: `${prefix}:user:1`, value: 'u1' },
          { key: `${prefix}:user:2`, value: 'u2' },
          { key: `${prefix}:session:1`, value: 's1' },
        ],
        namespace: 'e2e-test',
      },
    })

    // List all keys with prefix
    const keysResponse = await request.get(
      `${DWS_API_URL}/cache/keys?pattern=${prefix}*&namespace=e2e-test`
    )
    expect(keysResponse.ok()).toBe(true)
    const keysData = await keysResponse.json()
    expect(keysData.keys.length).toBeGreaterThanOrEqual(3)
  })

  test('cache plans endpoint returns available plans', async ({ request }) => {
    const response = await request.get(`${DWS_API_URL}/cache/plans`)
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(Array.isArray(data.plans)).toBe(true)
    expect(data.plans.length).toBeGreaterThan(0)

    const plan = data.plans[0]
    expect(plan).toHaveProperty('id')
    expect(plan).toHaveProperty('name')
    expect(plan).toHaveProperty('tier')
    expect(plan).toHaveProperty('memorySizeMb')
  })

  test('cache nodes endpoint returns node list', async ({ request }) => {
    const response = await request.get(`${DWS_API_URL}/cache/nodes`)
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(Array.isArray(data.nodes)).toBe(true)
  })

  test('prometheus metrics endpoint', async ({ request }) => {
    const response = await request.get(`${DWS_API_URL}/cache/metrics`)
    expect(response.ok()).toBe(true)

    const text = await response.text()
    expect(text).toContain('cache_keys_total')
    expect(text).toContain('cache_memory_bytes')
    expect(text).toContain('cache_hits_total')
    expect(text).toContain('cache_misses_total')
    expect(text).toContain('cache_hit_rate')
  })

  test('MCP cache tools are available', async ({ request }) => {
    const response = await request.post(`${DWS_API_URL}/mcp/tools/list`)
    expect(response.ok()).toBe(true)

    const data = await response.json()
    const toolNames = data.tools.map((t: { name: string }) => t.name)

    expect(toolNames).toContain('dws_cache_get')
    expect(toolNames).toContain('dws_cache_set')
    expect(toolNames).toContain('dws_cache_del')
    expect(toolNames).toContain('dws_cache_stats')
    expect(toolNames).toContain('dws_cache_keys')
  })

  test('MCP cache resource is available', async ({ request }) => {
    const response = await request.post(`${DWS_API_URL}/mcp/resources/list`)
    expect(response.ok()).toBe(true)

    const data = await response.json()
    const resourceUris = data.resources.map((r: { uri: string }) => r.uri)

    expect(resourceUris).toContain('dws://cache/stats')
  })

  test('MCP cache_set and cache_get tools work', async ({ request }) => {
    const testKey = `mcp-test-${Date.now()}`
    const testValue = 'mcp-value'

    // Set via MCP
    const setResponse = await request.post(`${DWS_API_URL}/mcp/tools/call`, {
      data: {
        name: 'dws_cache_set',
        arguments: {
          key: testKey,
          value: testValue,
          namespace: 'e2e-test',
        },
      },
    })
    expect(setResponse.ok()).toBe(true)
    const setResult = await setResponse.json()
    const setContent = JSON.parse(setResult.content[0].text)
    expect(setContent.success).toBe(true)

    // Get via MCP
    const getResponse = await request.post(`${DWS_API_URL}/mcp/tools/call`, {
      data: {
        name: 'dws_cache_get',
        arguments: {
          key: testKey,
          namespace: 'e2e-test',
        },
      },
    })
    expect(getResponse.ok()).toBe(true)
    const getResult = await getResponse.json()
    const getContent = JSON.parse(getResult.content[0].text)
    expect(getContent.found).toBe(true)
    expect(getContent.value).toBe(testValue)
  })

  test('clear cache namespace', async ({ request }) => {
    // First add some keys
    await request.post(`${DWS_API_URL}/cache/mset`, {
      data: {
        entries: [
          { key: 'clear-test-1', value: 'v1' },
          { key: 'clear-test-2', value: 'v2' },
        ],
        namespace: 'e2e-clear-test',
      },
    })

    // Clear the namespace
    const clearResponse = await request.delete(
      `${DWS_API_URL}/cache/clear?namespace=e2e-clear-test`
    )
    expect(clearResponse.ok()).toBe(true)

    // Verify keys are gone
    const keysResponse = await request.get(
      `${DWS_API_URL}/cache/keys?namespace=e2e-clear-test`
    )
    const keysData = await keysResponse.json()
    expect(keysData.keys.length).toBe(0)
  })
})

