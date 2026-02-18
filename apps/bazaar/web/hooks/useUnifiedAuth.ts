/**
 * Unified Auth Hook
 *
 * Bridges OAuth3 session management with wagmi wallet connection.
 * Provides a single source of truth for authentication state.
 *
 * Priority:
 * 1. wagmi connection (direct wallet - most reliable for transactions)
 * 2. OAuth3 session (for TEE-backed features like signing)
 *
 * The hook ensures both systems stay in sync when possible.
 */

import { useJejuAuth, useOAuth3 } from '@jejunetwork/auth/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

export interface UnifiedAuthState {
  /** Whether auth is ready (not loading) */
  ready: boolean
  /** Whether user is authenticated via either system */
  isAuthenticated: boolean
  /** Wallet address from either wagmi or OAuth3 */
  address: Address | null
  /** Whether connected via wagmi (can do transactions) */
  hasWagmiConnection: boolean
  /** Whether has OAuth3 session (TEE-backed) */
  hasOAuth3Session: boolean
  /** Loading state */
  isLoading: boolean
  /** Error message from last auth operation */
  error: string | null
}

export interface UnifiedAuthActions {
  /** Connect wallet via wagmi (preferred for transactions) */
  connect: () => Promise<void>
  /** Login via OAuth3 TEE agent (creates attested session) */
  loginWithOAuth3: () => Promise<void>
  /** Disconnect/logout from both systems */
  disconnect: () => Promise<void>
  /** Sync OAuth3 session to wagmi (if OAuth3 has address but wagmi doesn't) */
  syncToWagmi: () => Promise<void>
}

export interface UseUnifiedAuthReturn extends UnifiedAuthState, UnifiedAuthActions {}

/**
 * useUnifiedAuth - Single hook for all auth needs
 *
 * Combines wagmi (direct wallet) and OAuth3 (TEE sessions) into one interface.
 *
 * @example
 * ```tsx
 * const { isAuthenticated, address, connect, disconnect } = useUnifiedAuth();
 *
 * if (!isAuthenticated) {
 *   return <button onClick={connect}>Connect Wallet</button>;
 * }
 *
 * return <span>Connected: {address}</span>;
 * ```
 */
export function useUnifiedAuth(): UseUnifiedAuthReturn {
  // wagmi state
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount()
  const { connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()

  // OAuth3 state
  const {
    ready: oauth3Ready,
    authenticated: oauth3Authenticated,
    walletAddress: oauth3Address,
    loginWithWallet: oauth3Login,
    logout: oauth3Logout,
    loading: oauth3Loading,
  } = useJejuAuth()

  // OAuth3 error from provider
  const { error: oauth3Error } = useOAuth3()

  // Local error state for auth operations
  const [localError, setLocalError] = useState<string | null>(null)

  // Derived state - prefer wagmi address as it's transaction-capable
  const address = wagmiAddress ?? oauth3Address ?? null
  const isAuthenticated = wagmiConnected || oauth3Authenticated
  const ready = !oauth3Loading
  const isLoading = oauth3Loading
  const error = localError ?? oauth3Error

  // Connect via wagmi (standard wallet connection)
  const connect = useCallback(async () => {
    setLocalError(null)
    try {
      await connectAsync({ connector: injected() })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      console.error('[UnifiedAuth] wagmi connect failed:', err)
      setLocalError(message)
      throw err
    }
  }, [connectAsync])

  // Login via OAuth3 (creates TEE-attested session)
  const loginWithOAuth3 = useCallback(async () => {
    console.log('[UnifiedAuth] loginWithOAuth3: Starting OAuth3 login...')
    console.log('[UnifiedAuth] loginWithOAuth3: Current state:', {
      oauth3Ready,
      oauth3Loading,
      oauth3Authenticated,
      oauth3Address: oauth3Address?.slice(0, 10) || null,
    })
    setLocalError(null)
    try {
      await oauth3Login()
      console.log('[UnifiedAuth] loginWithOAuth3: OAuth3 login successful!')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to login with OAuth3'
      console.error('[UnifiedAuth] loginWithOAuth3: OAuth3 login failed:', message)
      // Check for common OAuth3 errors
      if (message.includes('fetch') || message.includes('network')) {
        setLocalError('OAuth3 service unavailable. Using direct wallet connection.')
      } else {
        setLocalError(message)
      }
      throw err
    }
  }, [oauth3Login, oauth3Ready, oauth3Loading, oauth3Authenticated, oauth3Address])

  // Disconnect from both systems
  const disconnect = useCallback(async () => {
    const errors: Error[] = []

    // Disconnect wagmi
    if (wagmiConnected) {
      try {
        await disconnectAsync()
      } catch (err) {
        errors.push(err as Error)
      }
    }

    // Logout OAuth3
    if (oauth3Authenticated) {
      try {
        await oauth3Logout()
      } catch (err) {
        errors.push(err as Error)
      }
    }

    if (errors.length > 0) {
      console.warn('[UnifiedAuth] Some disconnections failed:', errors)
    }
  }, [wagmiConnected, oauth3Authenticated, disconnectAsync, oauth3Logout])

  // Sync OAuth3 session to wagmi
  // If user logged in via OAuth3 but wagmi isn't connected, try to connect wagmi
  const syncToWagmi = useCallback(async () => {
    if (oauth3Authenticated && oauth3Address && !wagmiConnected) {
      try {
        await connectAsync({ connector: injected() })
      } catch (err) {
        // This is expected if no wallet extension is available
        console.debug('[UnifiedAuth] Could not sync to wagmi:', err)
      }
    }
  }, [oauth3Authenticated, oauth3Address, wagmiConnected, connectAsync])

  // Auto-sync: When OAuth3 authenticates, try to connect wagmi too
  useEffect(() => {
    if (oauth3Authenticated && oauth3Address && !wagmiConnected) {
      // Attempt to sync wagmi, but don't block on failure
      syncToWagmi().catch(() => {
        // Silently ignore - user may not have wallet extension
      })
    }
  }, [oauth3Authenticated, oauth3Address, wagmiConnected, syncToWagmi])

  return useMemo(
    () => ({
      // State
      ready,
      isAuthenticated,
      address,
      hasWagmiConnection: wagmiConnected,
      hasOAuth3Session: oauth3Authenticated,
      isLoading,
      error,
      // Actions
      connect,
      loginWithOAuth3,
      disconnect,
      syncToWagmi,
    }),
    [
      ready,
      isAuthenticated,
      address,
      wagmiConnected,
      oauth3Authenticated,
      isLoading,
      error,
      connect,
      loginWithOAuth3,
      disconnect,
      syncToWagmi,
    ],
  )
}
