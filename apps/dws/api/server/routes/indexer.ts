/**
 * Indexer Proxy Routes
 * Routes requests to available indexer nodes for decentralized data access
 *
 * Supports:
 * - GraphQL proxy with failover
 * - REST API proxy
 * - Health-based node selection
 */

import {
  getCurrentNetwork,
  getIndexerGraphqlUrl,
  getServicesConfig,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'

// Indexer endpoint configuration
interface IndexerEndpoint {
  url: string
  type: 'graphql' | 'rest' | 'a2a' | 'mcp'
  healthy: boolean
  lastCheck: number
  latencyMs: number
  errorCount: number
}

// Track available indexer endpoints
const indexerEndpoints: Map<string, IndexerEndpoint> = new Map()

// Health check interval (30 seconds)
const HEALTH_CHECK_INTERVAL_MS = 30000
// Endpoint is considered unhealthy after this many consecutive errors
const MAX_ERROR_COUNT = 3

// Initialize endpoints from config
function initializeEndpoints(): void {
  const network = getCurrentNetwork()
  const services = getServicesConfig(network)

  // Primary indexer from config
  const graphqlUrl = services.indexer.graphql
  if (graphqlUrl) {
    indexerEndpoints.set('primary-graphql', {
      url: graphqlUrl,
      type: 'graphql',
      healthy: true,
      lastCheck: 0,
      latencyMs: 0,
      errorCount: 0,
    })
  }

  const restUrl = services.indexer.rest
  if (restUrl) {
    indexerEndpoints.set('primary-rest', {
      url: restUrl,
      type: 'rest',
      healthy: true,
      lastCheck: 0,
      latencyMs: 0,
      errorCount: 0,
    })
  }

  // Local development fallback
  if (indexerEndpoints.size === 0) {
    const localGraphql = getIndexerGraphqlUrl()
    indexerEndpoints.set('local-graphql', {
      url: localGraphql,
      type: 'graphql',
      healthy: true,
      lastCheck: 0,
      latencyMs: 0,
      errorCount: 0,
    })

    indexerEndpoints.set('local-rest', {
      url: 'http://127.0.0.1:4352',
      type: 'rest',
      healthy: true,
      lastCheck: 0,
      latencyMs: 0,
      errorCount: 0,
    })
  }
}

// Health check an endpoint
async function checkEndpointHealth(
  endpoint: IndexerEndpoint,
): Promise<boolean> {
  const startTime = Date.now()

  const healthUrl =
    endpoint.type === 'graphql' ? endpoint.url : `${endpoint.url}/health`

  const body =
    endpoint.type === 'graphql'
      ? JSON.stringify({ query: '{ __typename }' })
      : undefined

  const method = endpoint.type === 'graphql' ? 'POST' : 'GET'
  const headers: Record<string, string> =
    endpoint.type === 'graphql' ? { 'Content-Type': 'application/json' } : {}

  try {
    const response = await fetch(healthUrl, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(5000),
    })

    endpoint.latencyMs = Date.now() - startTime
    endpoint.lastCheck = Date.now()

    if (response.ok) {
      endpoint.healthy = true
      endpoint.errorCount = 0
      return true
    }

    endpoint.errorCount++
    if (endpoint.errorCount >= MAX_ERROR_COUNT) {
      endpoint.healthy = false
    }
    console.warn(
      `[IndexerProxy] Health check failed for ${endpoint.url}: ${response.status}`,
    )
    return false
  } catch (error) {
    endpoint.latencyMs = Date.now() - startTime
    endpoint.lastCheck = Date.now()
    endpoint.errorCount++
    if (endpoint.errorCount >= MAX_ERROR_COUNT) {
      endpoint.healthy = false
    }
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[IndexerProxy] Health check error for ${endpoint.url}: ${message}`,
    )
    return false
  }
}

// Get best available endpoint for a given type
function getBestEndpoint(type: 'graphql' | 'rest'): IndexerEndpoint | null {
  const endpoints = Array.from(indexerEndpoints.values())
    .filter((e) => e.type === type && e.healthy)
    .sort((a, b) => a.latencyMs - b.latencyMs)

  return endpoints[0] ?? null
}

// Proxy a GraphQL request - no fallbacks, fail fast with clear errors
async function proxyGraphQLRequest(
  query: string,
  variables: Record<string, unknown>,
  operationName: string | undefined,
): Promise<{ data?: unknown; errors?: Array<{ message: string }> }> {
  // Refresh endpoint health before trying (run health checks in parallel)
  const healthChecks = Array.from(indexerEndpoints.entries()).map(
    async ([_id, endpoint]) => checkEndpointHealth(endpoint),
  )
  await Promise.allSettled(healthChecks)

  const endpoint = getBestEndpoint('graphql')

  if (!endpoint) {
    // List all configured endpoints and their status for debugging
    const endpointStatus = Array.from(indexerEndpoints.entries())
      .map(
        ([id, e]) =>
          `${id}: ${e.url} (healthy: ${e.healthy}, errors: ${e.errorCount})`,
      )
      .join(', ')

    console.error(
      `[IndexerProxy] No healthy indexer endpoints. Status: ${endpointStatus}`,
    )
    return {
      errors: [
        {
          message: `Indexer unavailable - no healthy endpoints. Configured: ${endpointStatus || 'none'}. Ensure the indexer is running and PostgreSQL is accessible.`,
        },
      ],
    }
  }

  const startTime = Date.now()

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables, operationName }),
      signal: AbortSignal.timeout(30000),
    })

    endpoint.latencyMs = Date.now() - startTime

    if (!response.ok) {
      endpoint.errorCount++
      if (endpoint.errorCount >= MAX_ERROR_COUNT) {
        endpoint.healthy = false
      }
      const errorText = await response.text().catch(() => '')
      console.warn(
        `[IndexerProxy] GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      )
      return {
        errors: [
          {
            message: `Indexer error (${response.status}): ${response.statusText}. ${errorText}`,
          },
        ],
      }
    }

    endpoint.errorCount = 0
    const result: unknown = await response.json()
    return result as { data?: unknown; errors?: Array<{ message: string }> }
  } catch (error) {
    endpoint.latencyMs = Date.now() - startTime
    endpoint.errorCount++
    if (endpoint.errorCount >= MAX_ERROR_COUNT) {
      endpoint.healthy = false
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[IndexerProxy] GraphQL proxy error for ${endpoint.url}: ${message}`,
    )
    return {
      errors: [
        { message: `Indexer connection failed (${endpoint.url}): ${message}` },
      ],
    }
  }
}

// Proxy a REST request
async function proxyRestRequest(
  path: string,
  method: string,
  body: unknown,
  query: Record<string, string>,
): Promise<Response> {
  const endpoint = getBestEndpoint('rest')

  if (!endpoint) {
    return new Response(
      JSON.stringify({ error: 'No healthy indexer REST endpoints available' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Build URL with query params
  const url = new URL(path, endpoint.url)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }

  const startTime = Date.now()

  try {
    const response = await fetch(url.toString(), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    })

    endpoint.latencyMs = Date.now() - startTime

    if (!response.ok) {
      endpoint.errorCount++
      if (endpoint.errorCount >= MAX_ERROR_COUNT) {
        endpoint.healthy = false
      }
      console.warn(
        `[IndexerProxy] REST request failed: ${method} ${path} -> ${response.status}`,
      )
    } else {
      endpoint.errorCount = 0
    }

    return response
  } catch (error) {
    endpoint.latencyMs = Date.now() - startTime
    endpoint.errorCount++
    if (endpoint.errorCount >= MAX_ERROR_COUNT) {
      endpoint.healthy = false
    }
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[IndexerProxy] REST proxy error: ${method} ${path} -> ${message}`,
    )
    return new Response(JSON.stringify({ error: `Proxy error: ${message}` }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// Background health checker
let healthCheckInterval: ReturnType<typeof setInterval> | null = null

function startHealthChecker(): void {
  if (healthCheckInterval) return

  healthCheckInterval = setInterval(async () => {
    // Run health checks in parallel for all endpoints
    const checks = Array.from(indexerEndpoints.entries()).map(
      async ([_id, endpoint]) => {
        await checkEndpointHealth(endpoint)
      },
    )
    await Promise.allSettled(checks)
  }, HEALTH_CHECK_INTERVAL_MS)
}

function stopHealthChecker(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval)
    healthCheckInterval = null
  }
}

// Request schemas
const GraphQLRequestSchema = z.object({
  query: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).optional(),
  operationName: z.string().optional(),
})

// Create the router
export function createIndexerRouter() {
  // Initialize endpoints on router creation
  initializeEndpoints()
  startHealthChecker()

  return (
    new Elysia({ prefix: '/indexer' })
      // Health check
      .get('/health', () => {
        const endpoints = Array.from(indexerEndpoints.entries()).map(
          ([id, e]) => ({
            id,
            url: e.url,
            type: e.type,
            healthy: e.healthy,
            latencyMs: e.latencyMs,
            lastCheck: e.lastCheck,
          }),
        )

        const healthyGraphQL = endpoints.filter(
          (e) => e.type === 'graphql' && e.healthy,
        ).length
        const healthyRest = endpoints.filter(
          (e) => e.type === 'rest' && e.healthy,
        ).length

        return {
          status:
            healthyGraphQL > 0 || healthyRest > 0 ? 'healthy' : 'degraded',
          service: 'indexer-proxy',
          endpoints,
          graphql: {
            healthy: healthyGraphQL,
            total: endpoints.filter((e) => e.type === 'graphql').length,
          },
          rest: {
            healthy: healthyRest,
            total: endpoints.filter((e) => e.type === 'rest').length,
          },
        }
      })

      // List available endpoints
      .get('/endpoints', () => {
        return {
          endpoints: Array.from(indexerEndpoints.entries()).map(([id, e]) => ({
            id,
            url: e.url,
            type: e.type,
            healthy: e.healthy,
            latencyMs: e.latencyMs,
            errorCount: e.errorCount,
          })),
        }
      })

      // Add a new endpoint (for decentralized node registration)
      .post('/endpoints', async ({ body, set }) => {
        const parsed = z
          .object({
            id: z.string().min(1),
            url: z.string().url(),
            type: z.enum(['graphql', 'rest', 'a2a', 'mcp']),
          })
          .safeParse(body)

        if (!parsed.success) {
          set.status = 400
          return {
            error: 'Invalid endpoint configuration',
            details: parsed.error.issues,
          }
        }

        const endpoint: IndexerEndpoint = {
          url: parsed.data.url,
          type: parsed.data.type,
          healthy: true,
          lastCheck: 0,
          latencyMs: 0,
          errorCount: 0,
        }

        // Verify the endpoint is reachable
        const isHealthy = await checkEndpointHealth(endpoint).catch(() => false)
        if (!isHealthy) {
          set.status = 400
          return { error: 'Endpoint health check failed' }
        }

        indexerEndpoints.set(parsed.data.id, endpoint)

        return {
          status: 'registered',
          endpoint: {
            id: parsed.data.id,
            url: endpoint.url,
            type: endpoint.type,
            healthy: endpoint.healthy,
          },
        }
      })

      // GraphQL proxy endpoint
      .post('/graphql', async ({ body, set }) => {
        const parsed = GraphQLRequestSchema.safeParse(body)

        if (!parsed.success) {
          set.status = 400
          return {
            errors: [{ message: `Invalid request: ${parsed.error.message}` }],
          }
        }

        const result = await proxyGraphQLRequest(
          parsed.data.query,
          parsed.data.variables ?? {},
          parsed.data.operationName,
        )

        return result
      })

      // REST API proxy - catch all routes
      .get('/api/*', async ({ request, query }) => {
        const url = new URL(request.url)
        const path = url.pathname.replace('/indexer', '')

        const response = await proxyRestRequest(
          path,
          'GET',
          undefined,
          query as Record<string, string>,
        )
        const data: unknown = await response.json()

        return data
      })

      .post('/api/*', async ({ request, body, query }) => {
        const url = new URL(request.url)
        const path = url.pathname.replace('/indexer', '')

        const response = await proxyRestRequest(
          path,
          'POST',
          body,
          query as Record<string, string>,
        )
        const data: unknown = await response.json()

        return data
      })
  )
}

// Cleanup function
export function shutdownIndexerProxy(): void {
  stopHealthChecker()
  indexerEndpoints.clear()
}

// Export for testing
export { indexerEndpoints, checkEndpointHealth, getBestEndpoint }
