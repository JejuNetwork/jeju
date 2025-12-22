/**
 * Load Test Configuration for Cached Test Server
 *
 * Compare performance against the standard test-server to measure
 * the impact of caching.
 */

import type { AppLoadTestConfig } from '../types'

export const cachedServerConfig: AppLoadTestConfig = {
  name: 'cached-server',
  description: 'Test server with DWS-style caching',
  baseUrl: 'http://localhost:4098',
  port: 4098,
  healthEndpoint: '/health',
  endpoints: [
    // Fast endpoint (no caching needed)
    {
      path: '/api/fast',
      method: 'GET',
      weight: 0.2,
    },
    // Medium endpoint - should be faster with caching
    {
      path: '/api/medium',
      method: 'GET',
      weight: 0.15,
    },
    // Slow endpoint - aggressive caching should help significantly
    {
      path: '/api/slow',
      method: 'GET',
      weight: 0.05,
    },
    // Variable endpoint - caching should reduce variance
    {
      path: '/api/variable',
      method: 'GET',
      weight: 0.15,
    },
    // Compute endpoint - memoization critical here
    {
      path: '/api/compute',
      method: 'GET',
      weight: 0.1,
    },
    // Items endpoint - page-based caching
    {
      path: '/api/items',
      method: 'GET',
      weight: 0.1,
    },
    // Search endpoint - query-based caching
    {
      path: '/api/search?q=test',
      method: 'GET',
      weight: 0.1,
    },
    // Stats endpoint - short TTL cache
    {
      path: '/api/stats',
      method: 'GET',
      weight: 0.1,
    },
    // Reliable endpoint
    {
      path: '/api/reliable',
      method: 'GET',
      weight: 0.05,
    },
  ],
  thresholds: {
    p50Latency: 20, // Stricter with caching
    p95Latency: 50,
    p99Latency: 100,
    errorRate: 0,
    minRps: 500, // Expect higher RPS with caching
  },
}

