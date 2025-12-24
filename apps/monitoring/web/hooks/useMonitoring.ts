/** React Query hooks for monitoring data with caching and auto-refetch. */

import { useQuery } from '@tanstack/react-query'
import {
  type Alert,
  api,
  type MetricResult,
  type OIFStats,
  queryKeys,
  type Route,
  type Solver,
  type Target,
} from '../api'

export function useMetricsQuery(
  query: string,
  options?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: queryKeys.metrics(query),
    queryFn: () => api.queryMetrics(query),
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}

export function useAlerts(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: queryKeys.alerts(),
    queryFn: api.getAlerts,
    refetchInterval: options?.refetchInterval ?? 15_000,
    staleTime: 10_000,
    select: (alerts) => ({
      alerts,
      firingCount: alerts.filter((a) => a.state === 'firing').length,
      criticalCount: alerts.filter(
        (a) =>
          a.state === 'firing' &&
          (a.labels.severity === 'critical' || a.labels.severity === 'error'),
      ).length,
    }),
  })
}

export function useTargets(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: queryKeys.targets(),
    queryFn: api.getTargets,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
    select: (targets) => ({
      targets,
      upCount: targets.filter((t) => t.health === 'up').length,
      downCount: targets.filter((t) => t.health === 'down').length,
    }),
  })
}

export function useOIFStats(options?: { refetchInterval?: number }) {
  const statsQuery = useQuery({
    queryKey: queryKeys.oifStats(),
    queryFn: api.getOIFStats,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })

  const solversQuery = useQuery({
    queryKey: queryKeys.oifSolvers(),
    queryFn: api.getOIFSolvers,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })

  const routesQuery = useQuery({
    queryKey: queryKeys.oifRoutes(),
    queryFn: api.getOIFRoutes,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })

  return {
    stats: statsQuery.data,
    solvers: solversQuery.data?.solvers ?? [],
    routes: routesQuery.data?.routes ?? [],
    solverHealth: solversQuery.data
      ? {
          total: solversQuery.data.totalSolvers,
          healthy: solversQuery.data.healthySolvers,
          avgSuccessRate: solversQuery.data.avgSuccessRate,
        }
      : null,
    routeStats: routesQuery.data
      ? {
          total: routesQuery.data.totalRoutes,
          totalVolume: routesQuery.data.totalVolume,
          avgSuccessRate: routesQuery.data.avgSuccessRate,
        }
      : null,
    isLoading:
      statsQuery.isLoading || solversQuery.isLoading || routesQuery.isLoading,
    error: statsQuery.error ?? solversQuery.error ?? routesQuery.error,
    refetch: () => {
      statsQuery.refetch()
      solversQuery.refetch()
      routesQuery.refetch()
    },
  }
}

export function useSystemHealth() {
  const targetsQuery = useTargets()
  const alertsQuery = useAlerts()

  const isLoading = targetsQuery.isLoading || alertsQuery.isLoading
  let status: 'healthy' | 'degraded' | 'critical' = 'healthy'

  if (alertsQuery.data) {
    if (alertsQuery.data.criticalCount > 0) {
      status = 'critical'
    } else if (
      alertsQuery.data.firingCount > 0 ||
      (targetsQuery.data && targetsQuery.data.downCount > 0)
    ) {
      status = 'degraded'
    }
  }

  return {
    status,
    targetsUp: targetsQuery.data?.upCount ?? 0,
    targetsTotal: targetsQuery.data?.targets.length ?? 0,
    alertsActive: alertsQuery.data?.firingCount ?? 0,
    alertsCritical: alertsQuery.data?.criticalCount ?? 0,
    isLoading,
    error: targetsQuery.error ?? alertsQuery.error,
  }
}

export type { Alert, MetricResult, OIFStats, Route, Solver, Target }
export { queryKeys }
