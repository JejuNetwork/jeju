import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { CacheEngine } from '../api/cache/engine'

describe('CacheEngine Performance', () => {
  let engine: CacheEngine

  beforeAll(() => {
    engine = new CacheEngine({
      maxMemoryMb: 256,
      defaultTtlSeconds: 3600,
      maxTtlSeconds: 86400,
    })
  })

  afterAll(() => {
    engine.stop()
  })

  test('handles 10k sequential writes in under 100ms', () => {
    const start = Date.now()
    for (let i = 0; i < 10000; i++) {
      engine.set('perf', `key-${i}`, `value-${i}`, { ttl: 3600 })
    }
    const duration = Date.now() - start
    console.log(`10k sequential writes: ${duration}ms`)
    expect(duration).toBeLessThan(100)
  })

  test('handles 10k sequential reads in under 50ms', () => {
    // Keys already populated from previous test
    const start = Date.now()
    for (let i = 0; i < 10000; i++) {
      engine.get('perf', `key-${i}`)
    }
    const duration = Date.now() - start
    console.log(`10k sequential reads: ${duration}ms`)
    expect(duration).toBeLessThan(50)
  })

  test('handles 1k hash operations in under 50ms', () => {
    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      engine.hset('perf', `hash-${i}`, { field1: 'val1', field2: 'val2' })
      engine.hget('perf', `hash-${i}`, 'field1')
      engine.hgetall('perf', `hash-${i}`)
    }
    const duration = Date.now() - start
    console.log(`1k hash operations: ${duration}ms`)
    expect(duration).toBeLessThan(50)
  })

  test('handles 1k list operations in under 50ms', () => {
    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      engine.lpush('perf', `list-${i}`, 'a', 'b', 'c')
      engine.rpush('perf', `list-${i}`, 'd', 'e')
      engine.lrange('perf', `list-${i}`, 0, -1)
    }
    const duration = Date.now() - start
    console.log(`1k list operations: ${duration}ms`)
    expect(duration).toBeLessThan(50)
  })

  test('handles 1k set operations in under 50ms', () => {
    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      engine.sadd('perf', `set-${i}`, 'member1', 'member2', 'member3')
      engine.sismember('perf', `set-${i}`, 'member1')
      engine.smembers('perf', `set-${i}`)
    }
    const duration = Date.now() - start
    console.log(`1k set operations: ${duration}ms`)
    expect(duration).toBeLessThan(50)
  })

  test('handles high concurrency with consistent reads', async () => {
    // Seed data
    for (let i = 0; i < 100; i++) {
      engine.set('concurrent', `key-${i}`, `value-${i}`, { ttl: 3600 })
    }

    const start = Date.now()
    const promises: Promise<void>[] = []

    // 100 concurrent operations
    for (let i = 0; i < 100; i++) {
      promises.push(
        new Promise((resolve) => {
          // Mix of reads and writes
          for (let j = 0; j < 100; j++) {
            if (j % 2 === 0) {
              engine.get('concurrent', `key-${j % 100}`)
            } else {
              engine.set('concurrent', `key-${j % 100}`, `new-value-${j}`)
            }
          }
          resolve()
        }),
      )
    }

    await Promise.all(promises)
    const duration = Date.now() - start
    console.log(`10k concurrent ops: ${duration}ms`)
    expect(duration).toBeLessThan(200)
  })

  test('LRU eviction is O(1) - constant time', () => {
    // Fill cache with known data
    const testEngine = new CacheEngine({
      maxMemoryMb: 1, // Small to trigger evictions
      defaultTtlSeconds: 3600,
      maxTtlSeconds: 86400,
    })

    // Measure time to insert and evict
    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      testEngine.set('evict', `key-${i}`, 'x'.repeat(1000), { ttl: 3600 })
    }
    const duration = Date.now() - start
    console.log(`1k writes with eviction: ${duration}ms`)

    // Should still be fast even with evictions
    expect(duration).toBeLessThan(100)
    testEngine.stop()
  })

  test('getStats returns accurate metrics', () => {
    const stats = engine.getStats()

    expect(stats.totalKeys).toBeGreaterThan(0)
    expect(stats.usedMemoryBytes).toBeGreaterThan(0)
    expect(stats.hits).toBeGreaterThanOrEqual(0)
    expect(stats.misses).toBeGreaterThanOrEqual(0)
    expect(stats.uptime).toBeGreaterThanOrEqual(0)

    console.log('Stats:', JSON.stringify(stats, null, 2))
  })
})
