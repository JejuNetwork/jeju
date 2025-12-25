/**
 * Base API Hook
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { API_URL } from '../config'

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: Record<string, unknown>
  headers?: Record<string, string>
}

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
  })
}

interface InfoResponse {
  service: string
  version: string
  network: string
  hasWallet: boolean
  dwsAvailable: boolean
  runtimes: number
}

export function useInfo() {
  return useQuery({
    queryKey: ['info'],
    queryFn: () => apiFetch<InfoResponse>('/info'),
  })
}

export { apiFetch, useQueryClient }
