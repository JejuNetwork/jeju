/**
 * useJejuAuth - Convenience wrapper around useOAuth3
 *
 * Provides simpler property names and convenience methods for common auth patterns.
 */

import { useCallback, useMemo } from 'react'
import type { Address, Hex } from 'viem'
import type { AuthProvider } from '../../types.js'
import { useOAuth3 } from '../provider.js'

/**
 * Linked account information
 */
export interface LinkedAccount {
  /** Account type (e.g., 'farcaster', 'twitter', 'email') */
  type: string
  /** Account identifier (e.g., FID, username, email) */
  identifier: string
  /** Display handle */
  handle?: string
  /** When linked */
  linkedAt: number
}

/**
 * Jeju auth context value with convenience properties
 */
export interface UseJejuAuthReturn {
  /** Whether auth is ready (not loading) */
  ready: boolean
  /** Whether user is authenticated */
  authenticated: boolean
  /** Whether auth is loading */
  loading: boolean
  /** User ID (identity ID) */
  userId: Hex | null
  /** Connected wallet address */
  walletAddress: Address | null
  /** Linked social accounts */
  linkedAccounts: LinkedAccount[]

  // Convenience login methods
  /** Login with wallet */
  loginWithWallet: () => Promise<void>
  /** Login with Farcaster */
  loginWithFarcaster: () => Promise<void>
  /** Logout */
  logout: () => Promise<void>

  // Token access
  /** Get access token for API calls */
  getAccessToken: () => Promise<string | null>

  // Pass through session for advanced usage
  session: ReturnType<typeof useOAuth3>['session']
}

/**
 * useJejuAuth hook
 *
 * Convenience wrapper around useOAuth3 with simpler property names.
 *
 * @example
 * ```tsx
 * import { useJejuAuth } from '@jejunetwork/auth';
 *
 * function MyComponent() {
 *   const {
 *     authenticated,
 *     loginWithWallet,
 *     logout,
 *   } = useJejuAuth();
 *
 *   if (!authenticated) {
 *     return <button onClick={loginWithWallet}>Connect Wallet</button>;
 *   }
 *
 *   return <button onClick={logout}>Sign Out</button>;
 * }
 * ```
 */
export function useJejuAuth(): UseJejuAuthReturn {
  const oauth3 = useOAuth3()

  // Build linked accounts from credentials
  const linkedAccounts = useMemo((): LinkedAccount[] => {
    // For now return empty array - app should fetch via API or getCredentials()
    return []
  }, [])

  // Login with wallet
  const loginWithWallet = useCallback(async () => {
    await oauth3.login('wallet' as AuthProvider)
  }, [oauth3.login])

  // Login with Farcaster
  const loginWithFarcaster = useCallback(async () => {
    await oauth3.login('farcaster' as AuthProvider)
  }, [oauth3.login])

  // Get access token
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const session = oauth3.session
    if (!session) return null
    return session.sessionId ?? null
  }, [oauth3.session])

  return {
    ready: !oauth3.isLoading,
    authenticated: oauth3.isAuthenticated,
    loading: oauth3.isLoading,
    userId: oauth3.identityId,
    walletAddress: oauth3.smartAccountAddress,
    linkedAccounts,
    loginWithWallet,
    loginWithFarcaster,
    logout: oauth3.logout,
    getAccessToken,
    session: oauth3.session,
  }
}
