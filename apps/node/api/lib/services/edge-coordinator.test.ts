import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

// Edge Node Info Schema
const EdgeNodeInfoSchema = z.object({
  nodeId: z.string().min(1),
  operator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  endpoint: z.string().url(),
  region: z.string().min(2),
  capabilities: z.object({
    maxCacheSizeMb: z.number().int().positive(),
    maxBandwidthMbps: z.number().positive(),
    supportsWebRTC: z.boolean(),
    supportsTCP: z.boolean(),
    supportsIPFS: z.boolean(),
    supportsTorrent: z.boolean(),
  }),
  metrics: z.object({
    cacheHitRate: z.number().min(0).max(1),
    avgLatencyMs: z.number().nonnegative(),
    bytesServed: z.number().int().nonnegative(),
    activeConnections: z.number().int().nonnegative(),
    cacheUtilization: z.number().min(0).max(1),
  }),
  lastSeen: z.number().int().positive(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
})

type EdgeNodeInfo = z.infer<typeof EdgeNodeInfoSchema>

// Edge Coordinator Config Schema
const EdgeCoordinatorConfigSchema = z.object({
  nodeId: z.string().min(1),
  operator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  listenPort: z.number().int().min(1024).max(65535),
  region: z.string().min(2),
  bootstrapNodes: z.array(z.string().url()),
  rpcUrl: z.string().url().optional(),
  nodeRegistryAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
})

type EdgeCoordinatorConfig = z.infer<typeof EdgeCoordinatorConfigSchema>

function validateEdgeNodeInfo(data: unknown): EdgeNodeInfo {
  return EdgeNodeInfoSchema.parse(data)
}

function validateEdgeCoordinatorConfig(data: unknown): EdgeCoordinatorConfig {
  return EdgeCoordinatorConfigSchema.parse(data)
}

describe('Edge Coordinator Configuration', () => {
  describe('validateEdgeCoordinatorConfig', () => {
    test('validates valid config', () => {
      const config: EdgeCoordinatorConfig = {
        nodeId: 'node-1',
        operator: '0x1234567890123456789012345678901234567890',
        privateKey: `0x${'a'.repeat(64)}`,
        listenPort: 8545,
        region: 'us-east-1',
        bootstrapNodes: [
          'wss://boot1.jeju.network',
          'wss://boot2.jeju.network',
        ],
        rpcUrl: 'https://rpc.jeju.network',
        nodeRegistryAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      }

      const result = validateEdgeCoordinatorConfig(config)
      expect(result.nodeId).toBe('node-1')
      expect(result.bootstrapNodes.length).toBe(2)
    })

    test('validates config without optional fields', () => {
      const config: EdgeCoordinatorConfig = {
        nodeId: 'node-1',
        operator: '0x1234567890123456789012345678901234567890',
        privateKey: `0x${'b'.repeat(64)}`,
        listenPort: 8545,
        region: 'eu-west-1',
        bootstrapNodes: [],
      }

      const result = validateEdgeCoordinatorConfig(config)
      expect(result.rpcUrl).toBeUndefined()
      expect(result.nodeRegistryAddress).toBeUndefined()
    })

    test('rejects invalid operator address', () => {
      const config = {
        nodeId: 'node-1',
        operator: 'invalid',
        privateKey: `0x${'a'.repeat(64)}`,
        listenPort: 8545,
        region: 'us-east-1',
        bootstrapNodes: [],
      }

      expect(() => validateEdgeCoordinatorConfig(config)).toThrow()
    })

    test('rejects invalid private key', () => {
      const config = {
        nodeId: 'node-1',
        operator: '0x1234567890123456789012345678901234567890',
        privateKey: 'not-a-private-key',
        listenPort: 8545,
        region: 'us-east-1',
        bootstrapNodes: [],
      }

      expect(() => validateEdgeCoordinatorConfig(config)).toThrow()
    })

    test('rejects invalid bootstrap node URLs', () => {
      const config = {
        nodeId: 'node-1',
        operator: '0x1234567890123456789012345678901234567890',
        privateKey: `0x${'a'.repeat(64)}`,
        listenPort: 8545,
        region: 'us-east-1',
        bootstrapNodes: ['not-a-url'],
      }

      expect(() => validateEdgeCoordinatorConfig(config)).toThrow()
    })
  })

  describe('validateEdgeNodeInfo', () => {
    test('validates valid node info', () => {
      const info: EdgeNodeInfo = {
        nodeId: 'node-abc123',
        operator: '0x1234567890123456789012345678901234567890',
        endpoint: 'https://node.example.com:8545',
        region: 'us-west-2',
        capabilities: {
          maxCacheSizeMb: 10240,
          maxBandwidthMbps: 1000,
          supportsWebRTC: true,
          supportsTCP: true,
          supportsIPFS: true,
          supportsTorrent: true,
        },
        metrics: {
          cacheHitRate: 0.85,
          avgLatencyMs: 25,
          bytesServed: 1073741824,
          activeConnections: 50,
          cacheUtilization: 0.75,
        },
        lastSeen: Date.now(),
        version: '1.0.0',
      }

      const result = validateEdgeNodeInfo(info)
      expect(result.nodeId).toBe('node-abc123')
      expect(result.capabilities.supportsIPFS).toBe(true)
    })

    test('rejects invalid cache hit rate', () => {
      const info = {
        nodeId: 'node-1',
        operator: '0x1234567890123456789012345678901234567890',
        endpoint: 'https://node.example.com',
        region: 'us-east-1',
        capabilities: {
          maxCacheSizeMb: 1024,
          maxBandwidthMbps: 100,
          supportsWebRTC: true,
          supportsTCP: true,
          supportsIPFS: false,
          supportsTorrent: false,
        },
        metrics: {
          cacheHitRate: 1.5, // > 1 is invalid
          avgLatencyMs: 25,
          bytesServed: 0,
          activeConnections: 0,
          cacheUtilization: 0,
        },
        lastSeen: Date.now(),
        version: '1.0.0',
      }

      expect(() => validateEdgeNodeInfo(info)).toThrow()
    })

    test('rejects invalid version format', () => {
      const info = {
        nodeId: 'node-1',
        operator: '0x1234567890123456789012345678901234567890',
        endpoint: 'https://node.example.com',
        region: 'us-east-1',
        capabilities: {
          maxCacheSizeMb: 1024,
          maxBandwidthMbps: 100,
          supportsWebRTC: true,
          supportsTCP: true,
          supportsIPFS: false,
          supportsTorrent: false,
        },
        metrics: {
          cacheHitRate: 0.5,
          avgLatencyMs: 25,
          bytesServed: 0,
          activeConnections: 0,
          cacheUtilization: 0,
        },
        lastSeen: Date.now(),
        version: 'v1.0', // Invalid format
      }

      expect(() => validateEdgeNodeInfo(info)).toThrow()
    })
  })
})

describe('Gossip Protocol', () => {
  interface GossipMessage {
    id: string
    type: 'announce' | 'request' | 'response' | 'heartbeat'
    origin: string
    ttl: number
    timestamp: number
    payload: unknown
  }

  function createGossipMessage(
    type: GossipMessage['type'],
    origin: string,
    payload: unknown,
  ): GossipMessage {
    return {
      id: crypto.randomUUID(),
      type,
      origin,
      ttl: 5,
      timestamp: Date.now(),
      payload,
    }
  }

  function shouldPropagate(msg: GossipMessage, seenIds: Set<string>): boolean {
    // Don't propagate if we've seen it
    if (seenIds.has(msg.id)) return false

    // Don't propagate if TTL exhausted
    if (msg.ttl <= 0) return false

    // Don't propagate if too old (> 5 minutes)
    if (Date.now() - msg.timestamp > 5 * 60 * 1000) return false

    return true
  }

  function decrementTtl(msg: GossipMessage): GossipMessage {
    return { ...msg, ttl: msg.ttl - 1 }
  }

  test('creates valid gossip message', () => {
    const msg = createGossipMessage('announce', 'node-1', { data: 'test' })

    expect(msg.type).toBe('announce')
    expect(msg.origin).toBe('node-1')
    expect(msg.ttl).toBe(5)
    expect(msg.id).toBeTruthy()
  })

  test('should propagate fresh message', () => {
    const msg = createGossipMessage('heartbeat', 'node-1', {})
    const seenIds = new Set<string>()

    expect(shouldPropagate(msg, seenIds)).toBe(true)
  })

  test('should not propagate seen message', () => {
    const msg = createGossipMessage('heartbeat', 'node-1', {})
    const seenIds = new Set([msg.id])

    expect(shouldPropagate(msg, seenIds)).toBe(false)
  })

  test('should not propagate zero TTL', () => {
    const msg = { ...createGossipMessage('heartbeat', 'node-1', {}), ttl: 0 }
    const seenIds = new Set<string>()

    expect(shouldPropagate(msg, seenIds)).toBe(false)
  })

  test('should not propagate old message', () => {
    const msg = {
      ...createGossipMessage('heartbeat', 'node-1', {}),
      timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    }
    const seenIds = new Set<string>()

    expect(shouldPropagate(msg, seenIds)).toBe(false)
  })

  test('decrements TTL correctly', () => {
    const msg = createGossipMessage('announce', 'node-1', {})
    expect(msg.ttl).toBe(5)

    const decremented = decrementTtl(msg)
    expect(decremented.ttl).toBe(4)
    expect(msg.ttl).toBe(5) // Original unchanged
  })
})

describe('Content Location', () => {
  interface ContentLocation {
    contentHash: string
    nodes: string[]
    lastUpdated: number
    size: number
    mimeType: string
  }

  function createContentLocation(
    contentHash: string,
    nodeId: string,
    size: number,
    mimeType: string,
  ): ContentLocation {
    return {
      contentHash,
      nodes: [nodeId],
      lastUpdated: Date.now(),
      size,
      mimeType,
    }
  }

  function addNodeToLocation(
    location: ContentLocation,
    nodeId: string,
  ): ContentLocation {
    if (location.nodes.includes(nodeId)) return location

    return {
      ...location,
      nodes: [...location.nodes, nodeId],
      lastUpdated: Date.now(),
    }
  }

  function selectBestNode(
    location: ContentLocation,
    nodeLatencies: Map<string, number>,
  ): string | null {
    if (location.nodes.length === 0) return null

    let bestNode: string | null = null
    let bestLatency = Infinity

    for (const nodeId of location.nodes) {
      const latency = nodeLatencies.get(nodeId) ?? Infinity
      if (latency < bestLatency) {
        bestLatency = latency
        bestNode = nodeId
      }
    }

    return bestNode
  }

  test('creates content location', () => {
    const location = createContentLocation(
      'abc123',
      'node-1',
      1024,
      'application/json',
    )

    expect(location.nodes).toEqual(['node-1'])
    expect(location.size).toBe(1024)
  })

  test('adds node to location', () => {
    const location = createContentLocation(
      'abc123',
      'node-1',
      1024,
      'text/plain',
    )
    const updated = addNodeToLocation(location, 'node-2')

    expect(updated.nodes).toEqual(['node-1', 'node-2'])
  })

  test('does not duplicate nodes', () => {
    const location = createContentLocation(
      'abc123',
      'node-1',
      1024,
      'text/plain',
    )
    const updated = addNodeToLocation(location, 'node-1')

    expect(updated.nodes).toEqual(['node-1'])
  })

  test('selects lowest latency node', () => {
    const location = createContentLocation(
      'abc123',
      'node-1',
      1024,
      'text/plain',
    )
    const updated = addNodeToLocation(
      addNodeToLocation(location, 'node-2'),
      'node-3',
    )

    const latencies = new Map([
      ['node-1', 100],
      ['node-2', 25],
      ['node-3', 50],
    ])

    const best = selectBestNode(updated, latencies)
    expect(best).toBe('node-2')
  })

  test('returns null for empty nodes', () => {
    const location: ContentLocation = {
      contentHash: 'abc123',
      nodes: [],
      lastUpdated: Date.now(),
      size: 1024,
      mimeType: 'text/plain',
    }

    const best = selectBestNode(location, new Map())
    expect(best).toBeNull()
  })
})

describe('Metrics Calculation', () => {
  interface MetricsState {
    cacheHits: number
    cacheMisses: number
    totalBytesServed: number
    latencySamples: number[]
  }

  function calculateCacheHitRate(state: MetricsState): number {
    const total = state.cacheHits + state.cacheMisses
    if (total === 0) return 0
    return state.cacheHits / total
  }

  function calculateAvgLatency(state: MetricsState): number {
    if (state.latencySamples.length === 0) return 0
    const sum = state.latencySamples.reduce((a, b) => a + b, 0)
    return sum / state.latencySamples.length
  }

  test('calculates cache hit rate correctly', () => {
    const state: MetricsState = {
      cacheHits: 80,
      cacheMisses: 20,
      totalBytesServed: 0,
      latencySamples: [],
    }

    expect(calculateCacheHitRate(state)).toBe(0.8)
  })

  test('returns 0 for no requests', () => {
    const state: MetricsState = {
      cacheHits: 0,
      cacheMisses: 0,
      totalBytesServed: 0,
      latencySamples: [],
    }

    expect(calculateCacheHitRate(state)).toBe(0)
  })

  test('calculates average latency', () => {
    const state: MetricsState = {
      cacheHits: 0,
      cacheMisses: 0,
      totalBytesServed: 0,
      latencySamples: [10, 20, 30, 40, 50],
    }

    expect(calculateAvgLatency(state)).toBe(30)
  })

  test('returns 0 for no latency samples', () => {
    const state: MetricsState = {
      cacheHits: 0,
      cacheMisses: 0,
      totalBytesServed: 0,
      latencySamples: [],
    }

    expect(calculateAvgLatency(state)).toBe(0)
  })
})
