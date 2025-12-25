/** Unit tests for A2A and MCP skill execution logic. */

import { describe, expect, test } from 'bun:test'

type ServiceStatus = 'healthy' | 'degraded' | 'down'

interface PrometheusTarget {
  health: string
  labels: { job: string; instance: string }
  lastScrapeDuration?: number
}

interface ServiceStats {
  name: string
  status: ServiceStatus
  instances: number
  healthy: number
}

function calculateServiceStatus(
  targets: PrometheusTarget[],
  serviceName: string,
): {
  status: ServiceStatus
  latency: number
  instances: number
  healthy: number
} {
  const serviceTargets = targets.filter((t) => t.labels.job === serviceName)

  if (serviceTargets.length === 0) {
    return { status: 'down', latency: 0, instances: 0, healthy: 0 }
  }

  const upCount = serviceTargets.filter((t) => t.health === 'up').length
  const avgLatency =
    serviceTargets.reduce(
      (sum, t) => sum + (t.lastScrapeDuration ?? 0) * 1000,
      0,
    ) / serviceTargets.length

  let status: ServiceStatus = 'healthy'
  if (upCount === 0) {
    status = 'down'
  } else if (upCount < serviceTargets.length) {
    status = 'degraded'
  }

  return {
    status,
    latency: Math.round(avgLatency),
    instances: serviceTargets.length,
    healthy: upCount,
  }
}

function aggregateAllServices(targets: PrometheusTarget[]): ServiceStats[] {
  const serviceMap = new Map<string, { up: number; total: number }>()

  for (const target of targets) {
    const job = target.labels.job
    const current = serviceMap.get(job) ?? { up: 0, total: 0 }
    current.total++
    if (target.health === 'up') current.up++
    serviceMap.set(job, current)
  }

  return Array.from(serviceMap.entries()).map(([name, stats]) => ({
    name,
    status:
      stats.up === stats.total ? 'healthy' : stats.up > 0 ? 'degraded' : 'down',
    instances: stats.total,
    healthy: stats.up,
  }))
}

describe('Service Health Calculation', () => {
  const mockTargets: PrometheusTarget[] = [
    {
      health: 'up',
      labels: { job: 'api-server', instance: 'api-1:8080' },
      lastScrapeDuration: 0.05,
    },
    {
      health: 'up',
      labels: { job: 'api-server', instance: 'api-2:8080' },
      lastScrapeDuration: 0.03,
    },
    {
      health: 'down',
      labels: { job: 'api-server', instance: 'api-3:8080' },
      lastScrapeDuration: 0.1,
    },
    {
      health: 'up',
      labels: { job: 'database', instance: 'db-1:5432' },
      lastScrapeDuration: 0.02,
    },
    {
      health: 'up',
      labels: { job: 'database', instance: 'db-2:5432' },
      lastScrapeDuration: 0.015,
    },
    {
      health: 'down',
      labels: { job: 'cache', instance: 'redis-1:6379' },
      lastScrapeDuration: 0,
    },
  ]

  test('calculates healthy status when all instances up', () => {
    const result = calculateServiceStatus(mockTargets, 'database')
    expect(result.status).toBe('healthy')
    expect(result.instances).toBe(2)
    expect(result.healthy).toBe(2)
  })

  test('calculates degraded status when some instances down', () => {
    const result = calculateServiceStatus(mockTargets, 'api-server')
    expect(result.status).toBe('degraded')
    expect(result.instances).toBe(3)
    expect(result.healthy).toBe(2)
  })

  test('calculates down status when all instances down', () => {
    const result = calculateServiceStatus(mockTargets, 'cache')
    expect(result.status).toBe('down')
    expect(result.instances).toBe(1)
    expect(result.healthy).toBe(0)
  })

  test('returns down for non-existent service', () => {
    const result = calculateServiceStatus(mockTargets, 'non-existent')
    expect(result.status).toBe('down')
    expect(result.instances).toBe(0)
    expect(result.healthy).toBe(0)
  })

  test('calculates average latency correctly', () => {
    const result = calculateServiceStatus(mockTargets, 'api-server')
    // (0.05 + 0.03 + 0.1) / 3 * 1000 = 60ms
    expect(result.latency).toBe(60)
  })

  test('handles targets without lastScrapeDuration', () => {
    const targetsNoLatency: PrometheusTarget[] = [
      { health: 'up', labels: { job: 'test', instance: 'test-1' } },
    ]
    const result = calculateServiceStatus(targetsNoLatency, 'test')
    expect(result.latency).toBe(0)
  })
})

describe('All Services Aggregation', () => {
  const mockTargets: PrometheusTarget[] = [
    { health: 'up', labels: { job: 'api-server', instance: 'api-1:8080' } },
    { health: 'up', labels: { job: 'api-server', instance: 'api-2:8080' } },
    { health: 'down', labels: { job: 'api-server', instance: 'api-3:8080' } },
    { health: 'up', labels: { job: 'database', instance: 'db-1:5432' } },
    { health: 'up', labels: { job: 'database', instance: 'db-2:5432' } },
    { health: 'down', labels: { job: 'cache', instance: 'redis-1:6379' } },
  ]

  test('aggregates all services correctly', () => {
    const services = aggregateAllServices(mockTargets)
    expect(services).toHaveLength(3)

    const api = services.find((s) => s.name === 'api-server')
    expect(api?.status).toBe('degraded')
    expect(api?.instances).toBe(3)
    expect(api?.healthy).toBe(2)

    const db = services.find((s) => s.name === 'database')
    expect(db?.status).toBe('healthy')
    expect(db?.instances).toBe(2)
    expect(db?.healthy).toBe(2)

    const cache = services.find((s) => s.name === 'cache')
    expect(cache?.status).toBe('down')
    expect(cache?.instances).toBe(1)
    expect(cache?.healthy).toBe(0)
  })

  test('handles empty targets array', () => {
    const services = aggregateAllServices([])
    expect(services).toHaveLength(0)
  })

  test('handles single target', () => {
    const singleTarget: PrometheusTarget[] = [
      { health: 'up', labels: { job: 'single-service', instance: 'single-1' } },
    ]
    const services = aggregateAllServices(singleTarget)
    expect(services).toHaveLength(1)
    expect(services[0].name).toBe('single-service')
    expect(services[0].status).toBe('healthy')
  })
})

interface PrometheusAlert {
  state: string
  labels: { alertname: string; severity: string; instance?: string }
  annotations: { description?: string; summary?: string }
}

function filterActiveAlerts(alerts: PrometheusAlert[]): PrometheusAlert[] {
  return alerts.filter((a) => a.state === 'firing')
}

function formatAlertMessage(alert: PrometheusAlert): string {
  return (
    alert.annotations.description ??
    alert.annotations.summary ??
    alert.labels.alertname
  )
}

describe('Alert Processing', () => {
  const mockAlerts: PrometheusAlert[] = [
    {
      state: 'firing',
      labels: {
        alertname: 'HighCPU',
        severity: 'warning',
        instance: 'server-1',
      },
      annotations: { description: 'CPU usage above 80%', summary: 'High CPU' },
    },
    {
      state: 'firing',
      labels: {
        alertname: 'DatabaseDown',
        severity: 'critical',
        instance: 'db-1',
      },
      annotations: { description: 'Primary database is not responding' },
    },
    {
      state: 'resolved',
      labels: { alertname: 'HighMemory', severity: 'warning' },
      annotations: { summary: 'Memory usage high' },
    },
    {
      state: 'pending',
      labels: { alertname: 'DiskFull', severity: 'critical' },
      annotations: {},
    },
  ]

  test('filters only firing alerts', () => {
    const active = filterActiveAlerts(mockAlerts)
    expect(active).toHaveLength(2)
    expect(active.every((a) => a.state === 'firing')).toBe(true)
  })

  test('returns empty array when no firing alerts', () => {
    const noFiring = mockAlerts.filter((a) => a.state !== 'firing')
    const active = filterActiveAlerts(noFiring)
    expect(active).toHaveLength(0)
  })

  test('formats alert message from description first', () => {
    const message = formatAlertMessage(mockAlerts[0])
    expect(message).toBe('CPU usage above 80%')
  })

  test('falls back to summary when no description', () => {
    const alertNoDesc: PrometheusAlert = {
      state: 'firing',
      labels: { alertname: 'Test', severity: 'info' },
      annotations: { summary: 'Test summary' },
    }
    const message = formatAlertMessage(alertNoDesc)
    expect(message).toBe('Test summary')
  })

  test('falls back to alertname when no annotations', () => {
    const alertNoAnnotations: PrometheusAlert = {
      state: 'firing',
      labels: { alertname: 'NoAnnotations', severity: 'info' },
      annotations: {},
    }
    const message = formatAlertMessage(alertNoAnnotations)
    expect(message).toBe('NoAnnotations')
  })
})

interface NodeTarget {
  labels: { job: string; instance: string }
  health: string
  lastScrape?: string
}

function filterNodeTargets(targets: NodeTarget[]): NodeTarget[] {
  return targets.filter(
    (t) => t.labels.job.includes('node') || t.labels.job.includes('reth'),
  )
}

function formatNodeInfo(target: NodeTarget): {
  instance: string
  job: string
  health: string
  lastScrape: string | undefined
} {
  return {
    instance: target.labels.instance,
    job: target.labels.job,
    health: target.health,
    lastScrape: target.lastScrape,
  }
}

describe('Node Status Processing', () => {
  const mockTargets: NodeTarget[] = [
    {
      labels: { job: 'node-exporter', instance: 'node-1:9100' },
      health: 'up',
      lastScrape: '2024-01-01T00:00:00Z',
    },
    {
      labels: { job: 'node-exporter', instance: 'node-2:9100' },
      health: 'up',
      lastScrape: '2024-01-01T00:00:00Z',
    },
    {
      labels: { job: 'reth-node', instance: 'reth-1:8545' },
      health: 'down',
      lastScrape: '2024-01-01T00:00:00Z',
    },
    { labels: { job: 'api-server', instance: 'api-1:8080' }, health: 'up' },
    { labels: { job: 'database', instance: 'db-1:5432' }, health: 'up' },
  ]

  test('filters only node and reth targets', () => {
    const nodes = filterNodeTargets(mockTargets)
    expect(nodes).toHaveLength(3)
    expect(
      nodes.every(
        (n) => n.labels.job.includes('node') || n.labels.job.includes('reth'),
      ),
    ).toBe(true)
  })

  test('formats node info correctly', () => {
    const nodeInfo = formatNodeInfo(mockTargets[0])
    expect(nodeInfo.instance).toBe('node-1:9100')
    expect(nodeInfo.job).toBe('node-exporter')
    expect(nodeInfo.health).toBe('up')
    expect(nodeInfo.lastScrape).toBe('2024-01-01T00:00:00Z')
  })

  test('handles targets without lastScrape', () => {
    const nodeInfo = formatNodeInfo(mockTargets[3])
    expect(nodeInfo.lastScrape).toBeUndefined()
  })
})

interface ChainStats {
  blockNumber: number
  tps: number
  gasPrice: string
}

function parseBlockNumber(hexBlock: string): number {
  return parseInt(hexBlock, 16)
}

function formatGasPrice(hexGasPrice: string): string {
  const gweiValue = parseInt(hexGasPrice, 16) / 1e9
  return gweiValue.toFixed(2)
}

describe('Chain Stats Processing', () => {
  test('parses block number from hex', () => {
    expect(parseBlockNumber('0x1a2b3c')).toBe(1715004)
    expect(parseBlockNumber('0x0')).toBe(0)
    expect(parseBlockNumber('0xFFFFFF')).toBe(16777215)
  })

  test('formats gas price to gwei', () => {
    // 10 gwei = 10 * 1e9 = 10000000000
    expect(formatGasPrice('0x2540be400')).toBe('10.00')
    // 1 gwei
    expect(formatGasPrice('0x3b9aca00')).toBe('1.00')
    // 0.5 gwei = 500000000
    expect(formatGasPrice('0x1dcd6500')).toBe('0.50')
  })

  test('handles zero gas price', () => {
    expect(formatGasPrice('0x0')).toBe('0.00')
  })
})

describe('MCP Tool Result Formatting', () => {
  interface ServiceCheckResult {
    service: string
    status: string
    latency: number
    uptime: number
  }

  function formatServiceCheckResult(
    serviceName: string,
    upCount: number,
    totalCount: number,
    avgLatencyMs: number,
  ): ServiceCheckResult {
    let status: string = 'down'
    if (totalCount > 0) {
      status =
        upCount === totalCount ? 'healthy' : upCount > 0 ? 'degraded' : 'down'
    }
    return {
      service: serviceName,
      status,
      latency: Math.round(avgLatencyMs),
      uptime: totalCount > 0 ? (upCount / totalCount) * 100 : 0,
    }
  }

  test('formats healthy service result', () => {
    const result = formatServiceCheckResult('api-server', 3, 3, 45.5)
    expect(result.service).toBe('api-server')
    expect(result.status).toBe('healthy')
    expect(result.latency).toBe(46)
    expect(result.uptime).toBe(100)
  })

  test('formats degraded service result', () => {
    const result = formatServiceCheckResult('database', 2, 3, 30.3)
    expect(result.status).toBe('degraded')
    expect(result.uptime).toBeCloseTo(66.67, 1)
  })

  test('formats down service result', () => {
    const result = formatServiceCheckResult('cache', 0, 2, 0)
    expect(result.status).toBe('down')
    expect(result.uptime).toBe(0)
  })

  test('handles service with no instances', () => {
    const result = formatServiceCheckResult('missing', 0, 0, 0)
    expect(result.status).toBe('down')
    expect(result.uptime).toBe(0)
  })
})

describe('Query Validation', () => {
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

  test('accepts valid short queries', () => {
    expect(validatePromQLQuery('up')).toEqual({ valid: true })
    expect(validatePromQLQuery('rate(http_requests_total[5m])')).toEqual({
      valid: true,
    })
    expect(validatePromQLQuery('sum by (job) (up)')).toEqual({ valid: true })
  })

  test('rejects queries exceeding max length', () => {
    const longQuery = 'a'.repeat(2001)
    const result = validatePromQLQuery(longQuery)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('too long')
  })

  test('rejects nested count patterns', () => {
    // The regex pattern is: /count\s*\(\s*count\s*\(/i
    // This requires count( whitespace count( pattern
    const result = validatePromQLQuery('count( count ( by_job ( up))')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('expensive patterns')
  })

  test('rejects very long regex patterns', () => {
    const longRegex = `{job=~"${'.'.repeat(150)}"}`
    const result = validatePromQLQuery(longRegex)
    expect(result.valid).toBe(false)
  })

  test('rejects extremely long time ranges', () => {
    const result = validatePromQLQuery('rate(metric[10000h])')
    expect(result.valid).toBe(false)
  })

  test('accepts reasonable time ranges', () => {
    expect(validatePromQLQuery('rate(metric[1h])')).toEqual({ valid: true })
    expect(validatePromQLQuery('rate(metric[24h])')).toEqual({ valid: true })
    expect(validatePromQLQuery('rate(metric[7d])')).toEqual({ valid: true })
    expect(validatePromQLQuery('rate(metric[999h])')).toEqual({ valid: true })
  })
})
