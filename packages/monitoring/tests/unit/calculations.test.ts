/** Unit tests for volume formatting, health ring SVG, and aggregation. */

import { describe, expect, test } from 'bun:test'

function formatVolume(amount: string): string {
  const value = parseFloat(amount) / 1e18
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`
  return value.toFixed(4)
}

describe('formatVolume', () => {
  test('formats wei values to ETH with 4 decimal places for small amounts', () => {
    // 1 ETH = 1e18 wei
    expect(formatVolume('1000000000000000000')).toBe('1.0000')
    expect(formatVolume('500000000000000000')).toBe('0.5000')
    expect(formatVolume('123456789012345678')).toBe('0.1235') // Rounds up at 5th decimal
    expect(formatVolume('0')).toBe('0.0000')
  })

  test('formats large values with K suffix for thousands', () => {
    // 1000 ETH = 1e21 wei
    expect(formatVolume('1000000000000000000000')).toBe('1.00K')
    expect(formatVolume('5500000000000000000000')).toBe('5.50K')
    expect(formatVolume('999500000000000000000000')).toBe('999.50K') // Just under 1M
  })

  test('formats very large values with M suffix for millions', () => {
    // 1M ETH = 1e24 wei
    expect(formatVolume('1000000000000000000000000')).toBe('1.00M')
    expect(formatVolume('2500000000000000000000000')).toBe('2.50M')
    expect(formatVolume('123456000000000000000000000')).toBe('123.46M')
  })

  test('handles edge cases with precision', () => {
    // 1000 ETH = 1e21 wei - this is the boundary for K format
    expect(formatVolume('1000000000000000000000')).toBe('1.00K')

    // Just under 1000 ETH (still shows 4 decimals)
    expect(formatVolume('999000000000000000000')).toBe('999.0000')

    // Very small fractional amounts
    expect(formatVolume('1000000000000000')).toBe('0.0010') // 0.001 ETH
    expect(formatVolume('1000000000000')).toBe('0.0000') // Rounds to 0
  })

  test('handles large volume strings', () => {
    // 100M ETH volume (realistic upper bound for testing)
    expect(formatVolume('100000000000000000000000000')).toBe('100.00M')

    // 1 billion ETH (extreme edge case)
    expect(formatVolume('1000000000000000000000000000')).toBe('1000.00M')
  })
})

interface HealthRingCalc {
  radius: number
  circumference: number
  offset: number
}

function calculateHealthRing(
  percentage: number,
  size: number,
  strokeWidth: number,
): HealthRingCalc {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (percentage / 100) * circumference
  return { radius, circumference, offset }
}

describe('Health Ring SVG Calculations', () => {
  test('calculates correct radius from size and stroke width', () => {
    const calc = calculateHealthRing(100, 120, 10)
    expect(calc.radius).toBe(55) // (120 - 10) / 2

    const calc2 = calculateHealthRing(100, 100, 20)
    expect(calc2.radius).toBe(40) // (100 - 20) / 2
  })

  test('calculates correct circumference from radius', () => {
    const calc = calculateHealthRing(100, 120, 10)
    // circumference = 2 * π * r = 2 * π * 55 = 345.575...
    expect(calc.circumference).toBeCloseTo(345.575, 2)
  })

  test('calculates 0 offset for 100% (full ring)', () => {
    const calc = calculateHealthRing(100, 120, 10)
    expect(calc.offset).toBeCloseTo(0, 5)
  })

  test('calculates full circumference offset for 0% (empty ring)', () => {
    const calc = calculateHealthRing(0, 120, 10)
    expect(calc.offset).toBeCloseTo(calc.circumference, 5)
  })

  test('calculates half circumference offset for 50%', () => {
    const calc = calculateHealthRing(50, 120, 10)
    expect(calc.offset).toBeCloseTo(calc.circumference / 2, 5)
  })

  test('calculates correct offset for arbitrary percentages', () => {
    const calc = calculateHealthRing(75, 120, 10)
    const expectedOffset = calc.circumference - (75 / 100) * calc.circumference
    expect(calc.offset).toBeCloseTo(expectedOffset, 5)

    const calc2 = calculateHealthRing(33, 100, 8)
    const expectedOffset2 =
      calc2.circumference - (33 / 100) * calc2.circumference
    expect(calc2.offset).toBeCloseTo(expectedOffset2, 5)
  })

  test('handles edge case percentages', () => {
    // Over 100% (should still calculate, though visually clamped)
    const calc = calculateHealthRing(150, 120, 10)
    const expectedOffset = calc.circumference - (150 / 100) * calc.circumference
    expect(calc.offset).toBeCloseTo(expectedOffset, 5)
    expect(calc.offset).toBeLessThan(0) // Negative offset for > 100%

    // Negative percentage
    const calc2 = calculateHealthRing(-10, 120, 10)
    expect(calc2.offset).toBeGreaterThan(calc2.circumference)
  })
})

type HealthStatus = 'healthy' | 'degraded' | 'critical'

interface Alert {
  state: string
  labels: Record<string, string>
}

interface Target {
  health: string
}

function determineHealthStatus(
  alerts: Alert[],
  targets: Target[],
): HealthStatus {
  const firingAlerts = alerts.filter((a) => a.state === 'firing')
  const criticalAlerts = firingAlerts.filter(
    (a) => a.labels.severity === 'critical' || a.labels.severity === 'error',
  )
  const upCount = targets.filter((t) => t.health === 'up').length

  if (criticalAlerts.length > 0) {
    return 'critical'
  }
  if (
    firingAlerts.length > 0 ||
    (targets.length > 0 && upCount < targets.length)
  ) {
    return 'degraded'
  }
  return 'healthy'
}

describe('Health Status Determination', () => {
  test('returns healthy when no alerts and all targets up', () => {
    const alerts: Alert[] = []
    const targets: Target[] = [
      { health: 'up' },
      { health: 'up' },
      { health: 'up' },
    ]

    expect(determineHealthStatus(alerts, targets)).toBe('healthy')
  })

  test('returns healthy with only resolved alerts', () => {
    const alerts: Alert[] = [
      { state: 'resolved', labels: { severity: 'critical' } },
      { state: 'resolved', labels: { severity: 'warning' } },
    ]
    const targets: Target[] = [{ health: 'up' }]

    expect(determineHealthStatus(alerts, targets)).toBe('healthy')
  })

  test('returns critical with firing critical alerts', () => {
    const alerts: Alert[] = [
      { state: 'firing', labels: { severity: 'critical' } },
    ]
    const targets: Target[] = [{ health: 'up' }]

    expect(determineHealthStatus(alerts, targets)).toBe('critical')
  })

  test('returns critical with firing error severity alerts', () => {
    const alerts: Alert[] = [{ state: 'firing', labels: { severity: 'error' } }]
    const targets: Target[] = [{ health: 'up' }]

    expect(determineHealthStatus(alerts, targets)).toBe('critical')
  })

  test('returns degraded with firing warning alerts only', () => {
    const alerts: Alert[] = [
      { state: 'firing', labels: { severity: 'warning' } },
    ]
    const targets: Target[] = [{ health: 'up' }]

    expect(determineHealthStatus(alerts, targets)).toBe('degraded')
  })

  test('returns degraded with firing info alerts', () => {
    const alerts: Alert[] = [{ state: 'firing', labels: { severity: 'info' } }]
    const targets: Target[] = [{ health: 'up' }]

    expect(determineHealthStatus(alerts, targets)).toBe('degraded')
  })

  test('returns degraded when some targets are down', () => {
    const alerts: Alert[] = []
    const targets: Target[] = [
      { health: 'up' },
      { health: 'down' },
      { health: 'up' },
    ]

    expect(determineHealthStatus(alerts, targets)).toBe('degraded')
  })

  test('returns healthy with empty targets array', () => {
    const alerts: Alert[] = []
    const targets: Target[] = []

    expect(determineHealthStatus(alerts, targets)).toBe('healthy')
  })

  test('prioritizes critical over degraded', () => {
    const alerts: Alert[] = [
      { state: 'firing', labels: { severity: 'warning' } },
      { state: 'firing', labels: { severity: 'critical' } },
    ]
    const targets: Target[] = [{ health: 'up' }, { health: 'down' }]

    expect(determineHealthStatus(alerts, targets)).toBe('critical')
  })
})

interface Solver {
  address: string
  name: string
  successRate: number
  reputation: number
}

interface SolverStats {
  totalSolvers: number
  healthySolvers: number
  avgSuccessRate: number
}

function calculateSolverStats(solvers: Solver[]): SolverStats {
  const healthySolvers = solvers.filter((s) => s.successRate >= 95)
  const avgSuccessRate =
    solvers.length > 0
      ? solvers.reduce((sum, s) => sum + s.successRate, 0) / solvers.length
      : 0

  return {
    totalSolvers: solvers.length,
    healthySolvers: healthySolvers.length,
    avgSuccessRate,
  }
}

describe('Solver Health Aggregation', () => {
  test('calculates correct stats for healthy solvers', () => {
    const solvers: Solver[] = [
      { address: '0x1', name: 'Solver1', successRate: 98, reputation: 100 },
      { address: '0x2', name: 'Solver2', successRate: 97, reputation: 95 },
      { address: '0x3', name: 'Solver3', successRate: 99, reputation: 98 },
    ]

    const stats = calculateSolverStats(solvers)
    expect(stats.totalSolvers).toBe(3)
    expect(stats.healthySolvers).toBe(3) // All >= 95%
    expect(stats.avgSuccessRate).toBeCloseTo(98, 1) // (98 + 97 + 99) / 3
  })

  test('correctly identifies unhealthy solvers', () => {
    const solvers: Solver[] = [
      { address: '0x1', name: 'Solver1', successRate: 98, reputation: 100 },
      { address: '0x2', name: 'Solver2', successRate: 90, reputation: 80 }, // Unhealthy
      { address: '0x3', name: 'Solver3', successRate: 94, reputation: 85 }, // Unhealthy (< 95)
    ]

    const stats = calculateSolverStats(solvers)
    expect(stats.totalSolvers).toBe(3)
    expect(stats.healthySolvers).toBe(1) // Only first solver >= 95%
    expect(stats.avgSuccessRate).toBeCloseTo(94, 1) // (98 + 90 + 94) / 3
  })

  test('handles empty solver array', () => {
    const stats = calculateSolverStats([])
    expect(stats.totalSolvers).toBe(0)
    expect(stats.healthySolvers).toBe(0)
    expect(stats.avgSuccessRate).toBe(0)
  })

  test('handles boundary case at exactly 95%', () => {
    const solvers: Solver[] = [
      { address: '0x1', name: 'Solver1', successRate: 95, reputation: 90 },
    ]

    const stats = calculateSolverStats(solvers)
    expect(stats.healthySolvers).toBe(1) // Exactly 95% is healthy
  })

  test('handles boundary case just under 95%', () => {
    const solvers: Solver[] = [
      { address: '0x1', name: 'Solver1', successRate: 94.99, reputation: 90 },
    ]

    const stats = calculateSolverStats(solvers)
    expect(stats.healthySolvers).toBe(0) // 94.99% is not healthy
  })
})

interface Route {
  routeId: string
  sourceChainId: number
  destinationChainId: number
  successRate: number
  avgFillTimeSeconds: number
  totalVolume: string
}

interface RouteStats {
  totalRoutes: number
  totalVolume: bigint
  avgSuccessRate: number
}

function calculateRouteStats(routes: Route[]): RouteStats {
  const totalVolume = routes.reduce((sum, r) => sum + BigInt(r.totalVolume), 0n)
  const avgSuccessRate =
    routes.length > 0
      ? routes.reduce((sum, r) => sum + r.successRate, 0) / routes.length
      : 0

  return {
    totalRoutes: routes.length,
    totalVolume,
    avgSuccessRate,
  }
}

describe('Route Volume Aggregation', () => {
  test('aggregates volume correctly using BigInt', () => {
    const routes: Route[] = [
      {
        routeId: 'r1',
        sourceChainId: 1,
        destinationChainId: 8453,
        successRate: 98,
        avgFillTimeSeconds: 30,
        totalVolume: '1000000000000000000',
      },
      {
        routeId: 'r2',
        sourceChainId: 8453,
        destinationChainId: 42161,
        successRate: 97,
        avgFillTimeSeconds: 45,
        totalVolume: '2000000000000000000',
      },
    ]

    const stats = calculateRouteStats(routes)
    expect(stats.totalVolume).toBe(3000000000000000000n) // 3 ETH in wei
    expect(stats.totalRoutes).toBe(2)
    expect(stats.avgSuccessRate).toBeCloseTo(97.5, 1)
  })

  test('handles very large volumes without overflow', () => {
    const routes: Route[] = [
      {
        routeId: 'r1',
        sourceChainId: 1,
        destinationChainId: 8453,
        successRate: 99,
        avgFillTimeSeconds: 30,
        totalVolume: '999999999999999999999999999',
      },
      {
        routeId: 'r2',
        sourceChainId: 8453,
        destinationChainId: 42161,
        successRate: 99,
        avgFillTimeSeconds: 45,
        totalVolume: '888888888888888888888888888',
      },
    ]

    const stats = calculateRouteStats(routes)
    expect(stats.totalVolume).toBe(
      999999999999999999999999999n + 888888888888888888888888888n,
    )
  })

  test('handles empty routes array', () => {
    const stats = calculateRouteStats([])
    expect(stats.totalRoutes).toBe(0)
    expect(stats.totalVolume).toBe(0n)
    expect(stats.avgSuccessRate).toBe(0)
  })

  test('calculates correct average success rate', () => {
    const routes: Route[] = [
      {
        routeId: 'r1',
        sourceChainId: 1,
        destinationChainId: 8453,
        successRate: 100,
        avgFillTimeSeconds: 30,
        totalVolume: '0',
      },
      {
        routeId: 'r2',
        sourceChainId: 8453,
        destinationChainId: 42161,
        successRate: 90,
        avgFillTimeSeconds: 45,
        totalVolume: '0',
      },
      {
        routeId: 'r3',
        sourceChainId: 42161,
        destinationChainId: 1,
        successRate: 80,
        avgFillTimeSeconds: 60,
        totalVolume: '0',
      },
    ]

    const stats = calculateRouteStats(routes)
    expect(stats.avgSuccessRate).toBe(90) // (100 + 90 + 80) / 3
  })
})

interface AlertRow {
  alert_id: string
  alert_name: string
  severity: string
  status: string
  duration_seconds: number | null
}

interface AlertStats {
  total: number
  firing: number
  resolved: number
  bySeverity: Record<string, number>
  avgResolutionSeconds: number
}

function calculateAlertStats(alerts: AlertRow[]): AlertStats {
  const firing = alerts.filter((a) => a.status === 'firing').length
  const resolved = alerts.filter((a) => a.status === 'resolved').length

  const bySeverity: Record<string, number> = {}
  alerts.forEach((a) => {
    bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1
  })

  const resolvedWithDuration = alerts.filter((a) => a.duration_seconds !== null)
  const avgResolutionSeconds =
    resolvedWithDuration.length > 0
      ? resolvedWithDuration.reduce(
          (sum, a) => sum + (a.duration_seconds ?? 0),
          0,
        ) / resolvedWithDuration.length
      : 0

  return {
    total: alerts.length,
    firing,
    resolved,
    bySeverity,
    avgResolutionSeconds: Math.round(avgResolutionSeconds),
  }
}

describe('Alert Statistics Calculation', () => {
  test('calculates correct counts for firing and resolved', () => {
    const alerts: AlertRow[] = [
      {
        alert_id: '1',
        alert_name: 'High CPU',
        severity: 'warning',
        status: 'firing',
        duration_seconds: null,
      },
      {
        alert_id: '2',
        alert_name: 'DB Down',
        severity: 'critical',
        status: 'resolved',
        duration_seconds: 300,
      },
      {
        alert_id: '3',
        alert_name: 'High Memory',
        severity: 'warning',
        status: 'resolved',
        duration_seconds: 600,
      },
    ]

    const stats = calculateAlertStats(alerts)
    expect(stats.total).toBe(3)
    expect(stats.firing).toBe(1)
    expect(stats.resolved).toBe(2)
  })

  test('correctly groups alerts by severity', () => {
    const alerts: AlertRow[] = [
      {
        alert_id: '1',
        alert_name: 'Alert1',
        severity: 'critical',
        status: 'firing',
        duration_seconds: null,
      },
      {
        alert_id: '2',
        alert_name: 'Alert2',
        severity: 'critical',
        status: 'resolved',
        duration_seconds: 300,
      },
      {
        alert_id: '3',
        alert_name: 'Alert3',
        severity: 'warning',
        status: 'firing',
        duration_seconds: null,
      },
      {
        alert_id: '4',
        alert_name: 'Alert4',
        severity: 'info',
        status: 'resolved',
        duration_seconds: 100,
      },
    ]

    const stats = calculateAlertStats(alerts)
    expect(stats.bySeverity.critical).toBe(2)
    expect(stats.bySeverity.warning).toBe(1)
    expect(stats.bySeverity.info).toBe(1)
  })

  test('calculates average resolution time correctly', () => {
    const alerts: AlertRow[] = [
      {
        alert_id: '1',
        alert_name: 'Alert1',
        severity: 'warning',
        status: 'firing',
        duration_seconds: null,
      },
      {
        alert_id: '2',
        alert_name: 'Alert2',
        severity: 'warning',
        status: 'resolved',
        duration_seconds: 300,
      },
      {
        alert_id: '3',
        alert_name: 'Alert3',
        severity: 'warning',
        status: 'resolved',
        duration_seconds: 600,
      },
      {
        alert_id: '4',
        alert_name: 'Alert4',
        severity: 'warning',
        status: 'resolved',
        duration_seconds: 900,
      },
    ]

    const stats = calculateAlertStats(alerts)
    expect(stats.avgResolutionSeconds).toBe(600) // (300 + 600 + 900) / 3
  })

  test('handles alerts with no resolved duration', () => {
    const alerts: AlertRow[] = [
      {
        alert_id: '1',
        alert_name: 'Alert1',
        severity: 'critical',
        status: 'firing',
        duration_seconds: null,
      },
      {
        alert_id: '2',
        alert_name: 'Alert2',
        severity: 'warning',
        status: 'firing',
        duration_seconds: null,
      },
    ]

    const stats = calculateAlertStats(alerts)
    expect(stats.avgResolutionSeconds).toBe(0)
  })

  test('handles empty alerts array', () => {
    const stats = calculateAlertStats([])
    expect(stats.total).toBe(0)
    expect(stats.firing).toBe(0)
    expect(stats.resolved).toBe(0)
    expect(Object.keys(stats.bySeverity)).toHaveLength(0)
    expect(stats.avgResolutionSeconds).toBe(0)
  })

  test('rounds average resolution time', () => {
    const alerts: AlertRow[] = [
      {
        alert_id: '1',
        alert_name: 'Alert1',
        severity: 'warning',
        status: 'resolved',
        duration_seconds: 100,
      },
      {
        alert_id: '2',
        alert_name: 'Alert2',
        severity: 'warning',
        status: 'resolved',
        duration_seconds: 200,
      },
      {
        alert_id: '3',
        alert_name: 'Alert3',
        severity: 'warning',
        status: 'resolved',
        duration_seconds: 301,
      },
    ]

    const stats = calculateAlertStats(alerts)
    // (100 + 200 + 301) / 3 = 200.33... → rounds to 200
    expect(stats.avgResolutionSeconds).toBe(200)
  })
})

function calculateDurationSeconds(
  startedAt: number,
  resolvedAt: number,
): number {
  return Math.floor((resolvedAt - startedAt) / 1000)
}

describe('Duration Calculation', () => {
  test('calculates duration correctly in seconds', () => {
    const start = 1700000000000 // Timestamp in ms
    const end = 1700000060000 // 60 seconds later

    expect(calculateDurationSeconds(start, end)).toBe(60)
  })

  test('floors partial seconds', () => {
    const start = 1700000000000
    const end = 1700000001999 // 1.999 seconds later

    expect(calculateDurationSeconds(start, end)).toBe(1)
  })

  test('handles sub-second durations', () => {
    const start = 1700000000000
    const end = 1700000000500 // 0.5 seconds later

    expect(calculateDurationSeconds(start, end)).toBe(0)
  })

  test('handles large durations', () => {
    const start = 1700000000000
    const end = 1700086400000 // 24 hours later

    expect(calculateDurationSeconds(start, end)).toBe(86400)
  })
})

type RingStatus = 'success' | 'warning' | 'error'

function getHealthRingStatus(
  percentage: number,
  statusOverride?: RingStatus,
): RingStatus {
  if (statusOverride) return statusOverride
  if (percentage >= 80) return 'success'
  if (percentage >= 50) return 'warning'
  return 'error'
}

describe('Health Ring Color Selection', () => {
  test('returns success for percentages >= 80', () => {
    expect(getHealthRingStatus(100)).toBe('success')
    expect(getHealthRingStatus(80)).toBe('success')
    expect(getHealthRingStatus(99)).toBe('success')
  })

  test('returns warning for percentages >= 50 and < 80', () => {
    expect(getHealthRingStatus(79)).toBe('warning')
    expect(getHealthRingStatus(50)).toBe('warning')
    expect(getHealthRingStatus(65)).toBe('warning')
  })

  test('returns error for percentages < 50', () => {
    expect(getHealthRingStatus(49)).toBe('error')
    expect(getHealthRingStatus(0)).toBe('error')
    expect(getHealthRingStatus(25)).toBe('error')
  })

  test('status override takes precedence', () => {
    expect(getHealthRingStatus(100, 'error')).toBe('error')
    expect(getHealthRingStatus(0, 'success')).toBe('success')
    expect(getHealthRingStatus(50, 'warning')).toBe('warning')
  })
})
