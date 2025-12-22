/**
 * Load Test Configuration for Test Server
 *
 * Used to verify the load testing infrastructure works correctly.
 */

import type { AppLoadTestConfig } from '../types'

export const testServerConfig: AppLoadTestConfig = {
  name: 'test-server',
  description: 'Load test verification server',
  baseUrl: 'http://localhost:4099',
  port: 4099,
  healthEndpoint: '/health',
  endpoints: [
    { path: '/health', method: 'GET', weight: 0.1, expectedStatus: [200] },
    { path: '/', method: 'GET', weight: 0.05, expectedStatus: [200] },
    { path: '/api/fast', method: 'GET', weight: 0.2, expectedStatus: [200] },
    { path: '/api/medium', method: 'GET', weight: 0.15, expectedStatus: [200] },
    { path: '/api/slow', method: 'GET', weight: 0.05, expectedStatus: [200] },
    {
      path: '/api/variable',
      method: 'GET',
      weight: 0.15,
      expectedStatus: [200],
    },
    { path: '/api/items', method: 'GET', weight: 0.1, expectedStatus: [200] },
    {
      path: '/api/search?q=test',
      method: 'GET',
      weight: 0.1,
      expectedStatus: [200],
    },
    { path: '/api/stats', method: 'GET', weight: 0.05, expectedStatus: [200] },
    {
      path: '/api/reliable',
      method: 'GET',
      weight: 0.05,
      expectedStatus: [200],
    },
  ],
  thresholds: {
    p50Latency: 50,
    p95Latency: 150,
    p99Latency: 300,
    errorRate: 0.01, // Very low error tolerance - no flaky endpoints
    minRps: 100,
  },
}
