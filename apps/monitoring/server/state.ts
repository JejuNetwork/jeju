/**
 * Decentralized State Management for Monitoring
 * 
 * Persists alert history and incident reports to CovenantSQL.
 * Prometheus remains the primary metrics store, but CQL is used for:
 * - Historical alert records
 * - Incident reports and resolutions
 * - Cross-node health summaries
 */

import { getCQL, type CQLClient } from '@jejunetwork/db';
import { getCacheClient, type CacheClient } from '@jejunetwork/shared';

const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'monitoring';
const NETWORK = process.env.NETWORK ?? 'localnet';

let cqlClient: CQLClient | null = null;
let cacheClient: CacheClient | null = null;
let useFallback = false;
let initialized = false;

// In-memory fallback stores
const memoryAlerts = new Map<string, AlertRow>();
const memoryIncidents = new Map<string, IncidentRow>();
const memoryHealthSnapshots: HealthSnapshotRow[] = [];

async function getCQLClient(): Promise<CQLClient | null> {
  if (useFallback) return null;
  
  if (!cqlClient) {
    cqlClient = getCQL({
      blockProducerEndpoint: process.env.CQL_BLOCK_PRODUCER_ENDPOINT ?? 'http://localhost:4300',
      databaseId: CQL_DATABASE_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    });
    
    const healthy = await cqlClient.isHealthy();
    if (!healthy && (NETWORK === 'localnet' || NETWORK === 'Jeju')) {
      console.log('[Monitoring State] CQL unavailable, using in-memory fallback');
      useFallback = true;
      return null;
    }
    
    if (!healthy) {
      console.warn('[Monitoring State] CQL not available - alert history will be in-memory only');
      useFallback = true;
      return null;
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
    if (client) {
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
    } else {
      memoryAlerts.set(row.alert_id, row);
    }
  },
  
  async listRecent(params?: {
    status?: string;
    severity?: string;
    limit?: number;
    since?: number;
  }): Promise<AlertRow[]> {
    const client = await getCQLClient();
    
    if (client) {
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
    }
    
    let rows = Array.from(memoryAlerts.values());
    if (params?.status) rows = rows.filter(r => r.status === params.status);
    if (params?.severity) rows = rows.filter(r => r.severity === params.severity);
    if (params?.since) rows = rows.filter(r => r.started_at >= params.since!);
    rows.sort((a, b) => b.started_at - a.started_at);
    return rows.slice(0, params?.limit ?? 100);
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
    if (client) {
      await client.exec(
        `INSERT INTO incidents (incident_id, title, description, severity, status, alert_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          row.incident_id, row.title, row.description, row.severity,
          row.status, row.alert_ids, row.created_at,
        ],
        CQL_DATABASE_ID
      );
    } else {
      memoryIncidents.set(row.incident_id, row);
    }
  },
  
  async resolve(incidentId: string, resolution: {
    rootCause?: string;
    resolution: string;
    resolvedBy: string;
  }): Promise<void> {
    const now = Date.now();
    
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `UPDATE incidents SET status = 'resolved', resolved_at = ?, root_cause = ?, resolution = ?, resolved_by = ?
         WHERE incident_id = ?`,
        [now, resolution.rootCause ?? null, resolution.resolution, resolution.resolvedBy, incidentId],
        CQL_DATABASE_ID
      );
    } else {
      const row = memoryIncidents.get(incidentId);
      if (row) {
        row.status = 'resolved';
        row.resolved_at = now;
        row.root_cause = resolution.rootCause ?? null;
        row.resolution = resolution.resolution;
        row.resolved_by = resolution.resolvedBy;
      }
    }
  },
  
  async listOpen(): Promise<IncidentRow[]> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<IncidentRow>(
        'SELECT * FROM incidents WHERE status = ? ORDER BY created_at DESC',
        ['open'],
        CQL_DATABASE_ID
      );
      return result.rows;
    }
    return Array.from(memoryIncidents.values())
      .filter(r => r.status === 'open')
      .sort((a, b) => b.created_at - a.created_at);
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
    if (client) {
      await client.exec(
        `INSERT INTO health_snapshots (id, timestamp, overall_health, service_statuses, metrics_summary, alerts_summary)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, row.timestamp, row.overall_health, row.service_statuses, row.metrics_summary, row.alerts_summary],
        CQL_DATABASE_ID
      );
      
      // Keep only last 7 days of snapshots
      const cutoff = now - (7 * 24 * 60 * 60 * 1000);
      await client.exec('DELETE FROM health_snapshots WHERE timestamp < ?', [cutoff], CQL_DATABASE_ID);
    } else {
      memoryHealthSnapshots.push(row);
      // Keep only last 1000 in memory
      if (memoryHealthSnapshots.length > 1000) {
        memoryHealthSnapshots.shift();
      }
    }
  },
  
  async getLatest(): Promise<HealthSnapshotRow | null> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<HealthSnapshotRow>(
        'SELECT * FROM health_snapshots ORDER BY timestamp DESC LIMIT 1',
        [],
        CQL_DATABASE_ID
      );
      return result.rows[0] ?? null;
    }
    return memoryHealthSnapshots[memoryHealthSnapshots.length - 1] ?? null;
  },
};

// Initialize state
export async function initializeMonitoringState(): Promise<void> {
  if (initialized) return;
  await getCQLClient();
  initialized = true;
  console.log(`[Monitoring State] Initialized (${useFallback ? 'in-memory' : 'CQL'})`);
}

// Get state mode
export function getStateMode(): 'cql' | 'memory' {
  return useFallback ? 'memory' : 'cql';
}
