/**
 * Hook for VPN status management
 *
 * Handles fetching and updating VPN connection status with proper abort handling
 */

import { useEffect, useRef, useState } from 'react'
import { invoke } from '../api'
import { type VPNStatus, VPNStatusSchema } from '../api/schemas'

export function useVPNStatus() {
  const [status, setStatus] = useState<VPNStatus>({
    status: 'Disconnected',
    connection: null,
  })
  const [error, setError] = useState<Error | null>(null)

  // SECURITY: Track component mount state to prevent race conditions
  const mountedRef = useRef(true)
  const fetchIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true

    const fetchStatus = async () => {
      // Track this fetch's ID to detect stale responses
      const thisFetchId = ++fetchIdRef.current

      try {
        const vpnStatus = await invoke('get_status', {}, VPNStatusSchema)

        // Only update state if still mounted and this is the latest fetch
        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          setStatus(vpnStatus)
          setError(null)
        }
      } catch (err) {
        // Only update state if still mounted and this is the latest fetch
        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          const error =
            err instanceof Error ? err : new Error('Failed to fetch VPN status')
          setError(error)
          // Fail-fast: set error status
          setStatus({ status: 'Error', connection: null })
        }
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  return { status, error }
}
