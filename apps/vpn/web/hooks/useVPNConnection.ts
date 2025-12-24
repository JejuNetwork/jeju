import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../../lib'
import type { VPNNode } from '../../lib/schemas'

export function useVPNConnection() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const pendingOperationRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      pendingOperationRef.current?.abort()
    }
  }, [])

  const connect = useCallback(async (node: VPNNode | null) => {
    pendingOperationRef.current?.abort()

    const abortController = new AbortController()
    pendingOperationRef.current = abortController

    setIsLoading(true)
    setError(null)

    try {
      await invoke('connect', { nodeId: node?.node_id ?? null })

      if (mountedRef.current && !abortController.signal.aborted) {
        setIsLoading(false)
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }

      const error = err instanceof Error ? err : new Error('Failed to connect')

      if (mountedRef.current && !abortController.signal.aborted) {
        setError(error)
        setIsLoading(false)
      }
      throw error
    }
  }, [])

  const disconnect = useCallback(async () => {
    pendingOperationRef.current?.abort()

    const abortController = new AbortController()
    pendingOperationRef.current = abortController

    setIsLoading(true)
    setError(null)

    try {
      await invoke('disconnect', {})

      if (mountedRef.current && !abortController.signal.aborted) {
        setIsLoading(false)
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }

      const error =
        err instanceof Error ? err : new Error('Failed to disconnect')

      if (mountedRef.current && !abortController.signal.aborted) {
        setError(error)
        setIsLoading(false)
      }
      throw error
    }
  }, [])

  return { connect, disconnect, isLoading, error }
}
