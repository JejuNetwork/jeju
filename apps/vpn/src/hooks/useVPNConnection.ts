/**
 * Hook for VPN connection management
 *
 * Handles connecting and disconnecting VPN with proper abort handling
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../api'
import type { VPNNode } from '../api/schemas'

export function useVPNConnection() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // SECURITY: Track pending operations to prevent race conditions
  const pendingOperationRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Cancel any pending operations
      pendingOperationRef.current?.abort()
    }
  }, [])

  const connect = useCallback(async (node: VPNNode | null) => {
    // Cancel any pending operation
    pendingOperationRef.current?.abort()

    const abortController = new AbortController()
    pendingOperationRef.current = abortController

    setIsLoading(true)
    setError(null)

    try {
      await invoke('connect', { nodeId: node?.node_id ?? null })

      // Only update state if still mounted and not aborted
      if (mountedRef.current && !abortController.signal.aborted) {
        setIsLoading(false)
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }

      const error = err instanceof Error ? err : new Error('Failed to connect')

      // Only update state if still mounted and not aborted
      if (mountedRef.current && !abortController.signal.aborted) {
        setError(error)
        setIsLoading(false)
      }
      throw error // Fail fast
    }
  }, [])

  const disconnect = useCallback(async () => {
    // Cancel any pending operation
    pendingOperationRef.current?.abort()

    const abortController = new AbortController()
    pendingOperationRef.current = abortController

    setIsLoading(true)
    setError(null)

    try {
      await invoke('disconnect', {})

      // Only update state if still mounted and not aborted
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

      // Only update state if still mounted and not aborted
      if (mountedRef.current && !abortController.signal.aborted) {
        setError(error)
        setIsLoading(false)
      }
      throw error // Fail fast
    }
  }, [])

  return { connect, disconnect, isLoading, error }
}
