import { useEffect, useRef, useState } from 'react'
import { invoke } from '../../lib'
import { type VPNStatus, VPNStatusSchema } from '../../lib/schemas'

export function useVPNStatus() {
  const [status, setStatus] = useState<VPNStatus>({
    status: 'Disconnected',
    connection: null,
  })
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(true)
  const fetchIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true

    const fetchStatus = async () => {
      const thisFetchId = ++fetchIdRef.current

      try {
        const vpnStatus = await invoke('get_status', {}, VPNStatusSchema)

        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          setStatus(vpnStatus)
          setError(null)
        }
      } catch (err) {
        if (mountedRef.current && thisFetchId === fetchIdRef.current) {
          const error =
            err instanceof Error ? err : new Error('Failed to fetch VPN status')
          setError(error)
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
