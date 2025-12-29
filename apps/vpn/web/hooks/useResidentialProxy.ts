import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../../lib'
import {
  type ResidentialProxySettings,
  ResidentialProxySettingsSchema,
  type ResidentialProxyStats,
  ResidentialProxyStatsSchema,
  type ResidentialProxyStatus,
  ResidentialProxyStatusSchema,
} from '../../lib/schemas'

const INITIAL_STATUS: ResidentialProxyStatus = {
  is_registered: false,
  is_active: false,
  stake_amount: '0',
  total_bytes_shared: '0',
  total_sessions: 0,
  total_earnings: '0',
  pending_rewards: '0',
  current_connections: 0,
  uptime_score: 0,
  success_rate: 0,
  coordinator_connected: false,
}

const INITIAL_SETTINGS: ResidentialProxySettings = {
  enabled: false,
  node_type: 'residential',
  max_bandwidth_mbps: 100,
  max_concurrent_connections: 50,
  allowed_ports: [80, 443, 8080, 8443],
  blocked_domains: [],
  schedule_enabled: false,
}

const INITIAL_STATS: ResidentialProxyStats = {
  bytes_shared_today: '0',
  bytes_shared_week: '0',
  bytes_shared_month: '0',
  sessions_today: 0,
  sessions_week: 0,
  avg_session_duration_ms: 0,
  peak_bandwidth_mbps: 0,
  earnings_today: '0',
  earnings_week: '0',
  earnings_month: '0',
}

export function useResidentialProxy() {
  const [status, setStatus] = useState<ResidentialProxyStatus>(INITIAL_STATUS)
  const [settings, setSettings] =
    useState<ResidentialProxySettings>(INITIAL_SETTINGS)
  const [stats, setStats] = useState<ResidentialProxyStats>(INITIAL_STATS)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasInitialized, setHasInitialized] = useState(false)
  const mountedRef = useRef(true)
  const fetchIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true

    const fetchData = async () => {
      const thisFetchId = ++fetchIdRef.current

      try {
        setError(null)

        const [statusData, settingsData, statsData] = await Promise.all([
          invoke(
            'get_residential_proxy_status',
            {},
            ResidentialProxyStatusSchema,
          ),
          invoke(
            'get_residential_proxy_settings',
            {},
            ResidentialProxySettingsSchema,
          ),
          invoke(
            'get_residential_proxy_stats',
            {},
            ResidentialProxyStatsSchema,
          ),
        ])

        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          setStatus(statusData)
          setSettings(settingsData)
          setStats(statsData)
          setIsLoading(false)
          setHasInitialized(true)
        }
      } catch (err) {
        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          const errorInstance =
            err instanceof Error ? err : new Error(String(err))

          setError(errorInstance)
          console.error(
            '[useResidentialProxy] Failed to fetch data:',
            errorInstance,
          )
          setIsLoading(false)
          setHasInitialized(true)
        }
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 5000)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  const updateSettings = useCallback(
    async (newSettings: ResidentialProxySettings) => {
      const validatedSettings =
        ResidentialProxySettingsSchema.parse(newSettings)
      await invoke('set_residential_proxy_settings', {
        settings: validatedSettings,
      })

      if (mountedRef.current) {
        setSettings(validatedSettings)
      }
    },
    [],
  )

  const toggleEnabled = useCallback(async () => {
    const newSettings = { ...settings, enabled: !settings.enabled }
    await updateSettings(newSettings)
  }, [settings, updateSettings])

  const register = useCallback(async (stakeAmount: string) => {
    await invoke('register_residential_proxy', { stake_amount: stakeAmount })
    const newStatus = await invoke(
      'get_residential_proxy_status',
      {},
      ResidentialProxyStatusSchema,
    )
    if (mountedRef.current) {
      setStatus(newStatus)
    }
  }, [])

  const claimRewards = useCallback(async () => {
    await invoke('claim_residential_proxy_rewards', {})
    const newStatus = await invoke(
      'get_residential_proxy_status',
      {},
      ResidentialProxyStatusSchema,
    )
    if (mountedRef.current) {
      setStatus(newStatus)
    }
  }, [])

  return {
    status,
    settings,
    stats,
    error,
    isLoading,
    hasInitialized,
    updateSettings,
    toggleEnabled,
    register,
    claimRewards,
  }
}
