/** Monitoring state management with CovenantSQL persistence. */

import { getCurrentNetwork } from '@jejunetwork/config'
import { type CQLClient, getCQL } from '@jejunetwork/db'

const CQL_DATABASE_ID_ENV = process.env.CQL_DATABASE_ID
if (!CQL_DATABASE_ID_ENV) {
  console.warn('⚠️ CQL_DATABASE_ID not set, defaulting to "monitoring"')
}
const databaseId = CQL_DATABASE_ID_ENV ?? 'monitoring'

let cqlClient: CQLClient | null = null
let initialized = false
let initializingPromise: Promise<CQLClient> | null = null

async function getCQLClient(): Promise<CQLClient> {
  if (cqlClient) return cqlClient
  if (initializingPromise) return initializingPromise

  initializingPromise = (async () => {
    if (cqlClient) return cqlClient

    const client = getCQL({
      databaseId,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })

    const healthy = await client.isHealthy()
    if (!healthy) {
      initializingPromise = null
      const network = getCurrentNetwork()
      throw new Error(
        `Monitoring requires CovenantSQL for decentralized state (network: ${network}).\n` +
          'Ensure CQL is running: docker compose up -d cql',
      )
    }

    cqlClient = client
    await ensureTablesExist()

    return cqlClient
  })()

  return initializingPromise
}

async function ensureTablesExist(): Promise<void> {
  if (!cqlClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS alert_history (
      alert_id TEXT PRIMARY KEY,
      alert_name TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT,
      labels TEXT DEFAULT '{}',
      annotations TEXT DEFAULT '{}',
      started_at INTEGER NOT NULL,
      resolved_at INTEGER,
      duration_seconds INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS incidents (
      incident_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      alert_ids TEXT DEFAULT '[]',
      root_cause TEXT,
      resolution TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolved_by TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS health_snapshots (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      overall_health TEXT NOT NULL,
      service_statuses TEXT NOT NULL DEFAULT '{}',
      metrics_summary TEXT DEFAULT '{}',
      alerts_summary TEXT DEFAULT '{}'
    )`,
  ]

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_alerts_status ON alert_history(status)',
    'CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alert_history(severity)',
    'CREATE INDEX IF NOT EXISTS idx_alerts_started ON alert_history(started_at)',
    'CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)',
    'CREATE INDEX IF NOT EXISTS idx_health_timestamp ON health_snapshots(timestamp)',
  ]

  for (const ddl of tables) {
    await cqlClient.exec(ddl, [], databaseId)
  }

  for (const idx of indexes) {
    await cqlClient.exec(idx, [], databaseId).catch((err: Error) => {
      if (!err.message.includes('already exists')) {
        console.warn(
          `[Monitoring State] Index creation warning: ${err.message}`,
        )
      }
    })
  }

  console.log('[Monitoring State] CovenantSQL tables ensured')
}

interface AlertRow {
  alert_id: string
  alert_name: string
  severity: string
  status: string
  description: string | null
  labels: string
  annotations: string
  started_at: number
  resolved_at: number | null
  duration_seconds: number | null
  created_at: number
}

interface IncidentRow {
  incident_id: string
  title: string
  description: string | null
  severity: string
  status: string
  alert_ids: string
  root_cause: string | null
  resolution: string | null
  created_at: number
  resolved_at: number | null
  resolved_by: string | null
}

interface HealthSnapshotRow {
  id: string
  timestamp: number
  overall_health: string
  service_statuses: string
  metrics_summary: string
  alerts_summary: string
}

// Alert History Operations
export const alertState = {
  async save(alert: {
    alertId: string
    alertName: string
    severity: 'critical' | 'warning' | 'info'
    status: 'firing' | 'resolved'
    description?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    startedAt: number
    resolvedAt?: number
  }): Promise<void> {
    const now = Date.now()
    const row: AlertRow = {
      alert_id: alert.alertId,
      alert_name: alert.alertName,
      severity: alert.severity,
      status: alert.status,
      description: alert.description ?? null,
      labels: JSON.stringify(alert.labels ?? {}),
      annotations: JSON.stringify(alert.annotations ?? {}),
      started_at: alert.startedAt,
      resolved_at: alert.resolvedAt ?? null,
      duration_seconds: alert.resolvedAt
        ? Math.floor((alert.resolvedAt - alert.startedAt) / 1000)
        : null,
      created_at: now,
    }

    const client = await getCQLClient()
    await client.exec(
      `INSERT INTO alert_history (alert_id, alert_name, severity, status, description, labels, annotations, started_at, resolved_at, duration_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(alert_id) DO UPDATE SET
       status = excluded.status, resolved_at = excluded.resolved_at, duration_seconds = excluded.duration_seconds`,
      [
        row.alert_id,
        row.alert_name,
        row.severity,
        row.status,
        row.description,
        row.labels,
        row.annotations,
        row.started_at,
        row.resolved_at,
        row.duration_seconds,
        row.created_at,
      ],
      databaseId,
    )
  },

  async listRecent(params?: {
    status?: string
    severity?: string
    limit?: number
    since?: number
  }): Promise<AlertRow[]> {
    const client = await getCQLClient()
    const conditions: string[] = []
    const values: Array<string | number> = []

    if (params?.status) {
      conditions.push('status = ?')
      values.push(params.status)
    }
    if (params?.severity) {
      conditions.push('severity = ?')
      values.push(params.severity)
    }
    if (params?.since) {
      conditions.push('started_at >= ?')
      values.push(params.since)
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = params?.limit ?? 100
    values.push(limit)

    const result = await client.query<AlertRow>(
      `SELECT * FROM alert_history ${where} ORDER BY started_at DESC LIMIT ?`,
      values,
      databaseId,
    )
    return result.rows
  },

  async getStats(since: number): Promise<{
    total: number
    firing: number
    resolved: number
    bySeverity: Record<string, number>
    avgResolutionSeconds: number
  }> {
    const maxLookbackMs = 30 * 24 * 60 * 60 * 1000
    const minSince = Math.max(since, Date.now() - maxLookbackMs)

    const client = await getCQLClient()
    const statusCounts = await client.query<{ status: string; count: number }>(
      'SELECT status, COUNT(*) as count FROM alert_history WHERE started_at >= ? GROUP BY status',
      [minSince],
      databaseId,
    )

    let firing = 0
    let resolved = 0
    let total = 0
    for (const row of statusCounts.rows) {
      total += row.count
      if (row.status === 'firing') firing = row.count
      if (row.status === 'resolved') resolved = row.count
    }

    const severityCounts = await client.query<{
      severity: string
      count: number
    }>(
      'SELECT severity, COUNT(*) as count FROM alert_history WHERE started_at >= ? GROUP BY severity',
      [minSince],
      databaseId,
    )

    const bySeverity: Record<string, number> = {}
    for (const row of severityCounts.rows) {
      bySeverity[row.severity] = row.count
    }

    const avgResult = await client.query<{ avg_duration: number | null }>(
      'SELECT AVG(duration_seconds) as avg_duration FROM alert_history WHERE started_at >= ? AND duration_seconds IS NOT NULL',
      [minSince],
      databaseId,
    )

    const avgResolutionSeconds = avgResult.rows[0]?.avg_duration ?? 0

    return {
      total,
      firing,
      resolved,
      bySeverity,
      avgResolutionSeconds: Math.round(avgResolutionSeconds),
    }
  },
}

export const incidentState = {
  async create(incident: {
    incidentId: string
    title: string
    description?: string
    severity: 'critical' | 'high' | 'medium' | 'low'
    alertIds?: string[]
  }): Promise<void> {
    const row: IncidentRow = {
      incident_id: incident.incidentId,
      title: incident.title,
      description: incident.description ?? null,
      severity: incident.severity,
      status: 'open',
      alert_ids: JSON.stringify(incident.alertIds ?? []),
      root_cause: null,
      resolution: null,
      created_at: Date.now(),
      resolved_at: null,
      resolved_by: null,
    }

    const client = await getCQLClient()
    await client.exec(
      `INSERT INTO incidents (incident_id, title, description, severity, status, alert_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.incident_id,
        row.title,
        row.description,
        row.severity,
        row.status,
        row.alert_ids,
        row.created_at,
      ],
      databaseId,
    )
  },

  async resolve(
    incidentId: string,
    resolution: {
      rootCause?: string
      resolution: string
      resolvedBy: string
    },
  ): Promise<void> {
    const now = Date.now()
    const client = await getCQLClient()
    await client.exec(
      `UPDATE incidents SET status = 'resolved', resolved_at = ?, root_cause = ?, resolution = ?, resolved_by = ?
       WHERE incident_id = ?`,
      [
        now,
        resolution.rootCause ?? null,
        resolution.resolution,
        resolution.resolvedBy,
        incidentId,
      ],
      databaseId,
    )
  },

  async listOpen(): Promise<IncidentRow[]> {
    const client = await getCQLClient()
    const result = await client.query<IncidentRow>(
      'SELECT * FROM incidents WHERE status = ? ORDER BY created_at DESC',
      ['open'],
      databaseId,
    )
    return result.rows
  },
}

export const healthState = {
  async saveSnapshot(snapshot: {
    overallHealth: 'healthy' | 'degraded' | 'unhealthy'
    serviceStatuses: Record<string, 'up' | 'down' | 'degraded'>
    metricsSummary?: Record<string, number>
    alertsSummary?: { firing: number; total: number }
  }): Promise<void> {
    const now = Date.now()
    const row: HealthSnapshotRow = {
      id: `snapshot-${now}`,
      timestamp: now,
      overall_health: snapshot.overallHealth,
      service_statuses: JSON.stringify(snapshot.serviceStatuses),
      metrics_summary: JSON.stringify(snapshot.metricsSummary ?? {}),
      alerts_summary: JSON.stringify(snapshot.alertsSummary ?? {}),
    }

    const client = await getCQLClient()
    await client.exec(
      `INSERT INTO health_snapshots (id, timestamp, overall_health, service_statuses, metrics_summary, alerts_summary)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.timestamp,
        row.overall_health,
        row.service_statuses,
        row.metrics_summary,
        row.alerts_summary,
      ],
      databaseId,
    )

    // Keep only last 7 days of snapshots
    const cutoff = now - 7 * 24 * 60 * 60 * 1000
    await client.exec(
      'DELETE FROM health_snapshots WHERE timestamp < ?',
      [cutoff],
      databaseId,
    )
  },

  async getLatest(): Promise<HealthSnapshotRow | null> {
    const client = await getCQLClient()
    const result = await client.query<HealthSnapshotRow>(
      'SELECT * FROM health_snapshots ORDER BY timestamp DESC LIMIT 1',
      [],
      databaseId,
    )
    return result.rows[0] ?? null
  },
}

export async function initializeMonitoringState(): Promise<void> {
  if (initialized) return
  await getCQLClient()
  initialized = true
  console.log('[Monitoring State] Initialized with CovenantSQL')
}

export function getStateMode(): 'cql' {
  return 'cql'
}
