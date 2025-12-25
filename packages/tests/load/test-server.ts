#!/usr/bin/env bun
/**
 * Test Server for Load Testing Verification
 *
 * A simple server that simulates various endpoints for load testing.
 * Run this to verify the load testing infrastructure works correctly.
 *
 * Usage: bun packages/tests/load/test-server.ts
 */

import { Elysia } from 'elysia'

const PORT = parseInt(process.env.PORT ?? '4099', 10)

// Simulated database with delay
const simulateDbQuery = (ms: number = 10) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// Random latency to simulate real-world conditions
const randomDelay = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min

/** A2A-style JSON-RPC request body */
interface A2ARequestBody {
  jsonrpc?: string
  method?: string
  id?: number
}

// Metrics tracking with per-endpoint stats
const metrics = {
  requests: 0,
  errors: 0,
  startTime: Date.now(),
  endpoints: new Map<
    string,
    { count: number; totalLatency: number; maxLatency: number }
  >(),
}

function trackEndpoint(path: string, latency: number) {
  const existing = metrics.endpoints.get(path) ?? {
    count: 0,
    totalLatency: 0,
    maxLatency: 0,
  }
  existing.count++
  existing.totalLatency += latency
  existing.maxLatency = Math.max(existing.maxLatency, latency)
  metrics.endpoints.set(path, existing)
}

const app = new Elysia()
  // Request counting middleware
  .onRequest(() => {
    metrics.requests++
  })

  // Health check (fast)
  .get('/health', () => ({
    status: 'healthy',
    service: 'load-test-server',
    timestamp: new Date().toISOString(),
  }))

  // Root info
  .get('/', () => ({
    name: 'Load Test Server',
    version: '1.0.0',
    description: 'Test server for verifying load testing infrastructure',
    endpoints: {
      health: '/health',
      api: '/api/*',
      metrics: '/metrics',
    },
  }))

  // Metrics endpoint with per-endpoint breakdown
  .get('/metrics', () => {
    const uptime = (Date.now() - metrics.startTime) / 1000

    // Build endpoint stats sorted by count (most hit first)
    const endpointStats = Array.from(metrics.endpoints.entries())
      .map(([path, stats]) => ({
        path,
        count: stats.count,
        avgLatency:
          stats.count > 0 ? (stats.totalLatency / stats.count).toFixed(2) : '0',
        maxLatency: stats.maxLatency.toFixed(2),
        hitRate: ((stats.count / metrics.requests) * 100).toFixed(1),
      }))
      .sort((a, b) => b.count - a.count)

    // Find slowest endpoints (by avg latency)
    const slowest = [...endpointStats]
      .sort((a, b) => parseFloat(b.avgLatency) - parseFloat(a.avgLatency))
      .slice(0, 5)

    // Find hottest endpoints (most requests)
    const hottest = endpointStats.slice(0, 5)

    return {
      summary: {
        requests: metrics.requests,
        errors: metrics.errors,
        uptime: `${uptime.toFixed(1)}s`,
        rps: (metrics.requests / uptime).toFixed(2),
      },
      hottest,
      slowest,
      allEndpoints: endpointStats,
    }
  })

  // Fast endpoint (< 10ms)
  .get('/api/fast', async () => {
    const start = performance.now()
    await simulateDbQuery(randomDelay(1, 5))
    trackEndpoint('/api/fast', performance.now() - start)
    return { data: 'fast response', latency: 'low' }
  })

  // Medium endpoint (10-50ms)
  .get('/api/medium', async () => {
    const start = performance.now()
    await simulateDbQuery(randomDelay(10, 50))
    trackEndpoint('/api/medium', performance.now() - start)
    return { data: 'medium response', latency: 'medium' }
  })

  // Slow endpoint (50-200ms)
  .get('/api/slow', async () => {
    const start = performance.now()
    await simulateDbQuery(randomDelay(50, 200))
    trackEndpoint('/api/slow', performance.now() - start)
    return { data: 'slow response', latency: 'high' }
  })

  // Variable endpoint (simulates real workloads)
  .get('/api/variable', async () => {
    const start = performance.now()
    const dice = Math.random()
    if (dice < 0.7) {
      await simulateDbQuery(randomDelay(5, 20))
    } else if (dice < 0.95) {
      await simulateDbQuery(randomDelay(20, 100))
    } else {
      await simulateDbQuery(randomDelay(100, 500))
    }
    trackEndpoint('/api/variable', performance.now() - start)
    return { data: 'variable response' }
  })

  // CPU-intensive endpoint
  .get('/api/compute', () => {
    const start = performance.now()
    let sum = 0
    for (let i = 0; i < 100000; i++) {
      sum += Math.sqrt(i)
    }
    trackEndpoint('/api/compute', performance.now() - start)
    return { computed: sum }
  })

  // List endpoint (simulates database query)
  .get('/api/items', async () => {
    const start = performance.now()
    await simulateDbQuery(randomDelay(20, 80))
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      value: Math.random() * 1000,
    }))
    trackEndpoint('/api/items', performance.now() - start)
    return { items, count: items.length }
  })

  // Search endpoint
  .get('/api/search', async ({ query }) => {
    const start = performance.now()
    await simulateDbQuery(randomDelay(30, 100))
    const q = query.q ?? ''
    trackEndpoint('/api/search', performance.now() - start)
    return {
      query: q,
      results: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        title: `Result ${i + 1} for "${q}"`,
        score: Math.random(),
      })),
    }
  })

  // Stats endpoint
  .get('/api/stats', async () => {
    const start = performance.now()
    await simulateDbQuery(randomDelay(10, 30))
    trackEndpoint('/api/stats', performance.now() - start)
    return {
      totalUsers: 12345,
      activeUsers: 567,
      transactions: 89012,
      volume: '1234567.89',
    }
  })

  // Reliable endpoint
  .get('/api/reliable', async () => {
    const start = performance.now()
    await simulateDbQuery(randomDelay(10, 50))
    trackEndpoint('/api/reliable', performance.now() - start)
    return { status: 'ok', reliable: true }
  })

  // POST endpoint
  .post('/api/submit', async ({ body }) => {
    await simulateDbQuery(randomDelay(20, 60))
    return {
      received: body,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
  })

  // A2A-style endpoint
  .post('/a2a', async ({ body }) => {
    await simulateDbQuery(randomDelay(10, 30))
    const request = body as A2ARequestBody
    return {
      jsonrpc: '2.0',
      id: request.id ?? 1,
      result: {
        message: 'A2A response',
        method: request.method,
      },
    }
  })

  // MCP-style endpoint
  .post('/mcp/resources/list', async () => {
    await simulateDbQuery(randomDelay(5, 20))
    return {
      resources: [
        { name: 'resource1', uri: 'test://resource1' },
        { name: 'resource2', uri: 'test://resource2' },
      ],
    }
  })

  // Error handler
  .onError(({ error }) => {
    return { error: error.message }
  })

console.log(`
══════════════════════════════════════════════════════════════════════
  LOAD TEST SERVER
══════════════════════════════════════════════════════════════════════
  Port: ${PORT}
  Endpoints:
    /health         - Health check (fast)
    /api/fast       - Fast response (1-5ms)
    /api/medium     - Medium response (10-50ms)
    /api/slow       - Slow response (50-200ms)
    /api/variable   - Variable latency (mixed)
    /api/compute    - CPU intensive
    /api/items      - List items (DB sim)
    /api/search     - Search endpoint (DB sim)
    /api/stats      - Statistics
    /api/reliable   - Reliable endpoint
    /a2a            - A2A protocol
    /mcp/*          - MCP endpoints
    /metrics        - Endpoint stats (hottest/slowest)
══════════════════════════════════════════════════════════════════════
`)

app.listen(PORT, () => {
  console.log(`🚀 Test server running at http://localhost:${PORT}`)
  console.log(`   Health: http://localhost:${PORT}/health`)
  console.log(`   Metrics: http://localhost:${PORT}/metrics`)
})

export { app }
