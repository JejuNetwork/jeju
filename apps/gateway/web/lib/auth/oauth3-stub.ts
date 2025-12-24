import type { AuthProvider } from './types'

export interface OAuth3Session {
  address: string
  provider: AuthProvider
  expiresAt: number
}

export interface OAuth3ContextValue {
  session: OAuth3Session | null
  isLoading: boolean
  login: ((provider: AuthProvider) => Promise<void>) | null
  logout: (() => Promise<void>) | null
}

export function useOAuth3(): OAuth3ContextValue | null {
  return null
}
