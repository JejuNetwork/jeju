/**
 * Agents Hook
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_URL } from '../config'

interface Agent {
  agentId: string
  owner: string
  name: string
  botType: 'ai_agent' | 'trading_bot' | 'org_tool'
  characterCid?: string
  stateCid: string
  vaultAddress: string
  active: boolean
  registeredAt: number
  lastExecutedAt: number
  executionCount: number
}

interface AgentsSearchResponse {
  agents: Agent[]
  total: number
  hasMore: boolean
}

interface RegisterAgentRequest {
  character: {
    id: string
    name: string
    description: string
    system: string
    bio: string[]
    messageExamples: Array<Array<{ name: string; content: { text: string } }>>
    topics: string[]
    adjectives: string[]
    style: {
      all: string[]
      chat: string[]
      post: string[]
    }
  }
  initialFunding?: string
}

interface RegisterAgentResponse {
  agentId: string
  vaultAddress: string
  characterCid: string
  stateCid: string
}

export function useAgents(filters?: {
  name?: string
  owner?: string
  active?: boolean
  limit?: number
}) {
  const params = new URLSearchParams()
  if (filters?.name) params.set('name', filters.name)
  if (filters?.owner) params.set('owner', filters.owner)
  if (filters?.active !== undefined)
    params.set('active', String(filters.active))
  if (filters?.limit) params.set('limit', String(filters.limit))

  const queryString = params.toString()
  const url = queryString
    ? `/api/v1/search/agents?${queryString}`
    : '/api/v1/search/agents'

  return useQuery({
    queryKey: ['agents', filters],
    queryFn: async (): Promise<AgentsSearchResponse> => {
      const response = await fetch(`${API_URL}${url}`)
      if (!response.ok) throw new Error('Failed to fetch agents')
      return response.json()
    },
  })
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: ['agent', agentId],
    queryFn: async (): Promise<Agent> => {
      const response = await fetch(`${API_URL}/api/v1/agents/${agentId}`)
      if (!response.ok) throw new Error('Failed to fetch agent')
      const data = await response.json()
      return data.agent
    },
    enabled: !!agentId,
  })
}

export function useAgentBalance(agentId: string) {
  return useQuery({
    queryKey: ['agent-balance', agentId],
    queryFn: async (): Promise<string> => {
      const response = await fetch(
        `${API_URL}/api/v1/agents/${agentId}/balance`,
      )
      if (!response.ok) throw new Error('Failed to fetch balance')
      const data = await response.json()
      return data.balance
    },
    enabled: !!agentId,
    refetchInterval: 30_000,
  })
}

export function useRegisterAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      request: RegisterAgentRequest,
    ): Promise<RegisterAgentResponse> => {
      const response = await fetch(`${API_URL}/api/v1/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to register agent')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

export type { Agent, RegisterAgentRequest, RegisterAgentResponse }
