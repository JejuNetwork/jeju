/**
 * Hook for contribution status management
 *
 * Handles fetching contribution data and settings with proper abort handling
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../api'
import {
  type BandwidthState,
  BandwidthStateSchema,
  type ContributionSettings,
  ContributionSettingsSchema,
  type ContributionStats,
  ContributionStatsSchema,
  type ContributionStatus,
  ContributionStatusSchema,
  type DWSState,
  DWSStateSchema,
} from '../api/schemas'

export function useContribution() {
  const [status, setStatus] = useState<ContributionStatus | null>(null)
  const [stats, setStats] = useState<ContributionStats | null>(null)
  const [settings, setSettings] = useState<ContributionSettings | null>(null)
  const [bandwidth, setBandwidth] = useState<BandwidthState | null>(null)
  const [dws, setDws] = useState<DWSState | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // SECURITY: Track component mount state to prevent race conditions
  const mountedRef = useRef(true)
  const fetchIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true

    const fetchData = async () => {
      // Track this fetch's ID to detect stale responses
      const thisFetchId = ++fetchIdRef.current

      try {
        const [statusData, statsData, settingsData, bwData, dwsData] =
          await Promise.all([
            invoke('get_contribution_status', {}, ContributionStatusSchema),
            invoke('get_contribution_stats', {}, ContributionStatsSchema),
            invoke('get_contribution_settings', {}, ContributionSettingsSchema),
            invoke('get_bandwidth_state', {}, BandwidthStateSchema),
            invoke('get_dws_state', {}, DWSStateSchema),
          ])

        // Only update state if still mounted and this is the latest fetch
        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          setStatus(statusData)
          setStats(statsData)
          setSettings(settingsData)
          setBandwidth(bwData)
          setDws(dwsData)
          setError(null)
        }
      } catch (err) {
        // Only update state if still mounted and this is the latest fetch
        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          const error =
            err instanceof Error
              ? err
              : new Error('Failed to fetch contribution data')
          setError(error)
          // Fail-fast: clear all data on error
          setStatus(null)
          setStats(null)
          setSettings(null)
          setBandwidth(null)
          setDws(null)
        }
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 3000)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  const updateSettings = useCallback(
    async (newSettings: ContributionSettings) => {
      const validatedSettings = ContributionSettingsSchema.parse(newSettings)
      await invoke('set_contribution_settings', { settings: validatedSettings })

      // Only update if still mounted
      if (mountedRef.current) {
        setSettings(validatedSettings)
      }
    },
    [],
  )

  return { status, stats, settings, bandwidth, dws, updateSettings, error }
}
