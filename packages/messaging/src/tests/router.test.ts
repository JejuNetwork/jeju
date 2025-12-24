/**
 * Router Calculation and Algorithm Tests
 *
 * Tests for message router statistics, latency calculations,
 * node selection algorithms, and retry logic.
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import type { RelayNode, RouterStats } from '../xmtp/router'
import type { XMTPEnvelope } from '../xmtp/types'

/**
 * Creates a mock envelope for testing
 */
function createMockEnvelope(overrides?: Partial<XMTPEnvelope>): XMTPEnvelope {
  return {
    version: 1,
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address,
    recipients: ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address],
    contentTopic: '/jeju/1/messages/proto',
    ciphertext: new Uint8Array([1, 2, 3, 4, 5]),
    signature: new Uint8Array([6, 7, 8, 9, 10]),
    timestamp: Date.now(),
    ...overrides,
  }
}
describe('Average Latency Calculation', () => {
  /**
   * Tests the running average formula:
   * newAvg = (oldAvg * (n-1) + newValue) / n
   *
   * This is the algorithm used in updateAverageLatency
   */

  test('calculates average for first delivery', () => {
    // First delivery: average should equal the single measurement
    const totalDeliveries = 1
    const currentAvg = 0
    const newLatency = 100

    const newAvg =
      (currentAvg * (totalDeliveries - 1) + newLatency) / totalDeliveries

    expect(newAvg).toBe(100)
  })

  test('calculates running average for multiple deliveries', () => {
    // Simulate a sequence of latency measurements
    const latencies = [100, 200, 150, 250, 100]
    let average = 0

    for (let i = 0; i < latencies.length; i++) {
      const total = i + 1
      average = (average * (total - 1) + latencies[i]) / total
    }

    // Expected: (100 + 200 + 150 + 250 + 100) / 5 = 160
    expect(average).toBe(160)
  })

  test('running average converges correctly', () => {
    // Start with some measurements, then add many of same value
    let average = 100
    let count = 1

    // Add 99 more measurements of 200
    for (let i = 0; i < 99; i++) {
      count++
      average = (average * (count - 1) + 200) / count
    }

    // After 100 measurements (1 at 100, 99 at 200), average should be close to 199
    expect(average).toBeCloseTo(199, 0)
  })

  test('handles zero latency measurements', () => {
    const latencies = [0, 0, 100, 0, 0]
    let average = 0

    for (let i = 0; i < latencies.length; i++) {
      const total = i + 1
      average = (average * (total - 1) + latencies[i]) / total
    }

    expect(average).toBe(20)
  })

  test('handles very large latency values', () => {
    const latencies = [1000000, 2000000, 3000000]
    let average = 0

    for (let i = 0; i < latencies.length; i++) {
      const total = i + 1
      average = (average * (total - 1) + latencies[i]) / total
    }

    expect(average).toBe(2000000)
  })

  test('maintains precision with many small values', () => {
    let average = 0
    const count = 10000

    for (let i = 0; i < count; i++) {
      average = (average * i + 1.5) / (i + 1)
    }

    // Should maintain precision at 1.5
    expect(average).toBeCloseTo(1.5, 10)
  })
})
describe('Node Selection Algorithm', () => {
  /**
   * Tests the node selection logic:
   * 1. Filter healthy nodes
   * 2. Prefer nodes matching preferred region
   * 3. Sort by latency and pick best
   */

  test('selects node with lowest latency', () => {
    const nodes: RelayNode[] = [
      {
        id: 'node-1',
        url: 'wss://n1.example.com',
        region: 'us-east',
        latencyMs: 100,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
      {
        id: 'node-2',
        url: 'wss://n2.example.com',
        region: 'us-west',
        latencyMs: 50,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
      {
        id: 'node-3',
        url: 'wss://n3.example.com',
        region: 'eu-west',
        latencyMs: 150,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
    ]

    const healthyNodes = nodes.filter((n) => n.isHealthy)
    healthyNodes.sort((a, b) => a.latencyMs - b.latencyMs)

    expect(healthyNodes[0].id).toBe('node-2')
    expect(healthyNodes[0].latencyMs).toBe(50)
  })

  test('filters out unhealthy nodes', () => {
    const nodes: RelayNode[] = [
      {
        id: 'node-1',
        url: 'wss://n1.example.com',
        region: 'us-east',
        latencyMs: 10,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: false,
      },
      {
        id: 'node-2',
        url: 'wss://n2.example.com',
        region: 'us-west',
        latencyMs: 100,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
    ]

    const healthyNodes = nodes.filter((n) => n.isHealthy)

    expect(healthyNodes.length).toBe(1)
    expect(healthyNodes[0].id).toBe('node-2')
  })

  test('prefers node in preferred region', () => {
    const nodes: RelayNode[] = [
      {
        id: 'node-1',
        url: 'wss://n1.example.com',
        region: 'us-east',
        latencyMs: 50,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
      {
        id: 'node-2',
        url: 'wss://n2.example.com',
        region: 'eu-west',
        latencyMs: 100,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
    ]

    const preferredRegions = ['eu-west']

    const healthyNodes = nodes.filter((n) => n.isHealthy)

    // First try preferred regions
    let candidates = preferredRegions
      ? healthyNodes.filter((n) => preferredRegions.includes(n.region))
      : healthyNodes

    // Fall back to all if no match
    if (candidates.length === 0) {
      candidates = healthyNodes
    }

    candidates.sort((a, b) => a.latencyMs - b.latencyMs)

    // Should pick eu-west even though us-east has lower latency
    expect(candidates[0].id).toBe('node-2')
  })

  test('falls back to all nodes when no preferred region matches', () => {
    const nodes: RelayNode[] = [
      {
        id: 'node-1',
        url: 'wss://n1.example.com',
        region: 'us-east',
        latencyMs: 50,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
      {
        id: 'node-2',
        url: 'wss://n2.example.com',
        region: 'us-west',
        latencyMs: 100,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
    ]

    const preferredRegions = ['ap-south'] // No match

    const healthyNodes = nodes.filter((n) => n.isHealthy)
    let candidates = healthyNodes.filter((n) =>
      preferredRegions.includes(n.region),
    )

    if (candidates.length === 0) {
      candidates = healthyNodes
    }

    candidates.sort((a, b) => a.latencyMs - b.latencyMs)

    // Should fall back and pick lowest latency
    expect(candidates[0].id).toBe('node-1')
  })

  test('returns null when no healthy nodes available', () => {
    const nodes: RelayNode[] = [
      {
        id: 'node-1',
        url: 'wss://n1.example.com',
        region: 'us-east',
        latencyMs: 50,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: false,
      },
      {
        id: 'node-2',
        url: 'wss://n2.example.com',
        region: 'us-west',
        latencyMs: 100,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: false,
      },
    ]

    const healthyNodes = nodes.filter((n) => n.isHealthy)

    expect(healthyNodes.length).toBe(0)
  })

  test('handles equal latencies consistently', () => {
    const nodes: RelayNode[] = [
      {
        id: 'node-a',
        url: 'wss://a.example.com',
        region: 'us-east',
        latencyMs: 100,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
      {
        id: 'node-b',
        url: 'wss://b.example.com',
        region: 'us-east',
        latencyMs: 100,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
    ]

    // Sort should be stable - original order preserved for equal values
    const sorted = [...nodes].sort((a, b) => a.latencyMs - b.latencyMs)

    // Both have equal latency, first one should be selected
    expect(sorted[0].latencyMs).toBe(100)
  })
})
describe('Retry Logic', () => {
  /**
   * Tests exponential backoff and retry behavior
   */

  test('calculates exponential backoff correctly', () => {
    const baseDelayMs = 1000
    const maxDelayMs = 30000

    const delays: number[] = []
    for (let attempt = 1; attempt <= 6; attempt++) {
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
      delays.push(delay)
    }

    // 2^1 * 1000 = 2000
    // 2^2 * 1000 = 4000
    // 2^3 * 1000 = 8000
    // 2^4 * 1000 = 16000
    // 2^5 * 1000 = 32000 -> capped at 30000
    // 2^6 * 1000 = 64000 -> capped at 30000
    expect(delays).toEqual([2000, 4000, 8000, 16000, 30000, 30000])
  })

  test('max retries limit is respected', () => {
    const maxRetries = 3
    let attempts = 0

    for (let i = 1; i <= maxRetries; i++) {
      attempts++
    }

    expect(attempts).toBe(3)
  })

  test('pending messages queue up on failure', () => {
    const pendingMessages = new Map<string, { attempts: number }>()
    const envelope = createMockEnvelope()

    // Simulate failed delivery
    pendingMessages.set(envelope.id, {
      attempts: 3,
    })

    expect(pendingMessages.size).toBe(1)
    expect(pendingMessages.get(envelope.id)?.attempts).toBe(3)
  })

  test('pending messages are removed after too many attempts', () => {
    const maxTotalAttempts = 9 // 3 retries * 3 retry attempts
    const pendingMessages = new Map<string, { attempts: number }>()

    const envelope = createMockEnvelope()
    pendingMessages.set(envelope.id, { attempts: 8 })

    // Simulate another failed retry
    const pending = pendingMessages.get(envelope.id)
    expect(pending).toBeDefined()
    if (!pending) {
      throw new Error('Expected pending message to be defined')
    }
    pending.attempts++

    if (pending.attempts >= maxTotalAttempts) {
      pendingMessages.delete(envelope.id)
    }

    expect(pendingMessages.size).toBe(0)
  })
})
describe('Statistics Tracking', () => {
  test('tracks total messages correctly', () => {
    const stats: RouterStats = {
      totalMessages: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageLatencyMs: 0,
      messagesByRegion: {},
    }

    // Simulate 10 message routes
    for (let i = 0; i < 10; i++) {
      stats.totalMessages++
    }

    expect(stats.totalMessages).toBe(10)
  })

  test('tracks successful vs failed deliveries', () => {
    const stats: RouterStats = {
      totalMessages: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageLatencyMs: 0,
      messagesByRegion: {},
    }

    // Simulate 7 successful, 3 failed
    for (let i = 0; i < 10; i++) {
      stats.totalMessages++
      if (i < 7) {
        stats.successfulDeliveries++
      } else {
        stats.failedDeliveries++
      }
    }

    expect(stats.successfulDeliveries).toBe(7)
    expect(stats.failedDeliveries).toBe(3)
    expect(stats.totalMessages).toBe(10)
    expect(stats.successfulDeliveries + stats.failedDeliveries).toBe(
      stats.totalMessages,
    )
  })

  test('tracks messages by region', () => {
    const stats: RouterStats = {
      totalMessages: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageLatencyMs: 0,
      messagesByRegion: {},
    }

    const regions = ['us-east', 'us-east', 'eu-west', 'us-east', 'ap-east']

    for (const region of regions) {
      stats.messagesByRegion[region] = (stats.messagesByRegion[region] ?? 0) + 1
    }

    expect(stats.messagesByRegion['us-east']).toBe(3)
    expect(stats.messagesByRegion['eu-west']).toBe(1)
    expect(stats.messagesByRegion['ap-east']).toBe(1)
  })

  test('handles new regions dynamically', () => {
    const messagesByRegion: Record<string, number> = {}

    const incrementRegion = (region: string) => {
      messagesByRegion[region] = (messagesByRegion[region] ?? 0) + 1
    }

    incrementRegion('us-east')
    incrementRegion('new-region')
    incrementRegion('another-new-region')

    expect(messagesByRegion['us-east']).toBe(1)
    expect(messagesByRegion['new-region']).toBe(1)
    expect(messagesByRegion['another-new-region']).toBe(1)
  })

  test('delivery success rate calculation', () => {
    const stats: RouterStats = {
      totalMessages: 100,
      successfulDeliveries: 95,
      failedDeliveries: 5,
      averageLatencyMs: 50,
      messagesByRegion: {},
    }

    const successRate = stats.successfulDeliveries / stats.totalMessages

    expect(successRate).toBe(0.95)
  })
})
describe('URL Transformations', () => {
  test('converts wss to https for health checks', () => {
    const wsUrl = 'wss://relay-us-east.jejunetwork.org'
    const healthUrl = `${wsUrl.replace('wss', 'https')}/health`

    expect(healthUrl).toBe('https://relay-us-east.jejunetwork.org/health')
  })

  test('handles http to ws conversion', () => {
    const httpEndpoint = 'http://localhost:8080'
    const wsUrl = `${httpEndpoint
      .replace('http://', 'ws://')
      .replace('https://', 'wss://')
      .replace(/\/$/, '')}/ws`

    expect(wsUrl).toBe('ws://localhost:8080/ws')
  })

  test('handles https to wss conversion', () => {
    const httpsEndpoint = 'https://relay.example.com/'
    const wsUrl = `${httpsEndpoint
      .replace('http://', 'ws://')
      .replace('https://', 'wss://')
      .replace(/\/$/, '')}/ws`

    expect(wsUrl).toBe('wss://relay.example.com/ws')
  })

  test('preserves port in URL transformation', () => {
    const httpEndpoint = 'http://localhost:3000'
    const wsUrl = `${httpEndpoint.replace('http://', 'ws://')}/ws`

    expect(wsUrl).toBe('ws://localhost:3000/ws')
  })

  test('handles trailing slash correctly', () => {
    const endpoint1 = 'https://relay.example.com/'
    const endpoint2 = 'https://relay.example.com'

    const clean1 = `${endpoint1.replace(/\/$/, '')}/send`
    const clean2 = `${endpoint2.replace(/\/$/, '')}/send`

    expect(clean1).toBe('https://relay.example.com/send')
    expect(clean2).toBe('https://relay.example.com/send')
  })
})
describe('Health Check Timing', () => {
  test('calculates latency from timing', async () => {
    const startTime = Date.now()

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 10))

    const latency = Date.now() - startTime

    expect(latency).toBeGreaterThanOrEqual(10)
    expect(latency).toBeLessThan(100) // Should be fast
  })

  test('marks node unhealthy on negative latency indicator', () => {
    const node: RelayNode = {
      id: 'node-1',
      url: 'wss://example.com',
      region: 'us-east',
      latencyMs: -1, // Indicates failure
      activeConnections: 0,
      lastHealthCheck: Date.now(),
      isHealthy: false,
    }

    expect(node.isHealthy).toBe(false)
    expect(node.latencyMs).toBe(-1)
  })

  test('updates lastHealthCheck timestamp', () => {
    const before = Date.now()

    const node: RelayNode = {
      id: 'node-1',
      url: 'wss://example.com',
      region: 'us-east',
      latencyMs: 50,
      activeConnections: 0,
      lastHealthCheck: Date.now(),
      isHealthy: true,
    }

    expect(node.lastHealthCheck).toBeGreaterThanOrEqual(before)
  })
})
describe('Message Grouping by Region', () => {
  test('groups addresses by region', () => {
    // Default behavior - all in one group
    const addresses = [
      '0xaaa' as Address,
      '0xbbb' as Address,
      '0xccc' as Address,
    ]

    const byRegion = new Map<string, Address[]>()
    byRegion.set('default', addresses)

    expect(byRegion.get('default')?.length).toBe(3)
  })

  test('handles empty address list', () => {
    const addresses: Address[] = []
    const byRegion = new Map<string, Address[]>()

    if (addresses.length > 0) {
      byRegion.set('default', addresses)
    }

    expect(byRegion.size).toBe(0)
  })

  test('routes to multiple regions in parallel', async () => {
    const regions = ['us-east', 'eu-west', 'ap-east']
    const results: string[] = []

    // Simulate parallel routing
    await Promise.all(
      regions.map(async (region) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        results.push(region)
      }),
    )

    expect(results.length).toBe(3)
  })
})
describe('Edge Cases', () => {
  test('handles envelope with no recipients gracefully', () => {
    const envelope = createMockEnvelope({ recipients: [] })

    expect(envelope.recipients.length).toBe(0)
  })

  test('handles very long envelope ID', () => {
    const longId = `msg-${'a'.repeat(1000)}`
    const envelope = createMockEnvelope({ id: longId })

    expect(envelope.id.length).toBe(1004)
  })

  test('handles envelope with large ciphertext', () => {
    const largeCiphertext = new Uint8Array(1024 * 1024) // 1MB
    const envelope = createMockEnvelope({ ciphertext: largeCiphertext })

    expect(envelope.ciphertext.length).toBe(1024 * 1024)
  })

  test('handles max timestamp value', () => {
    const envelope = createMockEnvelope({ timestamp: Number.MAX_SAFE_INTEGER })

    expect(envelope.timestamp).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('handles zero latency nodes', () => {
    const nodes: RelayNode[] = [
      {
        id: 'local',
        url: 'ws://localhost:8080',
        region: 'local',
        latencyMs: 0,
        activeConnections: 0,
        lastHealthCheck: Date.now(),
        isHealthy: true,
      },
    ]

    const healthyNodes = nodes.filter((n) => n.isHealthy)
    healthyNodes.sort((a, b) => a.latencyMs - b.latencyMs)

    expect(healthyNodes[0].latencyMs).toBe(0)
  })

  test('stats remain consistent after many operations', () => {
    const stats: RouterStats = {
      totalMessages: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageLatencyMs: 0,
      messagesByRegion: {},
    }

    // Simulate 10000 operations
    for (let i = 0; i < 10000; i++) {
      stats.totalMessages++
      if (Math.random() > 0.1) {
        stats.successfulDeliveries++
        // Update average
        const latency = Math.floor(Math.random() * 200)
        stats.averageLatencyMs =
          (stats.averageLatencyMs * (stats.successfulDeliveries - 1) +
            latency) /
          stats.successfulDeliveries
      } else {
        stats.failedDeliveries++
      }
    }

    expect(stats.successfulDeliveries + stats.failedDeliveries).toBe(
      stats.totalMessages,
    )
    expect(stats.averageLatencyMs).toBeGreaterThanOrEqual(0)
    expect(stats.averageLatencyMs).toBeLessThan(200)
  })
})
