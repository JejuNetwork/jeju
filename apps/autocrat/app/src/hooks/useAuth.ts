/**
 * Authentication Hooks
 *
 * React Query hooks for OAuth3 authentication flows.
 * Replaces direct fetch calls in auth components.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

export interface AuthSession {
  address: string
  method: 'siwe' | 'siwf' | 'passkey' | 'social'
  expiresAt: number
}

interface OAuth3InitResponse {
  authUrl: string
  state: string
}

interface OAuth3CallbackResponse {
  address: string
  provider: string
}

type AuthProvider = 'farcaster' | 'google' | 'github' | 'discord' | 'twitter'

export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
}

export function useSession() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: (): AuthSession | null => {
      const stored = localStorage.getItem('autocrat_session')
      if (!stored) return null

      const session = JSON.parse(stored) as AuthSession

      // Check expiration
      if (session.expiresAt < Date.now()) {
        localStorage.removeItem('autocrat_session')
        return null
      }

      return session
    },
    staleTime: Infinity, // Session doesn't change unless we update it
  })
}

export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      localStorage.removeItem('autocrat_session')
      sessionStorage.removeItem('oauth3_state')
    },
    onSuccess: () => {
      queryClient.setQueryData(authKeys.session(), null)
    },
  })
}

function getOAuth3Url(): string {
  return import.meta.env.VITE_OAUTH3_AGENT_URL || 'http://localhost:4200'
}

function getRedirectUri(): string {
  return `${window.location.origin}/auth/callback`
}

export function useOAuth3Init() {
  return useMutation({
    mutationFn: async (provider: AuthProvider): Promise<string> => {
      const oauth3Url = getOAuth3Url()
      const redirectUri = getRedirectUri()

      const response = await fetch(`${oauth3Url}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          appId: 'autocrat.apps.jeju',
          redirectUri,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to initialize ${provider} auth`)
      }

      const data = (await response.json()) as OAuth3InitResponse
      sessionStorage.setItem('oauth3_state', data.state)

      return data.authUrl
    },
  })
}

export function useOAuth3Callback() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: async ({
      code,
      state,
    }: {
      code: string
      state: string
    }): Promise<AuthSession> => {
      const storedState = sessionStorage.getItem('oauth3_state')
      if (state !== storedState) {
        throw new Error('State mismatch - possible CSRF attack')
      }

      const oauth3Url = getOAuth3Url()

      const response = await fetch(`${oauth3Url}/auth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
      })

      if (!response.ok) {
        throw new Error('Failed to complete authentication')
      }

      const { address, provider } =
        (await response.json()) as OAuth3CallbackResponse

      const session: AuthSession = {
        address,
        method: provider === 'farcaster' ? 'siwf' : 'social',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }

      localStorage.setItem('autocrat_session', JSON.stringify(session))
      sessionStorage.removeItem('oauth3_state')

      return session
    },
    onSuccess: (session) => {
      queryClient.setQueryData(authKeys.session(), session)
      navigate('/')
    },
  })
}

export function usePasskeyAuth() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<AuthSession> => {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: window.location.hostname,
          userVerification: 'preferred',
          timeout: 60000,
        },
      })

      if (!credential) {
        throw new Error('Passkey authentication cancelled')
      }

      const session: AuthSession = {
        address: `passkey:${credential.id.slice(0, 20)}`,
        method: 'passkey',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }

      localStorage.setItem('autocrat_session', JSON.stringify(session))

      return session
    },
    onSuccess: (session) => {
      queryClient.setQueryData(authKeys.session(), session)
    },
  })
}

export function useSIWEAuth() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      address,
      signature: _signature,
    }: {
      address: string
      signature: string
    }): Promise<AuthSession> => {
      // In production, verify signature on backend
      // For now, create session directly after wallet signs
      const session: AuthSession = {
        address,
        method: 'siwe',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }

      localStorage.setItem('autocrat_session', JSON.stringify(session))

      return session
    },
    onSuccess: (session) => {
      queryClient.setQueryData(authKeys.session(), session)
    },
  })
}
