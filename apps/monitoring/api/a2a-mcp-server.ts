import { cors } from '@elysiajs/cors'
import { getCacheClient } from '@jejunetwork/cache'
import {
  getCurrentNetwork,
  getLocalhostHost,
  getNetworkName,
  getRpcUrl,
  getServiceUrl,
  getWebsiteUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { isRecord } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  MCPPromptGetSchema,
  MCPRequestSchema,
  type MCPResourceContent,
  MCPResourceReadSchema,
  MCPToolCallSchema,
  type MCPToolResult,
  PrometheusAlertsResponseSchema,
  PrometheusQueryResultSchema,
  PrometheusTargetsResponseSchema,
  type SafeFetchResponse,
  type SkillResult,
} from '../lib/types'

const network = getCurrentNetwork()
const isDevelopment = !isProductionEnv()
const host = getLocalhostHost()

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') ?? [
  `http://${host}:3000`,
  `http://${host}:4020`,
]

const PROMETHEUS_URL =
  (typeof process !== 'undefined' ? process.env.PROMETHEUS_URL : undefined) ??
  getServiceUrl('monitoring', 'prometheus', network)
const RPC_URL =
  (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ??
  getRpcUrl(network)

if (!isDevelopment && !PROMETHEUS_URL) {
  throw new Error('PROMETHEUS_URL is required in production')
}
if (!isDevelopment && !RPC_URL) {
  throw new Error('RPC_URL is required in production')
}

const corsConfig = {
  origin: (request: Request) => {
    const origin = request.headers.get('origin') ?? ''
    if (!origin && !isProductionEnv()) return true
    return CORS_ORIGINS.includes(origin)
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'OPTIONS'],
}

async function safeFetch(url: string): Promise<SafeFetchResponse | null> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)
  if (!response) return null
  return {
    ok: response.ok,
    status: response.status,
    json: async () => {
      const data: unknown = await response.json()
      return isRecord(data) ? data : {}
    },
  }
}

const MAX_QUERY_LENGTH = 2000

const DANGEROUS_PROMQL_PATTERNS = [
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

  for (const pattern of DANGEROUS_PROMQL_PATTERNS) {
    if (pattern.test(query)) {
      return {
        valid: false,
        error: 'Query contains potentially expensive patterns',
      }
    }
  }

  return { valid: true }
}

// Cache TTLs in seconds
const CACHE_TTL = {
  BLOCK_NUMBER: 2, // Very short - changes every block
  GAS_PRICE: 5, // Short - changes frequently
  PROMETHEUS: 10, // Metrics queries
  ALERTS: 15, // Alert status
  TARGETS: 30, // Target health
  TPS: 10, // Transaction rate
} as const

// Cache client for monitoring data
function getMonitoringCache() {
  return getCacheClient('monitoring-metrics')
}

// Hash a Prometheus query for cache key
function hashPromQuery(query: string): string {
  let hash = 0
  for (let i = 0; i < query.length; i++) {
    const char = query.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: `${getNetworkName()} Monitoring`,
  description: 'System monitoring, alerting, and health checks for the network',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: getNetworkName(), url: getWebsiteUrl() },
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
      id: 'check-service-health',
      name: 'Check Service Health',
      description: 'Check health of a specific service via Prometheus targets',
      tags: ['query', 'health'],
    },
    {
      id: 'check-all-services',
      name: 'Check All Services',
      description: 'Check health of all services via Prometheus targets',
      tags: ['query', 'health'],
    },
    {
      id: 'list-alerts',
      name: 'List Alerts',
      description: 'List active alerts from Prometheus',
      tags: ['query', 'alerts'],
    },
    {
      id: 'get-chain-stats',
      name: 'Get Chain Stats',
      description: 'Get blockchain statistics from RPC',
      tags: ['query', 'chain'],
    },
    {
      id: 'get-node-status',
      name: 'Get Node Status',
      description: 'Get node status from Prometheus targets',
      tags: ['query', 'nodes'],
    },
  ],
}

const MCP_SERVER_INFO = {
  name: 'jeju-monitoring',
  version: '1.0.0',
  description: 'System monitoring, alerting, and health checks',
  capabilities: { resources: true, tools: true, prompts: true },
}

const MCP_RESOURCES = [
  {
    uri: 'monitoring://services',
    name: 'Services',
    description: 'All monitored services from Prometheus',
    mimeType: 'application/json',
  },
  {
    uri: 'monitoring://alerts/active',
    name: 'Active Alerts',
    description: 'Currently active alerts from Prometheus',
    mimeType: 'application/json',
  },
  {
    uri: 'monitoring://chain/stats',
    name: 'Chain Stats',
    description: 'Blockchain statistics from RPC',
    mimeType: 'application/json',
  },
  {
    uri: 'monitoring://dashboard',
    name: 'Dashboard',
    description: 'Dashboard summary',
    mimeType: 'application/json',
  },
]

const MCP_TOOLS = [
  {
    name: 'check_service',
    description: 'Check health of a specific service via Prometheus',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name (job label)' },
      },
      required: ['service'],
    },
  },
  {
    name: 'query_prometheus',
    description: 'Execute a PromQL query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'PromQL query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_metrics',
    description: 'Get metrics for a service or resource',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Metric target' },
        metric: { type: 'string', description: 'Metric name' },
      },
      required: ['target', 'metric'],
    },
  },
]

const MCP_PROMPTS = [
  {
    name: 'analyze_incident',
    description: 'Analyze a monitoring incident',
    arguments: [
      { name: 'alertId', description: 'Alert ID to analyze', required: true },
    ],
  },
  {
    name: 'summarize_health',
    description: 'Summarize system health status',
    arguments: [
      {
        name: 'timeframe',
        description: 'Timeframe to summarize',
        required: false,
      },
    ],
  },
]

export function createMonitoringA2AServer() {
  return new Elysia({ prefix: '/a2a' })
    .use(cors(corsConfig))
    .get('/.well-known/agent-card.json', () => AGENT_CARD)
    .post('/', async ({ body }) => {
      const parseResult = MCPRequestSchema.safeParse(body)

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

      const parsedBody = parseResult.data

      if (parsedBody.method !== 'message/send') {
        return {
          jsonrpc: '2.0',
          id: parsedBody.id,
          error: { code: -32601, message: 'Method not found' },
        }
      }

      const parts = parsedBody.params.message.parts
      const dataPart = parts.find((p) => p.kind === 'data')
      const skillId = dataPart?.data.skillId ?? ''
      const skillParams: SkillParams = {
        service: dataPart?.data?.service,
        alertId: dataPart?.data?.alertId,
      }
      const result = await executeSkill(skillId, skillParams)

      return {
        jsonrpc: '2.0',
        id: parsedBody.id,
        result: {
          role: 'agent',
          parts: [
            { kind: 'text', text: result.message },
            { kind: 'data', data: result.data },
          ],
          messageId: parsedBody.params.message.messageId,
          kind: 'message',
        },
      }
    })
}

interface SkillParams {
  service?: string
  alertId?: string
}

async function executeSkill(
  skillId: string,
  params: SkillParams,
): Promise<SkillResult> {
  switch (skillId) {
    case 'check-service-health': {
      if (!params.service) {
        return {
          message: 'Missing service parameter',
          data: { error: 'service required' },
        }
      }

      const response = await safeFetch(`${PROMETHEUS_URL}/api/v1/targets`)
      if (!response) {
        return {
          message: 'Prometheus unavailable',
          data: { error: 'Connection failed' },
        }
      }
      if (!response.ok) {
        return {
          message: 'Failed to fetch targets',
          data: { error: `HTTP ${response.status}` },
        }
      }

      const rawData = await response.json()
      const parsed = PrometheusTargetsResponseSchema.safeParse(rawData)
      if (!parsed.success) {
        return {
          message: 'Invalid targets response',
          data: { error: parsed.error.message },
        }
      }

      const serviceTargets = parsed.data.data.activeTargets.filter(
        (t) => t.labels.job === params.service,
      )

      if (serviceTargets.length === 0) {
        return {
          message: `Service ${params.service} not found`,
          data: { error: 'Service not monitored' },
        }
      }

      const upCount = serviceTargets.filter((t) => t.health === 'up').length
      const status =
        upCount === serviceTargets.length
          ? 'healthy'
          : upCount > 0
            ? 'degraded'
            : 'down'
      const avgLatency =
        serviceTargets.reduce(
          (sum, t) => sum + (t.lastScrapeDuration ?? 0) * 1000,
          0,
        ) / serviceTargets.length

      return {
        message: `Service ${params.service}: ${status}`,
        data: {
          status,
          latency: Math.round(avgLatency),
        },
      }
    }

    case 'check-all-services': {
      const cache = getMonitoringCache()

      // Check cache for targets
      const cacheKey = 'targets:all'
      const cached = await cache.get(cacheKey).catch(() => null)
      if (cached) {
        const cachedData = JSON.parse(cached) as {
          services: Array<{
            name: string
            status: string
            instances: number
            healthy: number
          }>
          healthy: number
          unhealthy: number
        }
        return {
          message: `${cachedData.healthy}/${cachedData.services.length} services healthy`,
          data: cachedData,
        }
      }

      const response = await safeFetch(`${PROMETHEUS_URL}/api/v1/targets`)
      if (!response) {
        return {
          message: 'Prometheus unavailable',
          data: { error: 'Connection failed' },
        }
      }
      if (!response.ok) {
        return {
          message: 'Failed to fetch targets',
          data: { error: `HTTP ${response.status}` },
        }
      }

      const rawData = await response.json()
      const parsed = PrometheusTargetsResponseSchema.safeParse(rawData)
      if (!parsed.success) {
        return {
          message: 'Invalid targets response',
          data: { error: parsed.error.message },
        }
      }

      const targets = parsed.data.data.activeTargets
      const serviceMap = new Map<string, { up: number; total: number }>()

      for (const target of targets) {
        const job = target.labels.job ?? 'unknown'
        const current = serviceMap.get(job) ?? { up: 0, total: 0 }
        current.total++
        if (target.health === 'up') current.up++
        serviceMap.set(job, current)
      }

      const services = Array.from(serviceMap.entries()).map(
        ([name, stats]) => ({
          name,
          status:
            stats.up === stats.total
              ? 'healthy'
              : stats.up > 0
                ? 'degraded'
                : 'down',
          instances: stats.total,
          healthy: stats.up,
        }),
      )

      const healthy = services.filter((s) => s.status === 'healthy').length
      const unhealthy = services.filter((s) => s.status === 'down').length

      // Cache the result
      const resultData = { services, healthy, unhealthy }
      cache
        .set(cacheKey, JSON.stringify(resultData), CACHE_TTL.TARGETS)
        .catch(() => {})

      return {
        message: `${healthy}/${services.length} services healthy`,
        data: resultData,
      }
    }

    case 'list-alerts': {
      const cache = getMonitoringCache()

      // Check cache for alerts
      const cacheKey = 'alerts:active'
      const cached = await cache.get(cacheKey).catch(() => null)
      if (cached) {
        const cachedData = JSON.parse(cached) as {
          alerts: Array<{
            state: string
            labels: Record<string, string>
            annotations: Record<string, string>
          }>
          count: number
        }
        return {
          message: `${cachedData.count} active alerts`,
          data: cachedData,
        }
      }

      const response = await safeFetch(`${PROMETHEUS_URL}/api/v1/alerts`)
      if (!response) {
        return {
          message: 'Prometheus unavailable',
          data: { error: 'Connection failed' },
        }
      }
      if (!response.ok) {
        return {
          message: 'Failed to fetch alerts',
          data: { error: `HTTP ${response.status}` },
        }
      }

      const rawData = await response.json()
      const parsed = PrometheusAlertsResponseSchema.safeParse(rawData)
      if (!parsed.success) {
        return {
          message: 'Invalid alerts response',
          data: { error: parsed.error.message },
        }
      }

      const activeAlerts = parsed.data.data.alerts.filter(
        (a) => a.state === 'firing',
      )

      // Cache the result
      const resultData = { alerts: activeAlerts, count: activeAlerts.length }
      cache
        .set(cacheKey, JSON.stringify(resultData), CACHE_TTL.ALERTS)
        .catch(() => {})

      return {
        message: `${activeAlerts.length} active alerts`,
        data: resultData,
      }
    }

    case 'get-chain-stats': {
      const cache = getMonitoringCache()

      // Check block number cache first
      let blockNumber = 0
      const cachedBlock = await cache.get('chain:block').catch(() => null)
      if (cachedBlock) {
        blockNumber = parseInt(cachedBlock, 10)
      } else {
        const blockNumberRes = await fetch(RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_blockNumber',
            params: [],
            id: 1,
          }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => null)

        if (!blockNumberRes) {
          return {
            message: 'RPC unavailable',
            data: { error: 'Connection failed' },
          }
        }

        const blockData: unknown = await blockNumberRes.json()
        const blockParsed = z
          .object({
            result: z.string(),
          })
          .safeParse(blockData)

        if (!blockParsed.success) {
          return {
            message: 'Invalid RPC response',
            data: { error: 'Failed to parse block number' },
          }
        }

        blockNumber = parseInt(blockParsed.data.result, 16)
        cache
          .set('chain:block', blockNumber.toString(), CACHE_TTL.BLOCK_NUMBER)
          .catch(() => {})
      }

      // Check gas price cache
      let gasPrice = '0'
      const cachedGas = await cache.get('chain:gas').catch(() => null)
      if (cachedGas) {
        gasPrice = cachedGas
      } else {
        const gasPriceRes = await fetch(RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_gasPrice',
            params: [],
            id: 2,
          }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => null)

        if (gasPriceRes) {
          const gasPriceData: unknown = await gasPriceRes.json()
          const gasParsed = z
            .object({ result: z.string() })
            .safeParse(gasPriceData)
          if (gasParsed.success) {
            gasPrice = (parseInt(gasParsed.data.result, 16) / 1e9).toFixed(2)
            cache
              .set('chain:gas', gasPrice, CACHE_TTL.GAS_PRICE)
              .catch(() => {})
          }
        }
      }

      // Check TPS cache
      let tps = 0
      const cachedTps = await cache.get('chain:tps').catch(() => null)
      if (cachedTps) {
        tps = parseInt(cachedTps, 10)
      } else {
        const tpsResponse = await safeFetch(
          `${PROMETHEUS_URL}/api/v1/query?query=rate(ethereum_transactions_total[5m])`,
        )
        if (tpsResponse?.ok) {
          const tpsData = await tpsResponse.json()
          const tpsParsed = PrometheusQueryResultSchema.safeParse(tpsData)
          if (tpsParsed.success) {
            const result = tpsParsed.data.data?.result?.[0]
            if (result?.value) {
              tps = Math.round(parseFloat(result.value[1]))
              cache
                .set('chain:tps', tps.toString(), CACHE_TTL.TPS)
                .catch(() => {})
            }
          }
        }
      }

      return {
        message: `Block ${blockNumber}, Gas ${gasPrice} gwei`,
        data: { blockNumber, tps, gasPrice },
      }
    }

    case 'get-node-status': {
      const response = await safeFetch(`${PROMETHEUS_URL}/api/v1/targets`)
      if (!response) {
        return {
          message: 'Prometheus unavailable',
          data: { error: 'Connection failed' },
        }
      }
      if (!response.ok) {
        return {
          message: 'Failed to fetch targets',
          data: { error: `HTTP ${response.status}` },
        }
      }

      const rawData = await response.json()
      const parsed = PrometheusTargetsResponseSchema.safeParse(rawData)
      if (!parsed.success) {
        return {
          message: 'Invalid targets response',
          data: { error: parsed.error.message },
        }
      }

      const nodeTargets = parsed.data.data.activeTargets.filter(
        (t) => t.labels.job.includes('node') || t.labels.job.includes('reth'),
      )

      const nodes = nodeTargets.map((t) => ({
        instance: t.labels.instance ?? 'unknown',
        job: t.labels.job ?? 'unknown',
        health: t.health,
        lastScrape: t.lastScrape,
      }))

      const healthy = nodes.filter((n) => n.health === 'up').length

      return {
        message: `${healthy}/${nodes.length} nodes healthy`,
        data: { nodes, healthy },
      }
    }

    default:
      return { message: 'Unknown skill', data: { error: 'Skill not found' } }
  }
}

export function createMonitoringMCPServer() {
  return new Elysia({ prefix: '/mcp' })
    .use(cors(corsConfig))
    .post('/initialize', () => ({
      protocolVersion: '2024-11-05',
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_INFO.capabilities,
    }))
    .post('/resources/list', () => ({ resources: MCP_RESOURCES }))
    .post('/resources/read', async ({ body, set }) => {
      const parseResult = MCPResourceReadSchema.safeParse(body)

      if (!parseResult.success) {
        set.status = 400
        return { error: `Invalid request: ${parseResult.error.message}` }
      }

      const { uri } = parseResult.data
      let contents: MCPResourceContent

      switch (uri) {
        case 'monitoring://services': {
          const response = await safeFetch(`${PROMETHEUS_URL}/api/v1/targets`)
          if (!response?.ok) {
            contents = { services: [] }
            break
          }

          const rawData = await response.json()
          const parsed = PrometheusTargetsResponseSchema.safeParse(rawData)
          if (!parsed.success) {
            contents = { services: [] }
            break
          }

          const serviceMap = new Map<string, { up: number; total: number }>()
          for (const target of parsed.data.data.activeTargets) {
            const job = target.labels.job ?? 'unknown'
            const current = serviceMap.get(job) ?? { up: 0, total: 0 }
            current.total++
            if (target.health === 'up') current.up++
            serviceMap.set(job, current)
          }

          const services = Array.from(serviceMap.entries()).map(
            ([name, stats]) => ({
              name,
              status:
                stats.up === stats.total
                  ? 'healthy'
                  : stats.up > 0
                    ? 'degraded'
                    : 'down',
              uptime: stats.total > 0 ? (stats.up / stats.total) * 100 : 0,
            }),
          )

          contents = { services }
          break
        }

        case 'monitoring://alerts/active': {
          const response = await safeFetch(`${PROMETHEUS_URL}/api/v1/alerts`)
          if (!response?.ok) {
            contents = { alerts: [] }
            break
          }

          const rawData = await response.json()
          const parsed = PrometheusAlertsResponseSchema.safeParse(rawData)
          if (!parsed.success) {
            contents = { alerts: [] }
            break
          }

          const alerts = parsed.data.data.alerts
            .filter((a) => a.state === 'firing')
            .map((a) => ({
              id: a.labels.alertname ?? 'unknown',
              severity: a.labels.severity ?? 'unknown',
              message:
                a.annotations.description ??
                a.annotations.summary ??
                a.labels.alertname ??
                'Alert',
            }))

          contents = { alerts }
          break
        }

        case 'monitoring://chain/stats': {
          const blockRes = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_blockNumber',
              params: [],
              id: 1,
            }),
            signal: AbortSignal.timeout(5000),
          }).catch(() => null)

          let blockNumber = 0
          if (blockRes) {
            const data: unknown = await blockRes.json()
            const parsed = z.object({ result: z.string() }).safeParse(data)
            if (parsed.success) {
              blockNumber = parseInt(parsed.data.result, 16)
            }
          }

          contents = { blockNumber, avgBlockTime: 2, tps: 0 }
          break
        }

        case 'monitoring://dashboard': {
          const targetsRes = await safeFetch(`${PROMETHEUS_URL}/api/v1/targets`)
          const alertsRes = await safeFetch(`${PROMETHEUS_URL}/api/v1/alerts`)

          let services = 0
          let upCount = 0
          let alerts = 0

          if (targetsRes?.ok) {
            const rawData = await targetsRes.json()
            const parsed = PrometheusTargetsResponseSchema.safeParse(rawData)
            if (parsed.success) {
              const jobs = new Set(
                parsed.data.data.activeTargets.map((t) => t.labels.job),
              )
              services = jobs.size
              upCount = parsed.data.data.activeTargets.filter(
                (t) => t.health === 'up',
              ).length
            }
          }

          if (alertsRes?.ok) {
            const rawData = await alertsRes.json()
            const parsed = PrometheusAlertsResponseSchema.safeParse(rawData)
            if (parsed.success) {
              alerts = parsed.data.data.alerts.filter(
                (a) => a.state === 'firing',
              ).length
            }
          }

          const status = alerts > 0 ? 'degraded' : 'healthy'
          const total = targetsRes?.ok
            ? ((
                await PrometheusTargetsResponseSchema.safeParseAsync(
                  await targetsRes.json(),
                )
              ).data?.data.activeTargets.length ?? 0)
            : 0
          const uptime = total > 0 ? (upCount / total) * 100 : 100

          contents = { status, services, alerts, uptime }
          break
        }

        default:
          set.status = 404
          return { error: 'Resource not found' }
      }

      return {
        contents: [
          { uri, mimeType: 'application/json', text: JSON.stringify(contents) },
        ],
      }
    })
    .post('/tools/list', () => ({ tools: MCP_TOOLS }))
    .post('/tools/call', async ({ body }) => {
      const parseResult = MCPToolCallSchema.safeParse(body)

      if (!parseResult.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid request: ${parseResult.error.message}`,
            },
          ],
          isError: true,
        }
      }

      const { name, arguments: args } = parseResult.data
      let result: MCPToolResult

      switch (name) {
        case 'check_service': {
          if (!args.service) {
            return {
              content: [{ type: 'text', text: 'Missing service parameter' }],
              isError: true,
            }
          }

          const response = await safeFetch(`${PROMETHEUS_URL}/api/v1/targets`)
          if (!response?.ok) {
            result = {
              service: args.service,
              status: 'unknown',
              latency: 0,
              uptime: 0,
            }
            break
          }

          const rawData = await response.json()
          const parsed = PrometheusTargetsResponseSchema.safeParse(rawData)
          if (!parsed.success) {
            result = {
              service: args.service,
              status: 'unknown',
              latency: 0,
              uptime: 0,
            }
            break
          }

          const serviceTargets = parsed.data.data.activeTargets.filter(
            (t) => t.labels.job === args.service,
          )

          if (serviceTargets.length === 0) {
            result = {
              service: args.service,
              status: 'not found',
              latency: 0,
              uptime: 0,
            }
            break
          }

          const upCount = serviceTargets.filter((t) => t.health === 'up').length
          const avgLatency =
            serviceTargets.reduce(
              (sum, t) => sum + (t.lastScrapeDuration ?? 0) * 1000,
              0,
            ) / serviceTargets.length

          result = {
            service: args.service,
            status:
              upCount === serviceTargets.length
                ? 'healthy'
                : upCount > 0
                  ? 'degraded'
                  : 'down',
            latency: Math.round(avgLatency),
            uptime: (upCount / serviceTargets.length) * 100,
          }
          break
        }

        case 'query_prometheus': {
          if (!args.query) {
            return {
              content: [{ type: 'text', text: 'Missing query parameter' }],
              isError: true,
            }
          }

          const validation = validatePromQLQuery(args.query)
          if (!validation.valid) {
            return {
              content: [
                { type: 'text', text: validation.error ?? 'Invalid query' },
              ],
              isError: true,
            }
          }

          // Check cache for this query
          const cache = getMonitoringCache()
          const cacheKey = `prom:${hashPromQuery(args.query)}`
          const cached = await cache.get(cacheKey).catch(() => null)
          if (cached) {
            result = JSON.parse(cached) as {
              logs: string[]
              total: number
              query: string
            }
            break
          }

          const response = await safeFetch(
            `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(args.query)}`,
          )

          if (!response?.ok) {
            result = { logs: [], total: 0, query: args.query }
            break
          }

          const rawData = await response.json()
          const parsed = PrometheusQueryResultSchema.safeParse(rawData)
          if (!parsed.success) {
            result = { logs: [], total: 0, query: args.query }
            break
          }

          const values =
            parsed.data.data?.result?.map((r) => ({
              metric: r.metric,
              value: r.value?.[1] ?? '0',
            })) ?? []

          result = {
            logs: values.map((v) => JSON.stringify(v)),
            total: values.length,
            query: args.query,
          }

          // Cache the query result
          cache
            .set(cacheKey, JSON.stringify(result), CACHE_TTL.PROMETHEUS)
            .catch(() => {})
          break
        }

        case 'get_metrics': {
          if (!args.target || !args.metric) {
            return {
              content: [
                { type: 'text', text: 'Missing target or metric parameter' },
              ],
              isError: true,
            }
          }

          const validName = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/
          if (!validName.test(args.metric)) {
            return {
              content: [{ type: 'text', text: 'Invalid metric name format' }],
              isError: true,
            }
          }
          if (!validName.test(args.target)) {
            return {
              content: [{ type: 'text', text: 'Invalid target name format' }],
              isError: true,
            }
          }

          const query = `${args.metric}{job="${args.target}"}`
          const response = await safeFetch(
            `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`,
          )

          if (!response?.ok) {
            result = { target: args.target, metric: args.metric, values: [] }
            break
          }

          const rawData = await response.json()
          const parsed = PrometheusQueryResultSchema.safeParse(rawData)
          if (!parsed.success) {
            result = { target: args.target, metric: args.metric, values: [] }
            break
          }

          const values =
            parsed.data.data?.result?.map((r) =>
              parseFloat(r.value?.[1] ?? '0'),
            ) ?? []

          result = { target: args.target, metric: args.metric, values }
          break
        }

        default:
          return {
            content: [{ type: 'text', text: 'Tool not found' }],
            isError: true,
          }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      }
    })
    .post('/prompts/list', () => ({ prompts: MCP_PROMPTS }))
    .post('/prompts/get', async ({ body, set }) => {
      const parseResult = MCPPromptGetSchema.safeParse(body)

      if (!parseResult.success) {
        set.status = 400
        return { error: `Invalid request: ${parseResult.error.message}` }
      }

      const { name, arguments: args } = parseResult.data
      let messages: Array<{
        role: string
        content: { type: string; text: string }
      }>

      switch (name) {
        case 'analyze_incident': {
          const alertId = args.alertId
          if (!alertId) {
            set.status = 400
            return { error: 'alertId argument is required' }
          }
          messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Analyze the monitoring incident with alert ID ${alertId}. Provide root cause analysis and recommended actions.`,
              },
            },
          ]
          break
        }
        case 'summarize_health': {
          const timeframe = args.timeframe ?? 'last 24 hours'
          messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Summarize the system health status over the ${timeframe}. Include key metrics and any concerning trends.`,
              },
            },
          ]
          break
        }
        default:
          set.status = 404
          return { error: 'Prompt not found' }
      }

      return { messages }
    })
    .get('/', () => ({
      ...MCP_SERVER_INFO,
      resources: MCP_RESOURCES,
      tools: MCP_TOOLS,
      prompts: MCP_PROMPTS,
    }))
}

export function createMonitoringServer() {
  return new Elysia()
    .use(createMonitoringA2AServer())
    .use(createMonitoringMCPServer())
    .get('/health', () => ({
      status: 'healthy',
      service: 'jeju-monitoring',
      version: '1.0.0',
    }))
    .get('/', () => ({
      name: `${getNetworkName()} Monitoring`,
      version: '1.0.0',
      endpoints: {
        a2a: '/a2a',
        mcp: '/mcp',
        health: '/health',
        agentCard: '/a2a/.well-known/agent-card.json',
      },
    }))
}
