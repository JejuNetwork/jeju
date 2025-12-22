/**
 * useSession Hook
 *
 * Provides session state and management.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Address, Hex } from 'viem'
import type { OAuth3Session } from '../../index.js'
import { useOAuth3 } from '../provider.js'

export interface UseSessionReturn {
  session: OAuth3Session | null
  isAuthenticated: boolean
  isLoading: boolean

  // Session details
  sessionId: Hex | null
  identityId: Hex | null
  smartAccountAddress: Address | null
  expiresAt: number | null
  capabilities: string[]

  // Actions
  refreshSession: () => Promise<OAuth3Session | null>
  logout: () => Promise<void>

  // Helpers
  isExpired: boolean
  timeUntilExpiry: number
}

export function useSession(): UseSessionReturn {
  const {
    session,
    isAuthenticated,
    isLoading,
    refreshSession: oauth3RefreshSession,
    logout: oauth3Logout,
    smartAccountAddress,
    identityId,
  } = useOAuth3()

  const [timeUntilExpiry, setTimeUntilExpiry] = useState(0)

  // Update time until expiry
  useEffect(() => {
    if (!session) {
      setTimeUntilExpiry(0)
      return
    }

    const updateExpiry = () => {
      const remaining = Math.max(0, session.expiresAt - Date.now())
      setTimeUntilExpiry(remaining)
    }

    updateExpiry()
    const interval = setInterval(updateExpiry, 1000)

    return () => clearInterval(interval)
  }, [session?.expiresAt, session])

  const refreshSession =
    useCallback(async (): Promise<OAuth3Session | null> => {
      return oauth3RefreshSession()
    }, [oauth3RefreshSession])

  const logout = useCallback(async () => {
    await oauth3Logout()
  }, [oauth3Logout])

  return {
    session,
    isAuthenticated,
    isLoading,
    sessionId: session?.sessionId ?? null,
    identityId,
    smartAccountAddress,
    expiresAt: session?.expiresAt ?? null,
    capabilities: session?.capabilities ?? [],
    refreshSession,
    logout,
    isExpired: session ? session.expiresAt < Date.now() : true,
    timeUntilExpiry,
  }
}
