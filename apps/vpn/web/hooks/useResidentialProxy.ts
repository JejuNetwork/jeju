import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../../lib'
import {
  type ResidentialProxySettings,
  ResidentialProxySettingsSchema,
  type ResidentialProxyStatus,
  ResidentialProxyStatusSchema,
  type ResidentialProxyStats,
  ResidentialProxyStatsSchema,
} from '../../lib/schemas'

export function useResidentialProxy() {
  const [status, setStatus] = useState<ResidentialProxyStatus | null>(null)
  const [settings, setSettings] = useState<ResidentialProxySettings | null>(null)
  const [stats, setStats] = useState<ResidentialProxyStats | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const mountedRef = useRef(true)
  const fetchIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true

    const fetchData = async () => {
      const thisFetchId = ++fetchIdRef.current

      try {
        const [statusData, settingsData, statsData] = await Promise.all([
          invoke('get_residential_proxy_status', {}, ResidentialProxyStatusSchema),
          invoke('get_residential_proxy_settings', {}, ResidentialProxySettingsSchema),
          invoke('get_residential_proxy_stats', {}, ResidentialProxyStatsSchema),
        ])

        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          setStatus(statusData)
          setSettings(settingsData)
          setStats(statsData)
          setError(null)
          setIsLoading(false)
        }
      } catch (err) {
        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          // If the commands don't exist yet, use defaults
          const defaultSettings: ResidentialProxySettings = {
            enabled: false,
            node_type: 'residential',
            max_bandwidth_mbps: 100,
            max_concurrent_connections: 50,
            allowed_ports: [80, 443, 8080, 8443],
            blocked_domains: [],
            schedule_enabled: false,
          }
          const defaultStatus: ResidentialProxyStatus = {
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
          const defaultStats: ResidentialProxyStats = {
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

          setSettings(defaultSettings)
          setStatus(defaultStatus)
          setStats(defaultStats)
          setError(null)
          setIsLoading(false)
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
      const validatedSettings = ResidentialProxySettingsSchema.parse(newSettings)
      await invoke('set_residential_proxy_settings', { settings: validatedSettings })

      if (mountedRef.current) {
        setSettings(validatedSettings)
      }
    },
    [],
  )

  const toggleEnabled = useCallback(async () => {
    if (!settings) return

    const newSettings = { ...settings, enabled: !settings.enabled }
    await updateSettings(newSettings)
  }, [settings, updateSettings])

  const register = useCallback(async (stakeAmount: string) => {
    await invoke('register_residential_proxy', { stake_amount: stakeAmount })
    // Refresh status after registration
    const newStatus = await invoke('get_residential_proxy_status', {}, ResidentialProxyStatusSchema)
    if (mountedRef.current) {
      setStatus(newStatus)
    }
  }, [])

  const claimRewards = useCallback(async () => {
    await invoke('claim_residential_proxy_rewards', {})
    // Refresh status after claiming
    const newStatus = await invoke('get_residential_proxy_status', {}, ResidentialProxyStatusSchema)
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
    updateSettings,
    toggleEnabled,
    register,
    claimRewards,
  }
}
