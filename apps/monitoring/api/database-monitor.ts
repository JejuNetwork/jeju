/**
 * Database Health Monitor
 *
 * Monitors DWS-provisioned databases (PostgreSQL, SQLit) and reports
 * metrics to Prometheus for alerting and dashboards.
 */

import { getCurrentNetwork, getLocalhostHost } from '@jejunetwork/config'
import { z } from 'zod'

// Types

interface DatabaseMetrics {
  instanceId: string
  name: string
  type: 'postgres' | 'sqlit'
  status: 'healthy' | 'unhealthy' | 'unknown'
  responseTimeMs: number
  connectionCount: number
  lastChecked: number
}

interface MonitorConfig {
  dwsUrl: string
  checkIntervalMs: number
}

// Schemas

const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
})

// State

const metrics = new Map<string, DatabaseMetrics>()
let monitorInterval: ReturnType<typeof setInterval> | null = null

// Configuration

function getConfig(): MonitorConfig {
  const network = getCurrentNetwork()
  const dwsUrl =
    process.env.DWS_URL ??
    (network === 'localnet'
      ? `http://${getLocalhostHost()}:4030`
      : network === 'testnet'
        ? 'https://dws.testnet.jejunetwork.org'
        : 'https://dws.jejunetwork.org')

  return {
    dwsUrl,
    checkIntervalMs: Number(process.env.DB_CHECK_INTERVAL_MS ?? 30000),
  }
}

// Monitor functions

async function checkPostgresHealth(
  config: MonitorConfig,
  instanceId: string,
): Promise<DatabaseMetrics | null> {
  const startTime = Date.now()

  const healthResponse = await fetch(
    `${config.dwsUrl}/database/postgres/${instanceId}/health`,
    { signal: AbortSignal.timeout(10000) },
  )

  const responseTimeMs = Date.now() - startTime

  if (!healthResponse.ok) {
    return null
  }

  const healthData = HealthResponseSchema.parse(await healthResponse.json())

  return {
    instanceId,
    name: instanceId,
    type: 'postgres',
    status: healthData.status,
    responseTimeMs,
    connectionCount: 0, // Would need to query pg_stat_activity
    lastChecked: Date.now(),
  }
}

async function discoverPostgresInstances(
  config: MonitorConfig,
): Promise<string[]> {
  // In production, this would query the DWS registry for all postgres instances
  // For now, we look for known instances
  const knownInstances = [
    'indexer-localnet',
    'indexer-testnet',
    'indexer-mainnet',
  ]

  const instances: string[] = []

  for (const name of knownInstances) {
    const response = await fetch(`${config.dwsUrl}/database/postgres/${name}`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        // Use a system address for monitoring
        'x-wallet-address': '0x0000000000000000000000000000000000000000',
      },
    }).catch(() => null)

    if (response?.ok) {
      const data = await response.json().catch(() => null)
      if (data?.instance?.instanceId) {
        instances.push(data.instance.instanceId)
      }
    }
  }

  return instances
}

async function collectDatabaseMetrics(): Promise<void> {
  const config = getConfig()

  console.log('[DatabaseMonitor] Collecting database metrics...')

  // Discover postgres instances
  const pgInstances = await discoverPostgresInstances(config)

  for (const instanceId of pgInstances) {
    const metric = await checkPostgresHealth(config, instanceId)
    if (metric) {
      metrics.set(instanceId, metric)
      console.log(
        `[DatabaseMonitor] ${instanceId}: ${metric.status} (${metric.responseTimeMs}ms)`,
      )
    }
  }
}

// Prometheus metrics export

export function getPrometheusMetrics(): string {
  const lines: string[] = [
    '# HELP dws_database_health Database health status (1=healthy, 0=unhealthy)',
    '# TYPE dws_database_health gauge',
  ]

  for (const [_instanceId, metric] of metrics) {
    const healthValue = metric.status === 'healthy' ? 1 : 0
    lines.push(
      `dws_database_health{instance="${metric.instanceId}",name="${metric.name}",type="${metric.type}"} ${healthValue}`,
    )
  }

  lines.push('')
  lines.push(
    '# HELP dws_database_response_time_ms Database response time in milliseconds',
  )
  lines.push('# TYPE dws_database_response_time_ms gauge')

  for (const [_instanceId, metric] of metrics) {
    lines.push(
      `dws_database_response_time_ms{instance="${metric.instanceId}",name="${metric.name}",type="${metric.type}"} ${metric.responseTimeMs}`,
    )
  }

  lines.push('')
  lines.push(
    '# HELP dws_database_last_check_timestamp Unix timestamp of last health check',
  )
  lines.push('# TYPE dws_database_last_check_timestamp gauge')

  for (const [_instanceId, metric] of metrics) {
    lines.push(
      `dws_database_last_check_timestamp{instance="${metric.instanceId}",name="${metric.name}",type="${metric.type}"} ${Math.floor(metric.lastChecked / 1000)}`,
    )
  }

  return lines.join('\n')
}

// API handlers

export function getDatabaseStatus(): { databases: DatabaseMetrics[] } {
  return {
    databases: Array.from(metrics.values()),
  }
}

export function getDatabaseHealth(instanceId: string): DatabaseMetrics | null {
  return metrics.get(instanceId) ?? null
}

// Lifecycle

export function startDatabaseMonitor(): void {
  if (monitorInterval) {
    return
  }

  const config = getConfig()
  console.log(
    `[DatabaseMonitor] Starting with ${config.checkIntervalMs}ms interval`,
  )

  // Initial collection
  collectDatabaseMetrics().catch((error) => {
    console.error('[DatabaseMonitor] Initial collection failed:', error)
  })

  // Periodic collection
  monitorInterval = setInterval(() => {
    collectDatabaseMetrics().catch((error) => {
      console.error('[DatabaseMonitor] Collection failed:', error)
    })
  }, config.checkIntervalMs)
}

export function stopDatabaseMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval)
    monitorInterval = null
    console.log('[DatabaseMonitor] Stopped')
  }
}

// Auto-start if run directly
if (import.meta.main) {
  startDatabaseMonitor()
}
