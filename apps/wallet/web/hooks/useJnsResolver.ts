/**
 * React hook for JNS gateway resolution
 *
 * Provides a unified interface for resolving .jeju domains
 * and managing JNS gateway settings.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  type JNSResolution,
  type JNSResolverSettings,
  jnsResolver,
} from '../../api/services/jns'

interface JNSGatewayStatus {
  localDws: 'online' | 'offline'
  publicGateway: 'online' | 'offline'
  localDwsLatency: number | null
  publicGatewayLatency: number | null
}

interface UseJnsResolverReturn {
  settings: JNSResolverSettings | null
  isLoading: boolean
  error: string | null
  gatewayStatus: JNSGatewayStatus | null

  // Actions
  resolve: (domain: string) => Promise<JNSResolution | null>
  updateSettings: (settings: Partial<JNSResolverSettings>) => Promise<void>
  clearCache: () => Promise<void>
  checkStatus: () => Promise<void>
  getRedirectUrl: (resolution: JNSResolution, path?: string) => string
}

export function useJnsResolver(): UseJnsResolverReturn {
  const [settings, setSettings] = useState<JNSResolverSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatewayStatus, setGatewayStatus] = useState<JNSGatewayStatus | null>(
    null,
  )

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        await jnsResolver.init()
        setSettings(jnsResolver.getSettings())
        setIsLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings')
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [])

  const resolve = useCallback(
    async (domain: string): Promise<JNSResolution | null> => {
      setError(null)
      try {
        await jnsResolver.init()
        return jnsResolver.resolve(domain)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to resolve domain'
        setError(message)
        return null
      }
    },
    [],
  )

  const updateSettings = useCallback(
    async (newSettings: Partial<JNSResolverSettings>): Promise<void> => {
      setError(null)
      try {
        await jnsResolver.init()
        const updated = await jnsResolver.updateSettings(newSettings)
        setSettings(updated)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update settings'
        setError(message)
        throw err
      }
    },
    [],
  )

  const clearCache = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      await jnsResolver.init()
      await jnsResolver.clearCache()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to clear cache'
      setError(message)
      throw err
    }
  }, [])

  const checkStatus = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      await jnsResolver.init()
      const status = await jnsResolver.checkStatus()
      setGatewayStatus(status)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to check status'
      setError(message)
    }
  }, [])

  const getRedirectUrl = useCallback(
    (resolution: JNSResolution, path: string = ''): string => {
      return jnsResolver.getRedirectUrl(resolution, path)
    },
    [],
  )

  return {
    settings,
    isLoading,
    error,
    gatewayStatus,
    resolve,
    updateSettings,
    clearCache,
    checkStatus,
    getRedirectUrl,
  }
}
