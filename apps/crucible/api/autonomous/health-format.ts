/**
 * Health snapshot formatting utilities for infrastructure monitoring
 */

export interface HealthSnapshot {
  timestamp: number
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
  dws: { latencyMs: number; status: string }
  crucible: { latencyMs: number; status: string }
  indexer: { latencyMs: number; status: string }
  inference: { nodeCount: number; latencyMs: number }
  alerts: { p0: number; p1: number; p2: number }
}

/**
 * Format a health snapshot as a compact room message
 * Output: [HEALTH | t=1704672000 | status=HEALTHY] dws=45ms crucible=12ms indexer=8ms inference=3
 */
export function formatHealthMessage(data: HealthSnapshot): string {
  const header = `[HEALTH | t=${data.timestamp} | status=${data.status}]`
  const metrics = `dws=${data.dws.latencyMs}ms crucible=${data.crucible.latencyMs}ms indexer=${data.indexer.latencyMs}ms inference=${data.inference.nodeCount}`

  if (data.alerts.p0 > 0 || data.alerts.p1 > 0 || data.alerts.p2 > 0) {
    return `${header} ${metrics} alerts=P0:${data.alerts.p0},P1:${data.alerts.p1},P2:${data.alerts.p2}`
  }

  return `${header} ${metrics}`
}

/**
 * Parse a health message back to a HealthSnapshot
 * Returns null if the message format is invalid
 */
export function parseHealthMessage(message: string): HealthSnapshot | null {
  const headerMatch = message.match(/^\[HEALTH \| t=(\d+) \| status=(HEALTHY|DEGRADED|CRITICAL)\]/)
  if (!headerMatch) return null

  const timestamp = parseInt(headerMatch[1], 10)
  const status = headerMatch[1 + 1] as 'HEALTHY' | 'DEGRADED' | 'CRITICAL'

  const dwsMatch = message.match(/dws=(\d+)ms/)
  const crucibleMatch = message.match(/crucible=(\d+)ms/)
  const indexerMatch = message.match(/indexer=(\d+)ms/)
  const inferenceMatch = message.match(/inference=(\d+)/)
  const alertsMatch = message.match(/alerts=P0:(\d+),P1:(\d+),P2:(\d+)/)

  if (!dwsMatch || !crucibleMatch || !indexerMatch || !inferenceMatch) return null

  return {
    timestamp,
    status,
    dws: { latencyMs: parseInt(dwsMatch[1], 10), status: 'ok' },
    crucible: { latencyMs: parseInt(crucibleMatch[1], 10), status: 'ok' },
    indexer: { latencyMs: parseInt(indexerMatch[1], 10), status: 'ok' },
    inference: {
      nodeCount: parseInt(inferenceMatch[1], 10),
      latencyMs: 0,
    },
    alerts: alertsMatch
      ? {
          p0: parseInt(alertsMatch[1], 10),
          p1: parseInt(alertsMatch[2], 10),
          p2: parseInt(alertsMatch[3], 10),
        }
      : { p0: 0, p1: 0, p2: 0 },
  }
}

/**
 * Convert a GET_INFRA_STATUS result to a HealthSnapshot
 *
 * GET_INFRA_STATUS returns:
 * {
 *   timestamp: number,
 *   status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL',
 *   alerts: Array<{ severity, source, message, metric?, value? }>,
 *   metrics: { dws_health: {...}, crucible_health: {...}, indexer_health: {...}, inference_nodes: {...} },
 *   summary: { inferenceNodeCount, p0Count, p1Count, p2Count }
 * }
 */
export function infraStatusToSnapshot(result: Record<string, unknown>): HealthSnapshot {
  // Extract metrics - GET_INFRA_STATUS uses keys like dws_health, crucible_health, etc.
  const metrics = (result.metrics ?? {}) as Record<string, { status: string; latencyMs: number; error?: string }>
  const summary = (result.summary ?? {}) as { inferenceNodeCount?: number; p0Count?: number; p1Count?: number; p2Count?: number }

  // Map metric keys to service data
  const dwsMetric = metrics['dws_health'] ?? { status: 'unknown', latencyMs: 0 }
  const crucibleMetric = metrics['crucible_health'] ?? { status: 'unknown', latencyMs: 0 }
  const indexerMetric = metrics['indexer_health'] ?? { status: 'unknown', latencyMs: 0 }
  const inferenceMetric = metrics['inference_nodes'] ?? { status: 'unknown', latencyMs: 0 }

  // Status is already computed by GET_INFRA_STATUS
  const status = (result.status as 'HEALTHY' | 'DEGRADED' | 'CRITICAL') ?? 'HEALTHY'

  return {
    timestamp: (result.timestamp as number) ?? Date.now(),
    status,
    dws: { latencyMs: dwsMetric.latencyMs, status: dwsMetric.status },
    crucible: { latencyMs: crucibleMetric.latencyMs, status: crucibleMetric.status },
    indexer: { latencyMs: indexerMetric.latencyMs, status: indexerMetric.status },
    inference: {
      nodeCount: summary.inferenceNodeCount ?? 0,
      latencyMs: inferenceMetric.latencyMs ?? 0,
    },
    alerts: {
      p0: summary.p0Count ?? 0,
      p1: summary.p1Count ?? 0,
      p2: summary.p2Count ?? 0,
    },
  }
}
