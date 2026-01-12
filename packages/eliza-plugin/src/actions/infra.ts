/**
 * Infrastructure Monitoring Actions
 *
 * COLLECT_NODE_STATS: Fetches DWS health and node stats with latency measurements
 * ANALYZE_INFRA_HEALTH: Analyzes snapshots for threshold/trend alerts
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
  UUID,
} from '@elizaos/core'
import { getDWSUrl } from '@jejunetwork/config'
import { z } from 'zod'
import { fetchWithTimeout } from '../validation'

function getDWSBaseUrl(): string {
  return getDWSUrl()
}

// Schemas
const healthResponseSchema = z.object({
  status: z.string(),
  version: z.string().optional(),
  uptime: z.number().optional(),
})

const nodeStatsResponseSchema = z.object({
  inference: z.object({
    totalNodes: z.number(),
    activeNodes: z.number(),
    totalCapacity: z.number().optional(),
    currentLoad: z.number().optional(),
    providers: z.array(z.string()).optional(),
    models: z.array(z.string()).optional(),
  }),
  training: z
    .object({
      totalNodes: z.number(),
      activeNodes: z.number(),
      totalRuns: z.number().optional(),
      activeRuns: z.number().optional(),
    })
    .optional(),
})

// Types
export interface NodeSnapshot {
  timestamp: number
  dws: {
    healthy: boolean
    latencyMs: number
  }
  inference: {
    count: number
    latencyMs: number
  }
}

export interface InfraAlert {
  type: 'threshold' | 'trend'
  severity: 'warning' | 'critical'
  message: string
}

export interface InfraHealthResult {
  status: 'healthy' | 'degraded' | 'critical'
  alerts: InfraAlert[]
  recommendation: string
}

async function measureLatency<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now()
  const result = await fn()
  return { result, latencyMs: Date.now() - start }
}

async function fetchDwsHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
  try {
    const { result, latencyMs } = await measureLatency(async () => {
      const response = await fetchWithTimeout(
        `${getDWSBaseUrl()}/health`,
        { headers: { Accept: 'application/json' } },
        10000,
      )
      if (!response.ok) return null
      const json = await response.json()
      return healthResponseSchema.safeParse(json)
    })

    if (!result || !result.success) {
      return { healthy: false, latencyMs }
    }
    return { healthy: result.data.status === 'ok', latencyMs }
  } catch {
    return { healthy: false, latencyMs: -1 }
  }
}

async function fetchInferenceStats(): Promise<{ count: number; latencyMs: number }> {
  try {
    const { result, latencyMs } = await measureLatency(async () => {
      const response = await fetchWithTimeout(
        `${getDWSBaseUrl()}/compute/nodes/stats`,
        { headers: { Accept: 'application/json' } },
        10000,
      )
      if (!response.ok) {
        console.error(`[Infra] Failed to fetch node stats: HTTP ${response.status}`)
        return null
      }
      const json = await response.json()
      const parsed = nodeStatsResponseSchema.safeParse(json)
      if (!parsed.success) {
        console.error('[Infra] Node stats schema validation failed:', parsed.error.message)
        console.error('[Infra] Received:', JSON.stringify(json))
      }
      return parsed
    })

    if (!result || !result.success) {
      return { count: 0, latencyMs }
    }
    return { count: result.data.inference.activeNodes, latencyMs }
  } catch (error) {
    console.error('[Infra] Error fetching inference stats:', error)
    return { count: 0, latencyMs: -1 }
  }
}

function formatSnapshot(snapshot: NodeSnapshot): string {
  const dwsStatus = snapshot.dws.healthy ? 'healthy' : 'unhealthy'
  const dwsLatency = snapshot.dws.latencyMs >= 0 ? `${snapshot.dws.latencyMs}ms` : 'timeout'
  const inferenceLatency = snapshot.inference.latencyMs >= 0 ? `${snapshot.inference.latencyMs}ms` : 'timeout'

  return `[NODE_SNAPSHOT | t=${snapshot.timestamp}]
DWS: ${dwsStatus} (${dwsLatency})
Inference: ${snapshot.inference.count} nodes (${inferenceLatency})
\`\`\`json
${JSON.stringify(snapshot)}
\`\`\``
}

export const collectNodeStatsAction: Action = {
  name: 'COLLECT_NODE_STATS',
  description: 'Fetch DWS health, node stats, and measure latencies',
  similes: [
    'collect node stats',
    'get infrastructure status',
    'check dws health',
    'measure node latency',
    'infrastructure snapshot',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    callback?.({ text: 'Collecting infrastructure stats...' })

    const [dws, inference] = await Promise.all([
      fetchDwsHealth(),
      fetchInferenceStats(),
    ])

    const snapshot: NodeSnapshot = {
      timestamp: Date.now(),
      dws,
      inference,
    }

    callback?.({
      text: formatSnapshot(snapshot),
      content: {
        type: 'node_snapshot',
        ...snapshot,
      },
    })
  },

  examples: [
    [
      { name: 'user', content: { text: 'Collect node stats' } },
      {
        name: 'agent',
        content: {
          text: '[NODE_SNAPSHOT | t=1704672000000]\nDWS: healthy (45ms)\nInference: 3 nodes (120ms)',
        },
      },
    ],
  ],
}

// Snapshot parsing for analysis
const snapshotPattern = /\[NODE_SNAPSHOT \| t=(\d+)\]\nDWS: (healthy|unhealthy) \((\d+|timeout)ms\)\nInference: (\d+) nodes \((\d+|timeout)ms\)/

function parseSnapshot(text: string): NodeSnapshot | null {
  const match = text.match(snapshotPattern)
  if (!match) return null

  const [, timestamp, dwsStatus, dwsLatency, inferenceCount, inferenceLatency] = match
  return {
    timestamp: parseInt(timestamp, 10),
    dws: {
      healthy: dwsStatus === 'healthy',
      latencyMs: dwsLatency === 'timeout' ? -1 : parseInt(dwsLatency, 10),
    },
    inference: {
      count: parseInt(inferenceCount, 10),
      latencyMs: inferenceLatency === 'timeout' ? -1 : parseInt(inferenceLatency, 10),
    },
  }
}

function parseSnapshotsFromText(text: string): NodeSnapshot[] {
  const snapshots: NodeSnapshot[] = []

  // Try JSON parsing first (more reliable)
  const jsonPattern = /```json\n(\{[^`]+\})\n```/g
  for (const match of text.matchAll(jsonPattern)) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed.timestamp && parsed.dws && parsed.inference) {
        snapshots.push(parsed)
      }
    } catch {
      // Skip invalid JSON
    }
  }

  // Fall back to regex parsing if no JSON found
  if (snapshots.length === 0) {
    const regex = /\[NODE_SNAPSHOT \| t=(\d+)\]\nDWS: (healthy|unhealthy) \((\d+|timeout)ms\)\nInference: (\d+) nodes \((\d+|timeout)ms\)/g
    for (const match of text.matchAll(regex)) {
      const snapshot = parseSnapshot(match[0])
      if (snapshot) snapshots.push(snapshot)
    }
  }

  return snapshots.sort((a, b) => a.timestamp - b.timestamp)
}

function analyzeSnapshots(snapshots: NodeSnapshot[]): InfraHealthResult {
  const alerts: InfraAlert[] = []

  if (snapshots.length === 0) {
    return {
      status: 'degraded',
      alerts: [{ type: 'threshold', severity: 'warning', message: 'No snapshots to analyze' }],
      recommendation: 'Collect infrastructure snapshots before analysis',
    }
  }

  const latest = snapshots[snapshots.length - 1]

  // Threshold alerts
  if (!latest.dws.healthy) {
    alerts.push({
      type: 'threshold',
      severity: 'critical',
      message: 'DWS is unhealthy',
    })
  }

  if (latest.inference.count === 0) {
    alerts.push({
      type: 'threshold',
      severity: 'critical',
      message: 'No inference nodes available',
    })
  }

  if (latest.dws.latencyMs > 5000) {
    alerts.push({
      type: 'threshold',
      severity: 'warning',
      message: `DWS latency high: ${latest.dws.latencyMs}ms`,
    })
  }

  if (latest.inference.latencyMs > 5000) {
    alerts.push({
      type: 'threshold',
      severity: 'warning',
      message: `Inference API latency high: ${latest.inference.latencyMs}ms`,
    })
  }

  // Trend alerts (need at least 3 consecutive snapshots)
  if (snapshots.length >= 3) {
    const recent = snapshots.slice(-3)

    // Check declining node count
    const nodeCounts = recent.map((s) => s.inference.count)
    if (nodeCounts[0] > nodeCounts[1] && nodeCounts[1] > nodeCounts[2]) {
      alerts.push({
        type: 'trend',
        severity: 'warning',
        message: `Inference nodes declining: ${nodeCounts.join(' -> ')}`,
      })
    }

    // Check increasing latency
    const dwsLatencies = recent.map((s) => s.dws.latencyMs).filter((l) => l >= 0)
    if (dwsLatencies.length === 3 && dwsLatencies[0] < dwsLatencies[1] && dwsLatencies[1] < dwsLatencies[2]) {
      alerts.push({
        type: 'trend',
        severity: 'warning',
        message: `DWS latency increasing: ${dwsLatencies.join('ms -> ')}ms`,
      })
    }
  }

  // Determine status
  const hasCritical = alerts.some((a) => a.severity === 'critical')
  const hasWarning = alerts.some((a) => a.severity === 'warning')

  let status: 'healthy' | 'degraded' | 'critical'
  let recommendation: string

  if (hasCritical) {
    status = 'critical'
    recommendation = 'Immediate attention required. Check DWS service and inference node availability.'
  } else if (hasWarning) {
    status = 'degraded'
    recommendation = 'Monitor closely. Consider scaling inference nodes or investigating latency issues.'
  } else {
    status = 'healthy'
    recommendation = 'All systems operating normally.'
  }

  return { status, alerts, recommendation }
}

function formatHealthResult(result: InfraHealthResult): string {
  const lines: string[] = [`**Infrastructure Status: ${result.status.toUpperCase()}**\n`]

  if (result.alerts.length > 0) {
    lines.push('**Alerts:**')
    for (const alert of result.alerts) {
      const icon = alert.severity === 'critical' ? '[CRITICAL]' : '[WARNING]'
      lines.push(`- ${icon} ${alert.message}`)
    }
    lines.push('')
  }

  lines.push(`**Recommendation:** ${result.recommendation}`)

  return lines.join('\n')
}

export const analyzeInfraHealthAction: Action = {
  name: 'ANALYZE_INFRA_HEALTH',
  description: 'Analyze NODE_SNAPSHOT messages for threshold and trend alerts',
  similes: [
    'analyze infrastructure',
    'check infra health',
    'evaluate node status',
    'infrastructure analysis',
    'detect infra issues',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    callback?.({ text: 'Analyzing infrastructure snapshots...' })

    // Fetch recent messages from infra-monitoring room
    const memories = await runtime.getMemories({
      roomId: 'infra-monitoring' as UUID,
      count: 20,
      tableName: 'messages',
    })

    // Extract snapshot text from memories
    const snapshotTexts = memories
      .map((m) => (m.content as { text?: string })?.text ?? '')
      .filter((t) => t.includes('[NODE_SNAPSHOT'))

    const allText = snapshotTexts.join('\n')
    const snapshots = parseSnapshotsFromText(allText)
    const result = analyzeSnapshots(snapshots)

    callback?.({
      text: formatHealthResult(result),
      content: {
        type: 'infra_health_analysis',
        snapshotsAnalyzed: snapshots.length,
        ...result,
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: {
          text: '[NODE_SNAPSHOT | t=1704672000000]\nDWS: healthy (45ms)\nInference: 3 nodes (120ms)',
        },
      },
      {
        name: 'agent',
        content: {
          text: '**Infrastructure Status: HEALTHY**\n\n**Recommendation:** All systems operating normally.',
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: '[NODE_SNAPSHOT | t=1704672000000]\nDWS: unhealthy (timeout)\nInference: 0 nodes (timeout)',
        },
      },
      {
        name: 'agent',
        content: {
          text: '**Infrastructure Status: CRITICAL**\n\n**Alerts:**\n- [CRITICAL] DWS is unhealthy\n- [CRITICAL] No inference nodes available\n\n**Recommendation:** Immediate attention required.',
        },
      },
    ],
  ],
}
