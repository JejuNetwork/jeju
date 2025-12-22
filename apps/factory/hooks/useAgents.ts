'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { getContractAddressSafe, getDwsUrl } from '../config/contracts'

// ============ Types ============

export type AgentStatus = 'active' | 'paused' | 'offline'
export type AgentType = 'validator' | 'compute' | 'oracle' | 'assistant'

export interface AgentCapability {
  name: string
  version: string
  config?: Record<string, string | number | boolean>
}

export interface AgentMetrics {
  tasksCompleted: number
  successRate: number
  avgResponseTime: number
  reputation: number
  uptime: number
}

export interface Agent {
  id: string
  name: string
  address: string
  type: AgentType
  status: AgentStatus
  owner: string
  description: string
  avatar?: string
  capabilities: AgentCapability[]
  metrics: AgentMetrics
  a2aEndpoint?: string
  mcpEndpoint?: string
  createdAt: number
  lastSeen: number
}

// ============ Fetchers ============

async function fetchAgents(query?: {
  type?: AgentType
  status?: AgentStatus
  owner?: string
}): Promise<Agent[]> {
  const dwsUrl = getDwsUrl()
  const params = new URLSearchParams()
  if (query?.type) params.set('type', query.type)
  if (query?.status) params.set('status', query.status)
  if (query?.owner) params.set('owner', query.owner)

  const res = await fetch(`${dwsUrl}/api/agents?${params.toString()}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.agents || []
}

async function fetchAgent(agentId: string): Promise<Agent | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/agents/${agentId}`)
  if (!res.ok) return null
  return res.json()
}

async function registerAgent(data: {
  name: string
  type: AgentType
  description: string
  capabilities: AgentCapability[]
  a2aEndpoint?: string
  mcpEndpoint?: string
}): Promise<Agent | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) return null
  return res.json()
}

async function updateAgent(
  agentId: string,
  data: Partial<Agent>,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.ok
}

async function deregisterAgent(agentId: string): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/agents/${agentId}`, {
    method: 'DELETE',
  })
  return res.ok
}

// ============ Hooks ============

export function useAgents(query?: {
  type?: AgentType
  status?: AgentStatus
  owner?: string
}) {
  const {
    data: agents,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['agents', query],
    queryFn: () => fetchAgents(query),
    staleTime: 30000,
    refetchInterval: 60000,
  })

  return {
    agents: agents || [],
    isLoading,
    error,
    refetch,
  }
}

export function useAgent(agentId: string) {
  const {
    data: agent,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => fetchAgent(agentId),
    enabled: !!agentId,
    staleTime: 30000,
  })

  return {
    agent,
    isLoading,
    error,
    refetch,
  }
}

export function useRegisterAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      name: string
      type: AgentType
      description: string
      capabilities: AgentCapability[]
      a2aEndpoint?: string
      mcpEndpoint?: string
    }) => registerAgent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

export function useUpdateAgent(agentId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Partial<Agent>) => updateAgent(agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

export function useDeregisterAgent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (agentId: string) => deregisterAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

// Contract-based agent metrics from ERC-8004 registry
export function useAgentOnChainMetrics(address: string) {
  const publicClient = usePublicClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['agentOnChainMetrics', address],
    queryFn: async () => {
      const contractAddress = getContractAddressSafe('IDENTITY_REGISTRY')
      if (!contractAddress || !publicClient) return null

      // Read from ERC-8004 Identity Registry
      const result = (await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: [
          {
            name: 'agents',
            type: 'function',
            inputs: [{ name: 'agent', type: 'address' }],
            outputs: [
              { name: 'registered', type: 'bool' },
              { name: 'reputation', type: 'uint256' },
              { name: 'tasksCompleted', type: 'uint256' },
              { name: 'a2aEndpoint', type: 'string' },
              { name: 'mcpEndpoint', type: 'string' },
            ],
            stateMutability: 'view',
          },
        ],
        functionName: 'agents',
        args: [address as `0x${string}`],
      })) as [boolean, bigint, bigint, string, string]

      return {
        registered: result[0],
        reputation: Number(result[1]),
        tasksCompleted: Number(result[2]),
        a2aEndpoint: result[3],
        mcpEndpoint: result[4],
      }
    },
    enabled: !!address && !!publicClient,
    staleTime: 60000,
  })

  return {
    metrics: data,
    isLoading,
    error,
  }
}
