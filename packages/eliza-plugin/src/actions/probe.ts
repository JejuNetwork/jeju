/**
 * PROBE_ENDPOINTS Action
 *
 * Probes hardcoded list of endpoints to measure health and latency.
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'

interface Endpoint {
  app: string
  port: number
  method: string
  path: string
}

const ENDPOINTS: Endpoint[] = [
  // Crucible (port 4021)
  { app: 'crucible', port: 4021, method: 'GET', path: '/health' },
  { app: 'crucible', port: 4021, method: 'GET', path: '/api/v1/autonomous/status' },
  { app: 'crucible', port: 4021, method: 'GET', path: '/api/v1/bots' },

  // DWS (port 4030)
  { app: 'dws', port: 4030, method: 'GET', path: '/health' },
  { app: 'dws', port: 4030, method: 'GET', path: '/compute/nodes/stats' },

  // Indexer (port 4355)
  { app: 'indexer', port: 4355, method: 'GET', path: '/health' },
]

interface ProbeResult {
  endpoint: Endpoint
  healthy: boolean
  latencyMs: number | null
  status: number | null
  error: string | null
}

interface ProbeReport {
  timestamp: string
  healthy: number
  total: number
  results: ProbeResult[]
}

async function probeEndpoint(endpoint: Endpoint): Promise<ProbeResult> {
  const url = `http://127.0.0.1:${endpoint.port}${endpoint.path}`
  const start = performance.now()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(url, {
      method: endpoint.method,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    const latencyMs = Math.round(performance.now() - start)
    const healthy = response.status >= 200 && response.status < 300

    return {
      endpoint,
      healthy,
      latencyMs,
      status: response.status,
      error: null,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    const simplifiedError = errorMessage.includes('ECONNREFUSED')
      ? 'Connection refused'
      : errorMessage.includes('abort')
        ? 'Timeout'
        : errorMessage

    return {
      endpoint,
      healthy: false,
      latencyMs: null,
      status: null,
      error: simplifiedError,
    }
  }
}

async function probeAllEndpoints(): Promise<ProbeReport> {
  const results = await Promise.allSettled(ENDPOINTS.map(probeEndpoint))

  const probeResults = results.map((result) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          endpoint: ENDPOINTS[0],
          healthy: false,
          latencyMs: null,
          status: null,
          error: 'Promise rejected',
        },
  )

  const healthy = probeResults.filter((r) => r.healthy).length

  return {
    timestamp: new Date().toISOString(),
    healthy,
    total: ENDPOINTS.length,
    results: probeResults,
  }
}

function formatProbeReport(report: ProbeReport): string {
  const lines: string[] = [
    `[ENDPOINT_PROBE | t=${report.timestamp} | healthy=${report.healthy}/${report.total}]`,
  ]

  // Group by app
  const byApp = new Map<string, ProbeResult[]>()
  for (const result of report.results) {
    const app = result.endpoint.app
    if (!byApp.has(app)) byApp.set(app, [])
    byApp.get(app)!.push(result)
  }

  for (const [app, results] of byApp) {
    lines.push(`${app}:`)
    for (const result of results) {
      const icon = result.healthy ? '✅' : '❌'
      const latency = result.latencyMs !== null ? ` (${result.latencyMs}ms)` : ''
      const error = result.error ? ` - ${result.error}` : ''
      lines.push(`  ${icon} ${result.endpoint.method} ${result.endpoint.path}${latency}${error}`)
    }
  }

  return lines.join('\n')
}

export const probeEndpointsAction: Action = {
  name: 'PROBE_ENDPOINTS',
  description: 'Probe all monitored endpoints to check health and measure latency',
  similes: [
    'probe endpoints',
    'check endpoints',
    'health check',
    'check services',
    'service status',
    'endpoint status',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    callback?.({ text: 'Probing endpoints...' })

    try {
      const report = await probeAllEndpoints()
      callback?.({
        text: formatProbeReport(report),
        content: {
          type: 'endpoint_probe',
          ...report,
        },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      callback?.({ text: `Failed to probe endpoints: ${errorMessage}` })
    }
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Probe all endpoints' },
      },
      {
        name: 'agent',
        content: {
          text: '[ENDPOINT_PROBE | t=2025-01-09T12:00:00.000Z | healthy=5/6]\ncrucible:\n  ✅ GET /health (45ms)\n  ✅ GET /api/v1/autonomous/status (89ms)\n  ✅ GET /api/v1/bots (52ms)\ndws:\n  ✅ GET /health (23ms)\n  ❌ GET /compute/nodes/stats - Connection refused\nindexer:\n  ✅ GET /health (31ms)',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Check service status' },
      },
      {
        name: 'agent',
        content: {
          text: '[ENDPOINT_PROBE | t=2025-01-09T12:00:00.000Z | healthy=6/6]\ncrucible:\n  ✅ GET /health (45ms)\n...',
        },
      },
    ],
  ],
}
