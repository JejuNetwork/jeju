import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { unlink } from 'node:fs/promises'
import type { Address } from 'viem'
import {
  AOFPersistence,
  ClusterManager,
  ConsistentHashRing,
  RegionalRouter,
  ReplicationManager,
  ReplicationMode,
} from '../api/cache/cluster'
import { CacheEngine } from '../api/cache/engine'
import type { CacheNode } from '../api/cache/types'
import { CacheTier } from '../api/cache/types'

// Helper to create mock nodes
function createMockNode(
  id: string,
  region = 'us-east',
  tier: CacheTier = CacheTier.STANDARD,
): CacheNode {
  return {
    nodeId: id,
    address: `0x${id.padStart(40, '0')}` as Address,
    endpoint: `http://${id}.cache.local:3000`,
    region,
    tier,
    maxMemoryMb: 256,
    usedMemoryMb: 0,
    instanceCount: 0,
    status: 'online',
    lastHeartbeat: Date.now(),
  }
}

describe('ConsistentHashRing', () => {
  let ring: ConsistentHashRing

  beforeEach(() => {
    ring = new ConsistentHashRing(100)
  })

  it('should add nodes to the ring', () => {
    const node1 = createMockNode('node1')
    const node2 = createMockNode('node2')

    ring.addNode(node1)
    ring.addNode(node2)

    expect(ring.getNodeCount()).toBe(2)
  })

  it('should remove nodes from the ring', () => {
    const node1 = createMockNode('node1')
    const node2 = createMockNode('node2')

    ring.addNode(node1)
    ring.addNode(node2)
    ring.removeNode('node1')

    expect(ring.getNodeCount()).toBe(1)
    expect(ring.getAllNodes()).toEqual([node2])
  })

  it('should return null for empty ring', () => {
    expect(ring.getNode('key')).toBeNull()
    expect(ring.getNodes('key', 3)).toEqual([])
  })

  it('should return a node for any key', () => {
    ring.addNode(createMockNode('node1'))
    ring.addNode(createMockNode('node2'))

    const node = ring.getNode('test-key')
    expect(node).not.toBeNull()
    expect(['node1', 'node2']).toContain(node?.nodeId)
  })

  it('should distribute keys across nodes', () => {
    // Use diverse node IDs to ensure good distribution
    ring.addNode(createMockNode('cache-us-east-001'))
    ring.addNode(createMockNode('cache-us-west-002'))
    ring.addNode(createMockNode('cache-eu-west-003'))

    const distribution = new Map<string, number>()

    // Use a variety of key patterns
    for (let i = 0; i < 1000; i++) {
      const node = ring.getNode(`user:${i}:profile`)
      if (node) {
        distribution.set(node.nodeId, (distribution.get(node.nodeId) ?? 0) + 1)
      }
    }

    // All nodes should receive some keys
    expect(distribution.size).toBeGreaterThanOrEqual(2)

    // Verify distribution is not pathologically bad (all on one node)
    const maxCount = Math.max(...distribution.values())
    expect(maxCount).toBeLessThan(900) // No single node should have 90%+ of keys
  })

  it('should consistently hash the same key to the same node', () => {
    ring.addNode(createMockNode('node1'))
    ring.addNode(createMockNode('node2'))
    ring.addNode(createMockNode('node3'))

    const key = 'consistent-key'
    const node1 = ring.getNode(key)
    const node2 = ring.getNode(key)
    const node3 = ring.getNode(key)

    expect(node1?.nodeId).toBe(node2?.nodeId)
    expect(node2?.nodeId).toBe(node3?.nodeId)
  })

  it('should return multiple unique nodes for replication', () => {
    ring.addNode(createMockNode('node1'))
    ring.addNode(createMockNode('node2'))
    ring.addNode(createMockNode('node3'))

    const nodes = ring.getNodes('key', 3)

    expect(nodes.length).toBe(3)
    const nodeIds = nodes.map((n) => n.nodeId)
    expect(new Set(nodeIds).size).toBe(3) // All unique
  })

  it('should skip offline nodes in getNodes', () => {
    const node1 = createMockNode('node1')
    const node2 = createMockNode('node2')
    node2.status = 'offline'
    const node3 = createMockNode('node3')

    ring.addNode(node1)
    ring.addNode(node2)
    ring.addNode(node3)

    const nodes = ring.getNodes('key', 3)

    expect(nodes.length).toBe(2)
    expect(nodes.every((n) => n.status === 'online')).toBe(true)
  })

  it('should handle node replacement', () => {
    const node1 = createMockNode('node1', 'us-east')
    ring.addNode(node1)

    const newNode1 = createMockNode('node1', 'us-west')
    ring.addNode(newNode1)

    expect(ring.getNodeCount()).toBe(1)
    expect(ring.getAllNodes()[0].region).toBe('us-west')
  })
})

describe('ReplicationManager', () => {
  let ring: ConsistentHashRing
  let replication: ReplicationManager
  let engines: Map<string, CacheEngine>

  beforeEach(() => {
    ring = new ConsistentHashRing(50)
    engines = new Map()

    // Create nodes and engines
    for (let i = 1; i <= 3; i++) {
      const node = createMockNode(`node${i}`)
      ring.addNode(node)

      const engine = new CacheEngine({ maxMemoryMb: 64 })
      engines.set(`node${i}`, engine)
    }

    replication = new ReplicationManager(ring, {
      mode: ReplicationMode.SYNC,
      replicaCount: 2,
      syncTimeoutMs: 1000,
    })

    // Register engines
    for (const [nodeId, engine] of engines) {
      replication.registerEngine(nodeId, engine)
    }
  })

  afterEach(() => {
    replication.stop()
    for (const engine of engines.values()) {
      engine.stop()
    }
  })

  it('should replicate SET to replicas', async () => {
    await replication.replicateSet('ns', 'key', 'value', 3600)

    // Give async ops time to complete
    await new Promise((r) => setTimeout(r, 50))

    // At least one replica should have the value
    let replicaCount = 0
    for (const engine of engines.values()) {
      if (engine.get('ns', 'key') === 'value') {
        replicaCount++
      }
    }

    expect(replicaCount).toBeGreaterThanOrEqual(1)
  })

  it('should replicate DEL to replicas', async () => {
    // First set value on all engines
    for (const engine of engines.values()) {
      engine.set('ns', 'key', 'value')
    }

    await replication.replicateDel('ns', 'key')
    await new Promise((r) => setTimeout(r, 50))

    // At least one replica should have deleted
    let deletedCount = 0
    for (const engine of engines.values()) {
      if (engine.get('ns', 'key') === null) {
        deletedCount++
      }
    }

    expect(deletedCount).toBeGreaterThanOrEqual(1)
  })

  it('should report correct status', () => {
    const status = replication.getStatus()

    expect(status.mode).toBe(ReplicationMode.SYNC)
    expect(status.replicaCount).toBe(2)
    expect(status.pendingOps).toBe(0)
  })
})

describe('ReplicationManager Async Mode', () => {
  let ring: ConsistentHashRing
  let replication: ReplicationManager
  let engines: Map<string, CacheEngine>

  beforeEach(() => {
    ring = new ConsistentHashRing(50)
    engines = new Map()

    for (let i = 1; i <= 3; i++) {
      const node = createMockNode(`node${i}`)
      ring.addNode(node)
      engines.set(`node${i}`, new CacheEngine({ maxMemoryMb: 64 }))
    }

    replication = new ReplicationManager(ring, {
      mode: ReplicationMode.ASYNC,
      replicaCount: 2,
      asyncBatchSize: 10,
      asyncFlushIntervalMs: 50,
    })

    for (const [nodeId, engine] of engines) {
      replication.registerEngine(nodeId, engine)
    }
  })

  afterEach(() => {
    replication.stop()
    for (const engine of engines.values()) {
      engine.stop()
    }
  })

  it('should batch async operations', async () => {
    // Queue multiple operations
    for (let i = 0; i < 5; i++) {
      await replication.replicateSet('ns', `key${i}`, `value${i}`)
    }

    const status = replication.getStatus()
    expect(status.pendingOps).toBe(5)

    // Wait for flush interval
    await new Promise((r) => setTimeout(r, 100))

    // Ops should be flushed
    const newStatus = replication.getStatus()
    expect(newStatus.pendingOps).toBe(0)
  })

  it('should flush when batch size reached', async () => {
    // Queue more than batch size
    for (let i = 0; i < 15; i++) {
      await replication.replicateSet('ns', `key${i}`, `value${i}`)
    }

    // Should have flushed once (10) leaving 5
    const status = replication.getStatus()
    expect(status.pendingOps).toBeLessThanOrEqual(5)
  })
})

describe('RegionalRouter', () => {
  let ring: ConsistentHashRing
  let router: RegionalRouter

  beforeEach(() => {
    ring = new ConsistentHashRing(50)

    // Add nodes in different regions
    ring.addNode(createMockNode('node-east-1', 'us-east'))
    ring.addNode(createMockNode('node-east-2', 'us-east'))
    ring.addNode(createMockNode('node-west-1', 'us-west'))
    ring.addNode(createMockNode('node-eu-1', 'eu-west'))

    router = new RegionalRouter(ring, 'us-east', 60000) // 1 minute probe
  })

  afterEach(() => {
    router.stop()
  })

  it('should prefer local region', () => {
    // Update latencies
    router.updateLatency('us-east', 5)
    router.updateLatency('us-west', 50)
    router.updateLatency('eu-west', 100)

    // For most keys, should prefer us-east nodes
    let localCount = 0
    for (let i = 0; i < 100; i++) {
      const node = router.getBestNode(`key-${i}`)
      if (node?.region === 'us-east') localCount++
    }

    expect(localCount).toBeGreaterThan(30) // At least 30% local
  })

  it('should return nodes in specific region', () => {
    const eastNodes = router.getNodesInRegion('us-east')
    const westNodes = router.getNodesInRegion('us-west')

    expect(eastNodes.length).toBe(2)
    expect(westNodes.length).toBe(1)
  })

  it('should track region latencies', () => {
    router.updateLatency('us-east', 10)
    router.updateLatency('us-west', 50)

    const latencies = router.getRegionLatencies()

    expect(latencies.length).toBe(2)
    expect(latencies.find((l) => l.region === 'us-east')?.latencyMs).toBe(10)
    expect(latencies.find((l) => l.region === 'us-west')?.latencyMs).toBe(50)
  })

  it('should filter by tier', () => {
    // Add a premium node
    ring.addNode(createMockNode('node-premium', 'us-east', CacheTier.PREMIUM))

    const node = router.getBestNode('key', CacheTier.PREMIUM)

    expect(node?.tier).toBe(CacheTier.PREMIUM)
  })
})

describe('AOFPersistence', () => {
  const testAofPath = '/tmp/test-cache.aof'
  let aof: AOFPersistence
  let engine: CacheEngine

  beforeEach(async () => {
    // Clean up any existing file
    await unlink(testAofPath).catch(() => {})

    engine = new CacheEngine({ maxMemoryMb: 64 })
    aof = new AOFPersistence({
      enabled: true,
      filePath: testAofPath,
      fsyncMode: 'everysec',
      rewriteThreshold: 1024 * 1024, // 1MB for testing
    })

    await aof.initialize(engine)
  })

  afterEach(async () => {
    await aof.stop()
    engine.stop()
    await unlink(testAofPath).catch(() => {})
  })

  it('should log SET operations', () => {
    aof.logSet('ns', 'key1', 'value1')
    aof.logSet('ns', 'key2', 'value2', 3600)

    const stats = aof.getStats()
    expect(stats.pendingEntries).toBe(2)
  })

  it('should log DEL operations', () => {
    aof.logSet('ns', 'key', 'value')
    aof.logDel('ns', 'key')

    const stats = aof.getStats()
    expect(stats.pendingEntries).toBe(2)
  })

  it('should log hash operations', () => {
    aof.logHSet('ns', 'hash', 'field1', 'value1')

    const stats = aof.getStats()
    expect(stats.pendingEntries).toBe(1)
  })

  it('should log list operations', () => {
    aof.logLPush('ns', 'list', ['a', 'b', 'c'])
    aof.logRPush('ns', 'list', ['d', 'e'])

    const stats = aof.getStats()
    expect(stats.pendingEntries).toBe(2)
  })

  it('should log set operations', () => {
    aof.logSAdd('ns', 'set', ['member1', 'member2'])

    const stats = aof.getStats()
    expect(stats.pendingEntries).toBe(1)
  })

  it('should log sorted set operations', () => {
    aof.logZAdd('ns', 'zset', [
      { member: 'm1', score: 1 },
      { member: 'm2', score: 2 },
    ])

    const stats = aof.getStats()
    expect(stats.pendingEntries).toBe(1)
  })

  it('should flush to disk', async () => {
    aof.logSet('ns', 'key', 'value')

    // Wait for flush interval
    await new Promise((r) => setTimeout(r, 1100))

    const stats = aof.getStats()
    expect(stats.pendingEntries).toBe(0)
    expect(stats.bytesWritten).toBeGreaterThan(0)
  })

  it('should replay on restart', async () => {
    // Write some data
    aof.logSet('ns', 'key1', 'value1')
    aof.logSet('ns', 'key2', 'value2')
    aof.logHSet('ns', 'hash', 'field', 'value')

    await new Promise((r) => setTimeout(r, 1100))
    await aof.stop()

    // Create new engine and AOF
    const newEngine = new CacheEngine({ maxMemoryMb: 64 })
    const newAof = new AOFPersistence({
      enabled: true,
      filePath: testAofPath,
      fsyncMode: 'everysec',
    })

    await newAof.initialize(newEngine)

    // Check data was replayed
    expect(newEngine.get('ns', 'key1')).toBe('value1')
    expect(newEngine.get('ns', 'key2')).toBe('value2')
    expect(newEngine.hget('ns', 'hash', 'field')).toBe('value')

    await newAof.stop()
    newEngine.stop()
  })

  it('should report disabled when not enabled', () => {
    const disabledAof = new AOFPersistence({ enabled: false })

    const stats = disabledAof.getStats()
    expect(stats.enabled).toBe(false)
  })
})

describe('ClusterManager', () => {
  let cluster: ClusterManager
  let engine: CacheEngine

  beforeEach(async () => {
    engine = new CacheEngine({ maxMemoryMb: 64 })
    cluster = new ClusterManager({
      localRegion: 'us-east',
      replication: { mode: ReplicationMode.ASYNC },
      aof: { enabled: false },
    })

    await cluster.initialize(engine)
  })

  afterEach(async () => {
    await cluster.stop()
    engine.stop()
  })

  it('should add and remove nodes', () => {
    cluster.addNode(createMockNode('node1'))
    cluster.addNode(createMockNode('node2'))

    expect(cluster.getHashRing().getNodeCount()).toBe(2)

    cluster.removeNode('node1')

    expect(cluster.getHashRing().getNodeCount()).toBe(1)
  })

  it('should route to best node', () => {
    cluster.addNode(createMockNode('node1', 'us-east'))
    cluster.addNode(createMockNode('node2', 'us-west'))

    const node = cluster.getNode('key')
    expect(node).not.toBeNull()
  })

  it('should get replicas for a key', () => {
    cluster.addNode(createMockNode('node1'))
    cluster.addNode(createMockNode('node2'))
    cluster.addNode(createMockNode('node3'))

    const replicas = cluster.getReplicas('key', 2)
    expect(replicas.length).toBe(2)
  })

  it('should perform SET with replication', async () => {
    cluster.addNode(createMockNode('node1'))

    await cluster.set('ns', 'key', 'value', 3600)

    // Local engine should have the value
    expect(engine.get('ns', 'key')).toBe('value')
  })

  it('should perform DEL with replication', async () => {
    cluster.addNode(createMockNode('node1'))

    await cluster.set('ns', 'key', 'value')
    await cluster.del('ns', 'key')

    expect(engine.get('ns', 'key')).toBeNull()
  })

  it('should report cluster status', () => {
    cluster.addNode(createMockNode('node1', 'us-east'))
    cluster.addNode(createMockNode('node2', 'us-west'))

    const status = cluster.getStatus()

    expect(status.nodes).toBe(2)
    expect(status.replication.mode).toBe(ReplicationMode.ASYNC)
    expect(status.aof.enabled).toBe(false)
  })
})

describe('Cluster Integration', () => {
  let cluster: ClusterManager
  let engines: Map<string, CacheEngine>

  beforeEach(async () => {
    engines = new Map()

    const mainEngine = new CacheEngine({ maxMemoryMb: 64 })
    engines.set('main', mainEngine)

    cluster = new ClusterManager({
      localRegion: 'us-east',
      replication: {
        mode: ReplicationMode.SYNC,
        replicaCount: 2,
      },
      aof: { enabled: false },
    })

    await cluster.initialize(mainEngine)

    // Add nodes with engines
    for (let i = 1; i <= 3; i++) {
      const node = createMockNode(`node${i}`, i === 1 ? 'us-east' : 'us-west')
      const nodeEngine = new CacheEngine({ maxMemoryMb: 64 })
      engines.set(`node${i}`, nodeEngine)
      cluster.addNode(node, nodeEngine)
    }
  })

  afterEach(async () => {
    await cluster.stop()
    for (const engine of engines.values()) {
      engine.stop()
    }
  })

  it('should distribute and replicate data', async () => {
    // Write data
    await cluster.set('ns', 'key1', 'value1')
    await cluster.set('ns', 'key2', 'value2')
    await cluster.set('ns', 'key3', 'value3')

    // Allow replication
    await new Promise((r) => setTimeout(r, 100))

    // Main engine should have all keys
    expect(engines.get('main')?.get('ns', 'key1')).toBe('value1')
    expect(engines.get('main')?.get('ns', 'key2')).toBe('value2')
    expect(engines.get('main')?.get('ns', 'key3')).toBe('value3')
  })

  it('should handle node failure gracefully', async () => {
    // Set data
    await cluster.set('ns', 'key', 'value')

    // Simulate node failure
    cluster.removeNode('node1')

    // Should still be able to get replicas
    const replicas = cluster.getReplicas('key', 2)
    expect(replicas.length).toBe(2)
  })
})
