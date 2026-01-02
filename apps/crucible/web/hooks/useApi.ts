import { useOAuth3 } from '@jejunetwork/auth/react'
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { API_URL } from '../config'

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: Record<string, unknown>
  headers?: Record<string, string>
  requireAuth?: boolean
}

/**
 * Hook to get authenticated fetch function
 * Automatically includes auth headers when user is connected
 */
export function useAuthenticatedFetch() {
  const { session, isAuthenticated, smartAccountAddress } = useOAuth3()

  const authenticatedFetch = useCallback(
    async <T>(endpoint: string, options: ApiOptions = {}): Promise<T> => {
      const {
        method = 'GET',
        body,
        headers = {},
        requireAuth = false,
      } = options

      // Build auth headers if authenticated
      const authHeaders: Record<string, string> = {}
      if (isAuthenticated && smartAccountAddress) {
        authHeaders['X-Jeju-Address'] = smartAccountAddress
        if (session?.sessionId) {
          authHeaders.Authorization = `Bearer ${session.sessionId}`
        }
      } else if (requireAuth) {
        throw new Error('Authentication required')
      }

      const response = await fetch(`${API_URL}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: 'Request failed' }))
        throw new Error(error.error ?? `HTTP ${response.status}`)
      }

      return response.json()
    },
    [isAuthenticated, smartAccountAddress, session],
  )

  return { authenticatedFetch, isAuthenticated }
}

/**
 * Simple unauthenticated fetch for public endpoints
 */
async function apiFetch<T>(
  endpoint: string,
  options: ApiOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error ?? `HTTP ${response.status}`)
  }

  return response.json()
}

interface HealthResponse {
  status: string
  service: string
  network: string
  timestamp: string
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    refetchInterval: 30_000,
    retry: 3,
    retryDelay: 1000,
  })
}

interface InfoResponse {
  service: string
  version: string
  network: string
  hasSigner: boolean
  dwsAvailable: boolean
  runtimes: number
}

export function useInfo() {
  return useQuery({
    queryKey: ['info'],
    queryFn: () => apiFetch<InfoResponse>('/info'),
  })
}

export { apiFetch }
