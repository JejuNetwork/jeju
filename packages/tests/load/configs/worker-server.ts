/**
 * Load Test Configuration for Worker-Compatible Server
 *
 * This tests the worker server which uses distributed caching
 * instead of in-memory caching. This is the realistic test for
 * serverless deployments.
 */

import type { AppLoadTestConfig } from '../types'

export const workerServerConfig: AppLoadTestConfig = {
  name: 'worker-server',
  description: 'Worker-compatible server with distributed caching',
  baseUrl: 'http://localhost:4097',
  port: 4097,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/api/fast', method: 'GET', weight: 20 },
    { path: '/api/medium', method: 'GET', weight: 15 },
    { path: '/api/slow', method: 'GET', weight: 5 },
    { path: '/api/variable', method: 'GET', weight: 15 },
    { path: '/api/reliable', method: 'GET', weight: 20 },
    { path: '/api/compute', method: 'GET', weight: 5 },
    { path: '/api/items', method: 'GET', weight: 10 },
    { path: '/api/search?q=test', method: 'GET', weight: 5 },
    { path: '/api/stats', method: 'GET', weight: 5 },
  ],
  thresholds: {
    // Distributed cache adds some latency
    p50Latency: 25,
    p95Latency: 75,
    p99Latency: 150,
    errorRate: 1, // Allow 1% errors for cache misses during stress
    minRps: 1000,
  },
}
