/**
 * Monitoring API Worker
 *
 * Network monitoring - workerd-compatible API worker.
 * Proxies Prometheus queries and provides metrics endpoints.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'

/**
 * Worker Environment Types
 */
export interface MonitoringEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'

  // Prometheus configuration
  PROMETHEUS_URL: string
  OIF_AGGREGATOR_URL: string

  // KV bindings (optional)
  MONITORING_CACHE?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

const MAX_QUERY_LENGTH = 2000

const DANGEROUS_PATTERNS = [
  /count\s*\(\s*count\s*\(/i,
  /\{[^}]*=~"\.{100,}/i,
  /\[\d{4,}[smhdwy]\]/i,
]

function validatePromQLQuery(query: string): {
  valid: boolean
  error?: string
} {
  if (query.length > MAX_QUERY_LENGTH) {
    return {
      valid: false,
      error: `Query too long (max ${MAX_QUERY_LENGTH} chars)`,
    }
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(query)) {
      return {
        valid: false,
        error: 'Query contains potentially expensive patterns',
      }
    }
  }

  return { valid: true }
}

/**
 * Create the Monitoring Elysia app
 */
export function createMonitoringApp(env?: Partial<MonitoringEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'
  const prometheusUrl = env?.PROMETHEUS_URL ?? 'http://localhost:9090'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://monitoring.jejunetwork.org',
              'https://jejunetwork.org',
              getCoreAppUrl('MONITORING'),
            ],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
        credentials: true,
      }),
    )

    // Health check
    .get('/health', () => ({
      status: 'ok',
      service: 'monitoring-api',
      version: '2.0.0',
      network,
      runtime: 'workerd',
      prometheus: !!prometheusUrl,
    }))

    // ============================================
    // Prometheus Proxy Routes
    // ============================================
    .group('/api/prometheus', (prom) =>
      prom
        .get('/query', async ({ query, set }) => {
          const q = query.query as string
          if (!q) {
            set.status = 400
            return { error: 'Query parameter required' }
          }

          const validation = validatePromQLQuery(q)
          if (!validation.valid) {
            set.status = 400
            return { error: validation.error }
          }

          try {
            const response = await fetch(
              `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(q)}`,
            )
            return response.json()
          } catch {
            set.status = 503
            return { error: 'Prometheus unavailable' }
          }
        })

        .get('/query_range', async ({ query, set }) => {
          const q = query.query as string
          const start = query.start as string
          const end = query.end as string
          const step = query.step as string

          if (!q || !start || !end) {
            set.status = 400
            return { error: 'Missing required parameters' }
          }

          const validation = validatePromQLQuery(q)
          if (!validation.valid) {
            set.status = 400
            return { error: validation.error }
          }

          try {
            const params = new URLSearchParams({
              query: q,
              start,
              end,
              step: step ?? '15s',
            })
            const response = await fetch(
              `${prometheusUrl}/api/v1/query_range?${params}`,
            )
            return response.json()
          } catch {
            set.status = 503
            return { error: 'Prometheus unavailable' }
          }
        })

        .get('/targets', async ({ set }) => {
          try {
            const response = await fetch(`${prometheusUrl}/api/v1/targets`)
            return response.json()
          } catch {
            set.status = 503
            return { error: 'Prometheus unavailable' }
          }
        })

        .get('/alerts', async ({ set }) => {
          try {
            const response = await fetch(`${prometheusUrl}/api/v1/alerts`)
            return response.json()
          } catch {
            set.status = 503
            return { error: 'Prometheus unavailable' }
          }
        }),
    )

    // ============================================
    // Network Stats Routes
    // ============================================
    .group('/api/stats', (stats) =>
      stats
        .get('/overview', () => ({
          network,
          nodes: { total: 0, active: 0 },
          services: { storage: 0, compute: 0, cdn: 0 },
          transactions: { total: 0, last24h: 0 },
        }))
        .get('/nodes', () => ({
          nodes: [],
          totalStaked: '0',
        }))
        .get('/uptime', () => ({
          uptime: 0,
          lastDowntime: null,
        })),
    )

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Monitoring',
          description: 'Network Monitoring and Metrics',
          version: '2.0.0',
          protocol: 'a2a',
          capabilities: ['metrics', 'alerts', 'targets', 'promql'],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              skill: z.string(),
              params: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid A2A request',
              details: parsed.error.issues,
            }
          }

          const { skill, params } = parsed.data

          if (skill === 'monitoring.query') {
            const query = params?.query as string
            if (!query) {
              return { error: 'Query parameter required' }
            }

            const validation = validatePromQLQuery(query)
            if (!validation.valid) {
              return { error: validation.error }
            }

            try {
              const response = await fetch(
                `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`,
              )
              const data = await response.json()
              return { result: data }
            } catch {
              return { error: 'Prometheus unavailable' }
            }
          }

          return { skill, result: 'Skill executed' }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Monitoring MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'monitoring_query',
              description: 'Execute PromQL query',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'PromQL query' },
                },
                required: ['query'],
              },
            },
            {
              name: 'monitoring_alerts',
              description: 'Get active alerts',
              parameters: { type: 'object', properties: {} },
            },
            {
              name: 'monitoring_targets',
              description: 'Get scrape targets',
              parameters: { type: 'object', properties: {} },
            },
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              tool: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid MCP request',
              details: parsed.error.issues,
            }
          }

          return { tool: parsed.data.tool, result: 'Tool executed' }
        }),
    )

  return app
}

/**
 * Default export for workerd
 */
const app = createMonitoringApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point (for local development)
 */
if (typeof Bun !== 'undefined') {
  const port = process.env.PORT ?? process.env.MONITORING_PORT ?? 9091
  const host = getLocalhostHost()

  console.log(`[Monitoring Worker] Starting on http://${host}:${port}`)
  console.log(`[Monitoring Worker] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port: Number(port),
    hostname: host,
    fetch: app.fetch,
  })
}
