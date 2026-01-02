/**
 * Node Management Router
 *
 * Manages DWS compute node registration, status, and configuration.
 */

import { Elysia } from 'elysia'

export function createNodeRouter() {
  const startTime = Date.now()

  return new Elysia({ prefix: '/v1/nodes' })
    .get('/', () => {
      // Currently no nodes registered in this router - node discovery happens via identity registry
      return {
        nodes: [],
        count: 0,
        message: 'Use /health/detailed for full node discovery',
      }
    })
    .get('/health', () => {
      // Basic process health check
      const uptimeMs = Date.now() - startTime
      const memUsage = process.memoryUsage()
      return {
        status: 'healthy',
        uptimeMs,
        memory: {
          heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
          rssMb: Math.round(memUsage.rss / 1024 / 1024),
        },
      }
    })
}
