import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'

// Zod schemas for API responses
const MetricResultSchema = z.object({
  metric: z.record(z.string(), z.string()),
  value: z.tuple([z.number(), z.string()]),
})

const AlertSchema = z.object({
  state: z.string(),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()),
  activeAt: z.string().optional(),
})

const TargetSchema = z.object({
  health: z.string(),
  labels: z.record(z.string(), z.string()),
  lastScrape: z.string(),
  lastScrapeDuration: z.number(),
  scrapeUrl: z.string(),
})

const OIFStatsSchema = z.object({
  totalIntents: z.number(),
  activeSolvers: z.number(),
  totalVolumeUsd: z.string(),
  successRate: z.number().optional(),
})

const SolverSchema = z.object({
  address: z.string(),
  name: z.string(),
  successRate: z.number(),
  reputation: z.number(),
})

const RouteSchema = z.object({
  routeId: z.string(),
  source: z.number(),
  destination: z.number(),
  successRate: z.number(),
  avgTime: z.number(),
})

// A2A response data can be various shapes depending on skill
// We use a permissive schema and validate specific shapes per-skill
const A2ADataSchema = z.union([
  // Error responses
  z.object({ error: z.string() }),
  // Query metrics result
  z.object({
    result: z
      .array(
        z.object({
          metric: z.record(z.string(), z.string()),
          value: z.tuple([z.number(), z.string()]).optional(),
        }),
      )
      .optional(),
  }),
  // Alerts result
  z.object({
    alerts: z.array(
      z.object({
        state: z.string(),
        labels: z.record(z.string(), z.string()),
        annotations: z.record(z.string(), z.string()),
      }),
    ),
  }),
  // Targets result
  z.object({
    targets: z.array(
      z.object({
        health: z.string(),
        labels: z.record(z.string(), z.string()),
      }),
    ),
  }),
  // OIF stats
  z.object({
    totalIntents: z.number(),
    activeSolvers: z.number(),
    totalVolumeUsd: z.string(),
  }),
  // OIF solver health
  z.object({
    totalSolvers: z.number(),
    healthySolvers: z.number(),
    avgSuccessRate: z.number(),
    solvers: z.array(
      z.object({
        address: z.string(),
        name: z.string(),
        successRate: z.number(),
        reputation: z.number(),
      }),
    ),
  }),
  // OIF route stats
  z.object({
    totalRoutes: z.number(),
    totalVolume: z.string(),
    avgSuccessRate: z.number(),
    routes: z.array(
      z.object({
        routeId: z.string(),
        source: z.number(),
        destination: z.number(),
        successRate: z.number(),
        avgTime: z.number(),
      }),
    ),
  }),
  // Generic success
  z.object({ success: z.boolean() }),
])

type A2AData = z.infer<typeof A2ADataSchema>

const A2AResponseSchema = z.object({
  result: z
    .object({
      parts: z.array(
        z.object({
          kind: z.string(),
          data: A2ADataSchema.optional(),
          text: z.string().optional(),
        }),
      ),
    })
    .optional(),
  error: z
    .object({
      message: z.string(),
    })
    .optional(),
})

type MetricResult = z.infer<typeof MetricResultSchema>
type Alert = z.infer<typeof AlertSchema>
type Target = z.infer<typeof TargetSchema>
type OIFStats = z.infer<typeof OIFStatsSchema>
type Solver = z.infer<typeof SolverSchema>
type Route = z.infer<typeof RouteSchema>

async function sendA2ARequest(
  skillId: string,
  query?: string,
): Promise<A2AData | null> {
  const response = await fetch('/api/a2a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: `msg-${Date.now()}`,
          parts: [
            {
              kind: 'data',
              data: { skillId, query },
            },
          ],
        },
      },
      id: Date.now(),
    }),
  })

  if (!response.ok) {
    throw new Error(`A2A request failed: ${response.status}`)
  }

  const json = await response.json()
  const parsed = A2AResponseSchema.safeParse(json)

  if (!parsed.success) {
    throw new Error(`Invalid A2A response: ${parsed.error.message}`)
  }

  if (parsed.data.error) {
    throw new Error(parsed.data.error.message)
  }

  const dataPart = parsed.data.result?.parts.find((p) => p.kind === 'data')
  return dataPart?.data ?? null
}

export function useMetricsQuery(query: string, refreshInterval = 30000) {
  const [data, setData] = useState<MetricResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await sendA2ARequest('query-metrics', query)
      if (!result) {
        setData([])
        setError(null)
        return
      }

      if ('error' in result) {
        setError(String(result.error))
        setData([])
        return
      }

      // Validate the result array - must have 'result' property
      if (!('result' in result)) {
        setData([])
        setError(null)
        return
      }
      const resultArray = result.result
      if (!Array.isArray(resultArray)) {
        setData([])
        setError(null)
        return
      }

      const parsed = z.array(MetricResultSchema).safeParse(resultArray)
      if (!parsed.success) {
        setError(`Invalid metrics data: ${parsed.error.message}`)
        setData([])
        return
      }

      setData(parsed.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setData([])
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchData, refreshInterval])

  return { data, loading, error, refetch: fetchData }
}

export function useAlerts(refreshInterval = 15000) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await sendA2ARequest('get-alerts')
      if (!result) {
        setAlerts([])
        setError(null)
        return
      }

      if ('error' in result) {
        setError(String(result.error))
        setAlerts([])
        return
      }

      if (!('alerts' in result)) {
        setAlerts([])
        setError(null)
        return
      }
      const alertsArray = result.alerts
      if (!Array.isArray(alertsArray)) {
        setAlerts([])
        setError(null)
        return
      }

      const parsed = z.array(AlertSchema).safeParse(alertsArray)
      if (!parsed.success) {
        setError(`Invalid alerts data: ${parsed.error.message}`)
        setAlerts([])
        return
      }

      setAlerts(parsed.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchData, refreshInterval])

  return { alerts, loading, error, refetch: fetchData }
}

export function useTargets(refreshInterval = 30000) {
  const [targets, setTargets] = useState<Target[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await sendA2ARequest('get-targets')
      if (!result) {
        setTargets([])
        setError(null)
        return
      }

      if ('error' in result) {
        setError(String(result.error))
        setTargets([])
        return
      }

      if (!('targets' in result)) {
        setTargets([])
        setError(null)
        return
      }
      const targetsArray = result.targets
      if (!Array.isArray(targetsArray)) {
        setTargets([])
        setError(null)
        return
      }

      const parsed = z.array(TargetSchema).safeParse(targetsArray)
      if (!parsed.success) {
        setError(`Invalid targets data: ${parsed.error.message}`)
        setTargets([])
        return
      }

      setTargets(parsed.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setTargets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchData, refreshInterval])

  const upCount = targets.filter((t) => t.health === 'up').length
  const downCount = targets.filter((t) => t.health === 'down').length

  return { targets, upCount, downCount, loading, error, refetch: fetchData }
}

export function useOIFStats(refreshInterval = 30000) {
  const [stats, setStats] = useState<OIFStats | null>(null)
  const [solvers, setSolvers] = useState<Solver[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsResult, solversResult, routesResult] = await Promise.all([
        sendA2ARequest('oif-stats'),
        sendA2ARequest('oif-solver-health'),
        sendA2ARequest('oif-route-stats'),
      ])

      // Check for errors in any result using type guards
      const hasError = (data: A2AData | null): data is { error: string } =>
        data !== null && 'error' in data

      if (hasError(statsResult)) {
        setError(statsResult.error)
        return
      }
      if (hasError(solversResult)) {
        setError(solversResult.error)
        return
      }
      if (hasError(routesResult)) {
        setError(routesResult.error)
        return
      }

      // Parse stats
      if (statsResult) {
        const parsedStats = OIFStatsSchema.safeParse(statsResult)
        if (parsedStats.success) {
          setStats(parsedStats.data)
        }
      }

      // Parse solvers - check for solvers property with type guard
      if (
        solversResult &&
        'solvers' in solversResult &&
        Array.isArray(solversResult.solvers)
      ) {
        const parsedSolvers = z
          .array(SolverSchema)
          .safeParse(solversResult.solvers)
        if (parsedSolvers.success) {
          setSolvers(parsedSolvers.data)
        }
      }

      // Parse routes - check for routes property with type guard
      if (
        routesResult &&
        'routes' in routesResult &&
        Array.isArray(routesResult.routes)
      ) {
        const parsedRoutes = z.array(RouteSchema).safeParse(routesResult.routes)
        if (parsedRoutes.success) {
          setRoutes(parsedRoutes.data)
        }
      }

      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchData, refreshInterval])

  return { stats, solvers, routes, loading, error, refetch: fetchData }
}

export function useSystemHealth() {
  const { targets, upCount, loading: targetsLoading } = useTargets()
  const { alerts, loading: alertsLoading } = useAlerts()

  const loading = targetsLoading || alertsLoading

  const firingAlerts = alerts.filter((a) => a.state === 'firing')
  const criticalAlerts = firingAlerts.filter(
    (a) => a.labels.severity === 'critical' || a.labels.severity === 'error',
  )

  let status: 'healthy' | 'degraded' | 'critical' = 'healthy'
  if (criticalAlerts.length > 0) {
    status = 'critical'
  } else if (
    firingAlerts.length > 0 ||
    (targets.length > 0 && upCount < targets.length)
  ) {
    status = 'degraded'
  }

  return {
    status,
    targetsUp: upCount,
    targetsTotal: targets.length,
    alertsActive: firingAlerts.length,
    alertsCritical: criticalAlerts.length,
    loading,
  }
}
