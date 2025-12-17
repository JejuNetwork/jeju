/**
 * Decentralized State Management for Monitoring
 * 
 * Persists alert history and incident reports to CovenantSQL.
 * CQL is REQUIRED - automatically configured per network.
 */

import { getCQL, type CQLClient } from '@jejunetwork/db';
import { getCacheClient, type CacheClient } from '@jejunetwork/shared';
import { getCurrentNetwork } from '@jejunetwork/config';

const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'monitoring';

let cqlClient: CQLClient | null = null;
let cacheClient: CacheClient | null = null;
let initialized = false;

async function getCQLClient(): Promise<CQLClient> {
  if (!cqlClient) {
    // CQL URL is automatically resolved from network config
    cqlClient = getCQL({
      databaseId: CQL_DATABASE_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    });
    
    const healthy = await cqlClient.isHealthy();
    if (!healthy) {
      const network = getCurrentNetwork();
      throw new Error(
        `Monitoring requires CovenantSQL for decentralized state (network: ${network}).\n` +
        'Ensure CQL is running: docker compose up -d cql'
      );
    }
    
    await ensureTablesExist();
  }
  
  return cqlClient;
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('monitoring');
  }
  return cacheClient;
}

async function ensureTablesExist(): Promise<void> {
  if (!cqlClient) return;
  
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
  ];
  
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_alerts_status ON alert_history(status)',
    'CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alert_history(severity)',
    'CREATE INDEX IF NOT EXISTS idx_alerts_started ON alert_history(started_at)',
    'CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)',
    'CREATE INDEX IF NOT EXISTS idx_health_timestamp ON health_snapshots(timestamp)',
  ];
  
  for (const ddl of tables) {
    await cqlClient.exec(ddl, [], CQL_DATABASE_ID);
  }
  
  for (const idx of indexes) {
    await cqlClient.exec(idx, [], CQL_DATABASE_ID).catch(() => {});
  }
  
  console.log('[Monitoring State] CovenantSQL tables ensured');
}

// Row types
interface AlertRow {
  alert_id: string;
  alert_name: string;
  severity: string;
  status: string;
  description: string | null;
  labels: string;
  annotations: string;
  started_at: number;
  resolved_at: number | null;
  duration_seconds: number | null;
  created_at: number;
}

interface IncidentRow {
  incident_id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  alert_ids: string;
  root_cause: string | null;
  resolution: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
}

interface HealthSnapshotRow {
  id: string;
  timestamp: number;
  overall_health: string;
  service_statuses: string;
  metrics_summary: string;
  alerts_summary: string;
}

// Alert History Operations
export const alertState = {
  async save(alert: {
    alertId: string;
    alertName: string;
    severity: 'critical' | 'warning' | 'info';
    status: 'firing' | 'resolved';
    description?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    startedAt: number;
    resolvedAt?: number;
  }): Promise<void> {
    const now = Date.now();
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
    };
    
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO alert_history (alert_id, alert_name, severity, status, description, labels, annotations, started_at, resolved_at, duration_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(alert_id) DO UPDATE SET
       status = excluded.status, resolved_at = excluded.resolved_at, duration_seconds = excluded.duration_seconds`,
      [
        row.alert_id, row.alert_name, row.severity, row.status, row.description,
        row.labels, row.annotations, row.started_at, row.resolved_at,
        row.duration_seconds, row.created_at,
      ],
      CQL_DATABASE_ID
    );
  },
  
  async listRecent(params?: {
    status?: string;
    severity?: string;
    limit?: number;
    since?: number;
  }): Promise<AlertRow[]> {
    const client = await getCQLClient();
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    
    if (params?.status) {
      conditions.push('status = ?');
      values.push(params.status);
    }
    if (params?.severity) {
      conditions.push('severity = ?');
      values.push(params.severity);
    }
    if (params?.since) {
      conditions.push('started_at >= ?');
      values.push(params.since);
    }
    
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(params?.limit ?? 100);
    
    const result = await client.query<AlertRow>(
      `SELECT * FROM alert_history ${where} ORDER BY started_at DESC LIMIT ?`,
      values,
      CQL_DATABASE_ID
    );
    return result.rows;
  },
  
  async getStats(since: number): Promise<{
    total: number;
    firing: number;
    resolved: number;
    bySeverity: Record<string, number>;
    avgResolutionSeconds: number;
  }> {
    const alerts = await this.listRecent({ since, limit: 10000 });
    
    const firing = alerts.filter(a => a.status === 'firing').length;
    const resolved = alerts.filter(a => a.status === 'resolved').length;
    
    const bySeverity: Record<string, number> = {};
    alerts.forEach(a => {
      bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    });
    
    const resolvedWithDuration = alerts.filter(a => a.duration_seconds !== null);
    const avgResolutionSeconds = resolvedWithDuration.length > 0
      ? resolvedWithDuration.reduce((sum, a) => sum + (a.duration_seconds ?? 0), 0) / resolvedWithDuration.length
      : 0;
    
    return {
      total: alerts.length,
      firing,
      resolved,
      bySeverity,
      avgResolutionSeconds: Math.round(avgResolutionSeconds),
    };
  },
};

// Incident Operations
export const incidentState = {
  async create(incident: {
    incidentId: string;
    title: string;
    description?: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    alertIds?: string[];
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
    };
    
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO incidents (incident_id, title, description, severity, status, alert_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.incident_id, row.title, row.description, row.severity,
        row.status, row.alert_ids, row.created_at,
      ],
      CQL_DATABASE_ID
    );
  },
  
  async resolve(incidentId: string, resolution: {
    rootCause?: string;
    resolution: string;
    resolvedBy: string;
  }): Promise<void> {
    const now = Date.now();
    const client = await getCQLClient();
    await client.exec(
      `UPDATE incidents SET status = 'resolved', resolved_at = ?, root_cause = ?, resolution = ?, resolved_by = ?
       WHERE incident_id = ?`,
      [now, resolution.rootCause ?? null, resolution.resolution, resolution.resolvedBy, incidentId],
      CQL_DATABASE_ID
    );
  },
  
  async listOpen(): Promise<IncidentRow[]> {
    const client = await getCQLClient();
    const result = await client.query<IncidentRow>(
      'SELECT * FROM incidents WHERE status = ? ORDER BY created_at DESC',
      ['open'],
      CQL_DATABASE_ID
    );
    return result.rows;
  },
};

// Health Snapshot Operations
export const healthState = {
  async saveSnapshot(snapshot: {
    overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    serviceStatuses: Record<string, 'up' | 'down' | 'degraded'>;
    metricsSummary?: Record<string, number>;
    alertsSummary?: { firing: number; total: number };
  }): Promise<void> {
    const now = Date.now();
    const row: HealthSnapshotRow = {
      id: `snapshot-${now}`,
      timestamp: now,
      overall_health: snapshot.overallHealth,
      service_statuses: JSON.stringify(snapshot.serviceStatuses),
      metrics_summary: JSON.stringify(snapshot.metricsSummary ?? {}),
      alerts_summary: JSON.stringify(snapshot.alertsSummary ?? {}),
    };
    
    const client = await getCQLClient();
    await client.exec(
      `INSERT INTO health_snapshots (id, timestamp, overall_health, service_statuses, metrics_summary, alerts_summary)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.timestamp, row.overall_health, row.service_statuses, row.metrics_summary, row.alerts_summary],
      CQL_DATABASE_ID
    );
    
    // Keep only last 7 days of snapshots
    const cutoff = now - (7 * 24 * 60 * 60 * 1000);
    await client.exec('DELETE FROM health_snapshots WHERE timestamp < ?', [cutoff], CQL_DATABASE_ID);
  },
  
  async getLatest(): Promise<HealthSnapshotRow | null> {
    const client = await getCQLClient();
    const result = await client.query<HealthSnapshotRow>(
      'SELECT * FROM health_snapshots ORDER BY timestamp DESC LIMIT 1',
      [],
      CQL_DATABASE_ID
    );
    return result.rows[0] ?? null;
  },
};

// Initialize state
export async function initializeMonitoringState(): Promise<void> {
  if (initialized) return;
  await getCQLClient();
  initialized = true;
  console.log('[Monitoring State] Initialized with CovenantSQL');
}

// Get state mode - always CQL, no fallbacks
export function getStateMode(): 'cql' {
  return 'cql';
}
