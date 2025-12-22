/**
 * the network Standard Health Check Middleware
 *
 * Drop-in middleware for Elysia apps to implement the standard health check API.
 * This enables automatic monitoring and recovery via the KeepaliveRegistry.
 *
 * Usage:
 *   import { healthMiddleware } from '@jejunetwork/shared';
 *
 *   const app = new Elysia();
 *   app.use(healthMiddleware({
 *     service: 'my-app',
 *     version: '1.0.0',
 *     dependencies: [
 *       { name: 'database', type: 'database', check: async () => dbClient.ping() },
 *       { name: 'redis', type: 'cache', check: async () => redisClient.ping() },
 *     ],
 *   }));
 */

// Re-export consolidated HealthStatus
import type { HealthStatus } from '@jejunetwork/types'
import { Elysia } from 'elysia'
export type { HealthStatus }
type DependencyType =
  | 'database'
  | 'cache'
  | 'api'
  | 'blockchain'
  | 'ipfs'
  | 'storage'
  | 'compute'
  | 'trigger'

interface DependencyConfig {
  name: string
  type: DependencyType
  check: () => Promise<boolean>
  required?: boolean
}

interface ResourceConfig {
  type: string
  identifier: string
  required?: boolean
  check?: () => Promise<boolean>
}

interface FundingConfig {
  vaultAddress: string
  minRequired: bigint
  getCurrentBalance: () => Promise<bigint>
  autoFundEnabled?: boolean
}

interface HealthMiddlewareConfig {
  service: string
  version: string
  dependencies?: DependencyConfig[]
  resources?: ResourceConfig[]
  funding?: FundingConfig
}

// Re-export consolidated HealthResponse
import type { HealthResponse } from '@jejunetwork/types'
export type { HealthResponse }

interface DependencyHealth {
  name: string
  type: DependencyType
  status: HealthStatus
  latencyMs?: number
  error?: string
}

interface ReadinessResponse {
  ready: boolean
  status: HealthStatus
  dependencies: DependencyHealth[]
}

interface LivenessResponse {
  alive: boolean
  pid: number
  memoryUsage: {
    heapUsed: number
    heapTotal: number
    rss: number
  }
}

interface ResourceHealth {
  type: string
  identifier: string
  status: HealthStatus
  required: boolean
  lastCheck: string
  latencyMs?: number
  error?: string
}

interface ResourceHealthResponse {
  status: HealthStatus
  resources: ResourceHealth[]
  funding: {
    funded: boolean
    balance: string
    minRequired: string
    vaultAddress: string
    autoFundEnabled: boolean
  }
}

const startTime = Date.now()

export function healthMiddleware(config: HealthMiddlewareConfig) {
  return new Elysia({ prefix: '/health' })
    // GET /health - Basic health check
    .get('/', async ({ set }) => {
      let status: HealthStatus = 'healthy'

      // Quick check of critical dependencies
      if (config.dependencies) {
        const criticalDeps = config.dependencies.filter(
          (d) => d.required !== false,
        )
        for (const dep of criticalDeps) {
          const isHealthy = await dep.check().catch(() => false)
          if (!isHealthy) {
            status = 'unhealthy'
            break
          }
        }
      }

      const response: HealthResponse = {
        status,
        service: config.service,
        version: config.version,
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
      }

      if (status !== 'healthy') {
        set.status = 503
      }

      return response
    })

    // GET /health/ready - Readiness check with dependency details
    .get('/ready', async ({ set }) => {
      const dependencies: DependencyHealth[] = []
      let overallStatus: HealthStatus = 'healthy'
      let ready = true

      if (config.dependencies) {
        for (const dep of config.dependencies) {
          const start = Date.now()
          let depStatus: HealthStatus = 'healthy'
          let error: string | undefined

          const isHealthy = await dep.check().catch((e) => {
            error = e instanceof Error ? e.message : String(e)
            return false
          })

          if (!isHealthy) {
            depStatus = 'unhealthy'
            if (dep.required !== false) {
              overallStatus = 'unhealthy'
              ready = false
            } else if (overallStatus === 'healthy') {
              overallStatus = 'degraded'
            }
          }

          dependencies.push({
            name: dep.name,
            type: dep.type,
            status: depStatus,
            latencyMs: Date.now() - start,
            error,
          })
        }
      }

      const response: ReadinessResponse = {
        ready,
        status: overallStatus,
        dependencies,
      }

      if (!ready) {
        set.status = 503
      }

      return response
    })

    // GET /health/live - Liveness check (is the process alive?)
    .get('/live', () => {
      const mem = process.memoryUsage()

      const response: LivenessResponse = {
        alive: true,
        pid: process.pid,
        memoryUsage: {
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          rss: mem.rss,
        },
      }

      return response
    })

    // GET /health/resources - Resource-level health with funding status
    .get('/resources', async ({ set }) => {
      const resources: ResourceHealth[] = []
      let overallStatus: HealthStatus = 'healthy'

      // Check resources
      if (config.resources) {
        for (const res of config.resources) {
          const start = Date.now()
          let resStatus: HealthStatus = 'healthy'
          let error: string | undefined

          if (res.check) {
            const isHealthy = await res.check().catch((e) => {
              error = e instanceof Error ? e.message : String(e)
              return false
            })

            if (!isHealthy) {
              resStatus = 'unhealthy'
              if (res.required !== false) {
                overallStatus = 'unhealthy'
              } else if (overallStatus === 'healthy') {
                overallStatus = 'degraded'
              }
            }
          }

          resources.push({
            type: res.type,
            identifier: res.identifier,
            status: resStatus,
            required: res.required !== false,
            lastCheck: new Date().toISOString(),
            latencyMs: Date.now() - start,
            error,
          })
        }
      }

      // Check funding
      let balance = 0n
      let funded = true

      if (config.funding) {
        balance = await config.funding.getCurrentBalance().catch(() => 0n)
        funded = balance >= config.funding.minRequired

        if (!funded) {
          overallStatus = 'unfunded'
        }
      }

      const response: ResourceHealthResponse = {
        status: overallStatus,
        resources,
        funding: {
          funded,
          balance: balance.toString(),
          minRequired: config.funding?.minRequired.toString() ?? '0',
          vaultAddress: config.funding?.vaultAddress ?? '0x0',
          autoFundEnabled: config.funding?.autoFundEnabled ?? false,
        },
      }

      if (overallStatus !== 'healthy') {
        set.status = 503
      }

      return response
    })
}

/**
 * Create a simple health check for common services
 */
export const healthChecks = {
  /**
   * Check if a URL responds with 2xx
   */
  http:
    (url: string, timeout = 5000) =>
    async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)

      return response.ok
    },

  /**
   * Check if RPC responds to eth_blockNumber
   */
  rpc: (url: string) => async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    })

    if (!response.ok) return false

    const json = await response.json()
    return !!json.result
  },

  /**
   * Check if IPFS gateway is accessible
   */
  ipfs: (gatewayUrl: string) => async () => {
    const response = await fetch(`${gatewayUrl}/api/v0/id`, {
      method: 'POST',
    }).catch(() => null)

    return !!response?.ok
  },
}

export default healthMiddleware
