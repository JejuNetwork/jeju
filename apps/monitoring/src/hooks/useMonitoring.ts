import { useState, useEffect, useCallback } from 'react'

interface MetricResult {
  metric: Record<string, string>
  value: [number, string]
}

interface Alert {
  state: string
  labels: Record<string, string>
  annotations: Record<string, string>
  activeAt?: string
}

interface Target {
  health: string
  labels: Record<string, string>
  lastScrape: string
  lastScrapeDuration: number
  scrapeUrl: string
}

interface OIFStats {
  totalIntents: number
  activeSolvers: number
  totalVolumeUsd: string
  successRate: number
}

interface Solver {
  address: string
  name: string
  successRate: number
  reputation: number
}

interface Route {
  routeId: string
  source: number
  destination: number
  successRate: number
  avgTime: number
}

async function sendA2ARequest(skillId: string, query?: string) {
  const response = await fetch('/api/a2a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: `msg-${Date.now()}`,
          parts: [{
            kind: 'data',
            data: { skillId, query }
          }]
        }
      },
      id: Date.now()
    })
  })
  
  const json = await response.json()
  const dataPart = json.result?.parts?.find((p: { kind: string }) => p.kind === 'data')
  return dataPart?.data
}

export function useMetricsQuery(query: string, refreshInterval = 30000) {
  const [data, setData] = useState<MetricResult[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    const result = await sendA2ARequest('query-metrics', query)
    if (result?.error) {
      setError(result.error)
    } else {
      setData(result?.result || [])
      setError(null)
    }
    setLoading(false)
  }, [query])

  useEffect(() => {
    fetch()
    const interval = setInterval(fetch, refreshInterval)
    return () => clearInterval(interval)
  }, [fetch, refreshInterval])

  return { data, loading, error, refetch: fetch }
}

export function useAlerts(refreshInterval = 15000) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    const result = await sendA2ARequest('get-alerts')
    if (result?.error) {
      setError(result.error)
      setAlerts([])
    } else {
      setAlerts(result?.alerts || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetch()
    const interval = setInterval(fetch, refreshInterval)
    return () => clearInterval(interval)
  }, [fetch, refreshInterval])

  return { alerts, loading, error, refetch: fetch }
}

export function useTargets(refreshInterval = 30000) {
  const [targets, setTargets] = useState<Target[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    const result = await sendA2ARequest('get-targets')
    if (result?.error) {
      setError(result.error)
      setTargets([])
    } else {
      setTargets(result?.targets || [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetch()
    const interval = setInterval(fetch, refreshInterval)
    return () => clearInterval(interval)
  }, [fetch, refreshInterval])

  const upCount = targets.filter(t => t.health === 'up').length
  const downCount = targets.filter(t => t.health === 'down').length

  return { targets, upCount, downCount, loading, error, refetch: fetch }
}

export function useOIFStats(refreshInterval = 30000) {
  const [stats, setStats] = useState<OIFStats | null>(null)
  const [solvers, setSolvers] = useState<Solver[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    
    const [statsResult, solversResult, routesResult] = await Promise.all([
      sendA2ARequest('oif-stats'),
      sendA2ARequest('oif-solver-health'),
      sendA2ARequest('oif-route-stats'),
    ])
    
    if (statsResult?.error || solversResult?.error || routesResult?.error) {
      setError(statsResult?.error || solversResult?.error || routesResult?.error)
    } else {
      setStats(statsResult)
      setSolvers(solversResult?.solvers || [])
      setRoutes(routesResult?.routes || [])
      setError(null)
    }
    
    setLoading(false)
  }, [])

  useEffect(() => {
    fetch()
    const interval = setInterval(fetch, refreshInterval)
    return () => clearInterval(interval)
  }, [fetch, refreshInterval])

  return { stats, solvers, routes, loading, error, refetch: fetch }
}

export function useSystemHealth() {
  const { targets, upCount, loading: targetsLoading } = useTargets()
  const { alerts, loading: alertsLoading } = useAlerts()
  
  const loading = targetsLoading || alertsLoading
  
  const firingAlerts = alerts.filter(a => a.state === 'firing')
  const criticalAlerts = firingAlerts.filter(a => 
    a.labels.severity === 'critical' || a.labels.severity === 'error'
  )
  
  let status: 'healthy' | 'degraded' | 'critical' = 'healthy'
  if (criticalAlerts.length > 0) {
    status = 'critical'
  } else if (firingAlerts.length > 0 || (targets.length > 0 && upCount < targets.length)) {
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

