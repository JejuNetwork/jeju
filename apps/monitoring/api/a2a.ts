/** A2A server exposing Prometheus metrics via the A2A protocol. */

import { cors } from '@elysiajs/cors'
import { getNetworkName } from '@jejunetwork/config'
import { isRecord } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  A2ARequestSchema,
  formatVolume,
  OIFRouteSchema,
  OIFSolverSchema,
  OIFStatsResponseSchema,
  PrometheusAlertsResponseSchema,
  PrometheusQueryResultSchema,
  PrometheusTargetsResponseSchema,
  type SkillResult,
} from '../lib/types'

const networkName = getNetworkName()

const isDevelopment = process.env.NODE_ENV !== 'production'

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') ?? [
  'http://localhost:3000',
  'http://localhost:4020',
]

const prometheusUrl = process.env.PROMETHEUS_URL ?? 'http://localhost:9090'
const oifAggregatorUrl =
  process.env.OIF_AGGREGATOR_URL ?? 'http://localhost:4010'

if (!isDevelopment && !process.env.PROMETHEUS_URL) {
  throw new Error('PROMETHEUS_URL is required in production')
}
if (!isDevelopment && !process.env.OIF_AGGREGATOR_URL) {
  throw new Error('OIF_AGGREGATOR_URL is required in production')
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

interface SafeFetchResponse {
  ok: boolean
  status: number
  json: () => Promise<Record<string, unknown>>
}

async function safeFetch(url: string): Promise<SafeFetchResponse | null> {
  try {
    const response = await fetch(url)
    return {
      ok: response.ok,
      status: response.status,
      json: async () => {
        const data: unknown = await response.json()
        return isRecord(data) ? data : {}
      },
    }
  } catch {
    return null
  }
}

const app = new Elysia()
  .use(
    cors({
      origin: isDevelopment ? true : CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  )
  .get('/.well-known/agent-card.json', () => ({
    protocolVersion: '0.3.0',
    name: `${networkName} Monitoring`,
    description: 'Query blockchain metrics and system health via Prometheus',
    url: 'http://localhost:9091/api/a2a',
    preferredTransport: 'http',
    provider: { organization: 'the network', url: 'https://jejunetwork.org' },
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      {
        id: 'query-metrics',
        name: 'Query Metrics',
        description: 'Execute PromQL query against Prometheus',
        tags: ['query', 'metrics'],
        examples: [
          'Show current TPS',
          'Get block production rate',
          'Check system health',
        ],
      },
      {
        id: 'get-alerts',
        name: 'Get Alerts',
        description: 'Get currently firing alerts',
        tags: ['alerts', 'monitoring'],
        examples: ['Show active alerts', 'Are there any critical issues?'],
      },
      {
        id: 'get-targets',
        name: 'Get Targets',
        description: 'Get Prometheus scrape targets and their status',
        tags: ['targets', 'health'],
        examples: [
          'Show scrape targets',
          'Which services are being monitored?',
        ],
      },
      {
        id: 'oif-stats',
        name: 'OIF Statistics',
        description:
          'Get Open Intents Framework statistics (intents, solvers, volume)',
        tags: ['oif', 'intents', 'cross-chain'],
        examples: [
          'Show OIF stats',
          'How many intents today?',
          'Cross-chain volume?',
        ],
      },
      {
        id: 'oif-solver-health',
        name: 'OIF Solver Health',
        description: 'Get health status of active OIF solvers',
        tags: ['oif', 'solvers', 'health'],
        examples: [
          'Solver health check',
          'Are solvers online?',
          'Solver success rates',
        ],
      },
      {
        id: 'oif-route-stats',
        name: 'OIF Route Statistics',
        description: 'Get cross-chain route performance metrics',
        tags: ['oif', 'routes', 'performance'],
        examples: [
          'Route performance',
          'Best route for Base to Arbitrum?',
          'Route success rates',
        ],
      },
    ],
  }))
  .post('/api/a2a', async ({ body }) => {
    const parseResult = A2ARequestSchema.safeParse(body)
    if (!parseResult.success) {
      const requestId = isRecord(body) ? body.id : undefined
      return {
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32600,
          message: `Invalid request: ${parseResult.error.message}`,
        },
      }
    }

    const { method, params, id } = parseResult.data

    if (method !== 'message/send') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' },
      }
    }

    if (!params?.message) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Missing params.message' },
      }
    }

    const message = params.message
    const dataPart = message.parts.find((p) => p.kind === 'data')
    const skillId = dataPart?.data?.skillId
    const query = dataPart?.data?.query

    let result: SkillResult

    switch (skillId) {
      case 'query-metrics': {
        if (!query) {
          result = {
            message: 'Missing PromQL query',
            data: { error: 'query required' },
          }
          break
        }

        const validation = validatePromQLQuery(query)
        if (!validation.valid) {
          result = {
            message: 'Invalid query',
            data: { error: validation.error ?? 'Unknown validation error' },
          }
          break
        }

        const response = await safeFetch(
          `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`,
        )
        if (!response) {
          result = {
            message: 'Prometheus unavailable',
            data: { error: 'Connection failed' },
          }
          break
        }
        if (!response.ok) {
          result = {
            message: 'Prometheus query failed',
            data: { error: `HTTP ${response.status}` },
          }
          break
        }

        const rawData = await response.json()
        const parsed = PrometheusQueryResultSchema.safeParse(rawData)
        if (!parsed.success) {
          result = {
            message: 'Invalid Prometheus response',
            data: { error: parsed.error.message },
          }
          break
        }

        const queryResult = parsed.data.data?.result?.map((r) => ({
          metric: r.metric,
          value: r.value,
        }))

        result = {
          message: `Query results for: ${query}`,
          data: { result: queryResult ?? [] },
        }
        break
      }

      case 'get-alerts': {
        const response = await safeFetch(`${prometheusUrl}/api/v1/alerts`)
        if (!response) {
          result = {
            message: 'Prometheus unavailable',
            data: { error: 'Connection failed' },
          }
          break
        }
        if (!response.ok) {
          result = {
            message: 'Failed to fetch alerts',
            data: { error: `HTTP ${response.status}` },
          }
          break
        }

        const rawData = await response.json()
        const parsed = PrometheusAlertsResponseSchema.safeParse(rawData)
        if (!parsed.success) {
          result = {
            message: 'Invalid alerts response',
            data: { error: parsed.error.message },
          }
          break
        }

        const activeAlerts = parsed.data.data.alerts.filter(
          (a) => a.state === 'firing',
        )

        result = {
          message: `Found ${activeAlerts.length} active alerts`,
          data: { alerts: activeAlerts },
        }
        break
      }

      case 'get-targets': {
        const response = await safeFetch(`${prometheusUrl}/api/v1/targets`)
        if (!response) {
          result = {
            message: 'Prometheus unavailable',
            data: { error: 'Connection failed' },
          }
          break
        }
        if (!response.ok) {
          result = {
            message: 'Failed to fetch targets',
            data: { error: `HTTP ${response.status}` },
          }
          break
        }

        const rawData = await response.json()
        const parsed = PrometheusTargetsResponseSchema.safeParse(rawData)
        if (!parsed.success) {
          result = {
            message: 'Invalid targets response',
            data: { error: parsed.error.message },
          }
          break
        }

        const targets = parsed.data.data.activeTargets
        const upCount = targets.filter((t) => t.health === 'up').length

        result = {
          message: `${upCount}/${targets.length} targets healthy`,
          data: { targets },
        }
        break
      }

      case 'oif-stats': {
        const response = await safeFetch(`${oifAggregatorUrl}/api/stats`)
        if (!response) {
          result = {
            message: 'OIF stats unavailable',
            data: { error: 'Connection failed' },
          }
          break
        }
        if (!response.ok) {
          result = {
            message: 'OIF stats unavailable',
            data: { error: `HTTP ${response.status}` },
          }
          break
        }

        const rawData = await response.json()
        const parsed = OIFStatsResponseSchema.safeParse(rawData)
        if (!parsed.success) {
          result = {
            message: 'Invalid OIF stats response',
            data: { error: parsed.error.message },
          }
          break
        }

        const stats = parsed.data
        result = {
          message: `OIF Stats: ${stats.totalIntents} intents, ${stats.activeSolvers} solvers, $${formatVolume(stats.totalVolumeUsd)} volume`,
          data: stats,
        }
        break
      }

      case 'oif-solver-health': {
        const response = await safeFetch(
          `${oifAggregatorUrl}/api/solvers?active=true`,
        )
        if (!response) {
          result = {
            message: 'OIF solvers unavailable',
            data: { error: 'Connection failed' },
          }
          break
        }
        if (!response.ok) {
          result = {
            message: 'OIF solvers unavailable',
            data: { error: `HTTP ${response.status}` },
          }
          break
        }

        const rawData = await response.json()
        const parsed = z.array(OIFSolverSchema).safeParse(rawData)
        if (!parsed.success) {
          result = {
            message: 'Invalid solvers response',
            data: { error: parsed.error.message },
          }
          break
        }

        const solvers = parsed.data
        const healthySolvers = solvers.filter((s) => s.successRate >= 95)
        const avgSuccessRate =
          solvers.length > 0
            ? solvers.reduce((sum, s) => sum + s.successRate, 0) /
              solvers.length
            : 0

        result = {
          message: `${healthySolvers.length}/${solvers.length} solvers healthy, avg success rate: ${avgSuccessRate.toFixed(1)}%`,
          data: {
            totalSolvers: solvers.length,
            healthySolvers: healthySolvers.length,
            avgSuccessRate,
            solvers: solvers.map((s) => ({
              address: s.address,
              name: s.name,
              successRate: s.successRate,
              reputation: s.reputation,
            })),
          },
        }
        break
      }

      case 'oif-route-stats': {
        const response = await safeFetch(
          `${oifAggregatorUrl}/api/routes?active=true`,
        )
        if (!response) {
          result = {
            message: 'OIF routes unavailable',
            data: { error: 'Connection failed' },
          }
          break
        }
        if (!response.ok) {
          result = {
            message: 'OIF routes unavailable',
            data: { error: `HTTP ${response.status}` },
          }
          break
        }

        const rawData = await response.json()
        const parsed = z.array(OIFRouteSchema).safeParse(rawData)
        if (!parsed.success) {
          result = {
            message: 'Invalid routes response',
            data: { error: parsed.error.message },
          }
          break
        }

        const routes = parsed.data
        const totalVolume = routes.reduce(
          (sum, r) => sum + BigInt(r.totalVolume),
          0n,
        )
        const avgSuccessRate =
          routes.length > 0
            ? routes.reduce((sum, r) => sum + r.successRate, 0) / routes.length
            : 0

        result = {
          message: `${routes.length} active routes, ${formatVolume(totalVolume.toString())} ETH volume, ${avgSuccessRate.toFixed(1)}% success`,
          data: {
            totalRoutes: routes.length,
            totalVolume: totalVolume.toString(),
            avgSuccessRate,
            routes: routes.map((r) => ({
              routeId: r.routeId,
              source: r.sourceChainId,
              destination: r.destinationChainId,
              successRate: r.successRate,
              avgTime: r.avgFillTimeSeconds,
            })),
          },
        }
        break
      }

      default:
        result = {
          message: 'Unknown skill',
          data: { error: 'invalid skillId' },
        }
    }

    return {
      jsonrpc: '2.0',
      id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: message.messageId,
        kind: 'message',
      },
    }
  })

export type App = typeof app

if (import.meta.main) {
  const port = Number(process.env.A2A_PORT ?? 9091)
  app.listen(port)
}

export { app }
