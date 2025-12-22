/**
 * OAuth3 Provider (Browser-compatible)
 *
 * Provides OAuth3 authentication context with graceful fallback
 * when server-side packages are not available.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react'

export interface OAuth3Config {
  appId: string
  redirectUri: string
  chainId: number
  rpcUrl: string
  teeAgentUrl?: string
  decentralized?: boolean
}

export interface OAuth3Session {
  identityId: string
  smartAccountAddress: string
  providers: string[]
}

export interface OAuth3ContextValue {
  session: OAuth3Session | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
  login: (provider?: string) => Promise<void>
  logout: () => Promise<void>
}

const OAuth3Context = createContext<OAuth3ContextValue | null>(null)

export interface OAuth3ProviderProps {
  children: ReactNode
  config: OAuth3Config
  autoConnect?: boolean
}

export function OAuth3Provider({
  children,
  config: _config,
  autoConnect: _autoConnect = true,
}: OAuth3ProviderProps) {
  const [session, setSession] = useState<OAuth3Session | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const login = useCallback(async (_provider?: string) => {
    setIsLoading(true)
    setError(null)

    // In browser build, OAuth3 requires the full package
    // This stub allows the app to render without breaking
    setError('OAuth3 login requires full package (coming soon)')
    setIsLoading(false)
  }, [])

  const logout = useCallback(async () => {
    setSession(null)
  }, [])

  const value: OAuth3ContextValue = {
    session,
    isLoading,
    isAuthenticated: session !== null,
    error,
    login,
    logout,
  }

  return (
    <OAuth3Context.Provider value={value}>{children}</OAuth3Context.Provider>
  )
}

export function useOAuth3(): OAuth3ContextValue {
  const context = useContext(OAuth3Context)
  if (!context) {
    throw new Error('useOAuth3 must be used within OAuth3Provider')
  }
  return context
}
