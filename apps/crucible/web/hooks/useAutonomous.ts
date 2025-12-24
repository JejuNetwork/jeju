/**
 * Autonomous Mode Hook
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_URL } from '../config'

interface AutonomousStatus {
  enabled: boolean
  running?: boolean
  message?: string
  agents?: Array<{
    agentId: string
    characterId: string
    tickIntervalMs: number
    lastTickAt: number
    tickCount: number
    status: 'running' | 'stopped' | 'error'
  }>
}

interface RegisterAutonomousAgentRequest {
  characterId: string
  tickIntervalMs?: number
  capabilities?: {
    compute?: boolean
    storage?: boolean
    defi?: boolean
    governance?: boolean
    a2a?: boolean
  }
}

export function useAutonomousStatus() {
  return useQuery({
    queryKey: ['autonomous-status'],
    queryFn: async (): Promise<AutonomousStatus> => {
      const response = await fetch(`${API_URL}/api/v1/autonomous/status`)
      if (!response.ok) throw new Error('Failed to fetch autonomous status')
      return response.json()
    },
    refetchInterval: 10_000,
  })
}

export function useStartAutonomous() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<{
      success: boolean
      status: AutonomousStatus
    }> => {
      const response = await fetch(`${API_URL}/api/v1/autonomous/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to start autonomous mode')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

export function useStopAutonomous() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<{ success: boolean }> => {
      const response = await fetch(`${API_URL}/api/v1/autonomous/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to stop autonomous mode')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

export function useRegisterAutonomousAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      request: RegisterAutonomousAgentRequest,
    ): Promise<{ success: boolean; agentId: string }> => {
      const response = await fetch(`${API_URL}/api/v1/autonomous/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to register autonomous agent')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

export function useRemoveAutonomousAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (agentId: string): Promise<{ success: boolean }> => {
      const response = await fetch(
        `${API_URL}/api/v1/autonomous/agents/${agentId}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to remove autonomous agent')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous-status'] })
    },
  })
}

export type { AutonomousStatus, RegisterAutonomousAgentRequest }
