/**
 * useJejuAuth - Convenience wrapper around useOAuth3
 *
 * Provides simpler property names and convenience methods for common auth patterns.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address, Hex } from 'viem'
import type { AuthProvider, VerifiableCredential } from '../../types.js'
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
 * Parse credential type to account type
 */
function credentialTypeToAccountType(credentialTypes: string[]): string {
  for (const type of credentialTypes) {
    if (type.includes('Farcaster')) return 'farcaster'
    if (type.includes('Twitter')) return 'twitter'
    if (type.includes('Google')) return 'google'
    if (type.includes('GitHub')) return 'github'
    if (type.includes('Discord')) return 'discord'
    if (type.includes('Apple')) return 'apple'
    if (type.includes('Email')) return 'email'
    if (type.includes('Phone')) return 'phone'
  }
  return 'wallet'
}

/**
 * Convert verifiable credentials to linked accounts
 */
function credentialsToLinkedAccounts(
  credentials: VerifiableCredential[],
): LinkedAccount[] {
  return credentials.map((credential) => ({
    type: credentialTypeToAccountType(credential.type),
    identifier: credential.credentialSubject.providerId,
    handle: credential.credentialSubject.providerHandle,
    linkedAt: new Date(credential.issuanceDate).getTime(),
  }))
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
  const [credentials, setCredentials] = useState<VerifiableCredential[]>([])

  // Fetch credentials when session changes
  useEffect(() => {
    if (oauth3.session) {
      oauth3.getCredentials().then(setCredentials).catch(console.error)
    } else {
      setCredentials([])
    }
  }, [oauth3.session, oauth3.getCredentials])

  // Build linked accounts from credentials
  const linkedAccounts = useMemo((): LinkedAccount[] => {
    return credentialsToLinkedAccounts(credentials)
  }, [credentials])

  // Login with wallet
  const loginWithWallet = useCallback(async () => {
    console.log('[useJejuAuth] loginWithWallet: Starting...')
    try {
      await oauth3.login('wallet' as AuthProvider)
      console.log('[useJejuAuth] loginWithWallet: Success!')
    } catch (err) {
      console.error('[useJejuAuth] loginWithWallet: Failed:', err instanceof Error ? err.message : err)
      throw err
    }
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
