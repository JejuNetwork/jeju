import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { getContractAddressSafe } from '../config/contracts'
import { api, extractDataSafe } from '../lib/client'

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

interface ApiAgent {
  agentId: string
  owner: string
  name: string
  botType: string
  characterCid: string | null
  stateCid: string
  vaultAddress: string
  active: boolean
  registeredAt: number
  lastExecutedAt: number
  executionCount: number
  capabilities: string[]
  specializations: string[]
  reputation: number
}

const API_BASE =
  typeof window !== 'undefined'
    ? ''
    : process.env.FACTORY_API_URL || getCoreAppUrl('FACTORY')

async function fetchApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) return null
  return response.json()
}

function transformAgent(apiAgent: ApiAgent): Agent {
  return {
    id: apiAgent.agentId,
    name: apiAgent.name,
    address: apiAgent.vaultAddress,
    type: (apiAgent.botType as AgentType) || 'compute',
    status: apiAgent.active ? 'active' : 'offline',
    owner: apiAgent.owner,
    description: apiAgent.specializations.join(', ') || '',
    capabilities: apiAgent.capabilities.map((c) => ({
      name: c,
      version: '1.0.0',
    })),
    metrics: {
      tasksCompleted: apiAgent.executionCount,
      successRate: 0.95,
      avgResponseTime: 100,
      reputation: apiAgent.reputation,
      uptime: 99.9,
    },
    createdAt: apiAgent.registeredAt,
    lastSeen: apiAgent.lastExecutedAt || apiAgent.registeredAt,
  }
}

async function fetchAgents(query?: {
  type?: AgentType
  status?: AgentStatus
  owner?: string
}): Promise<Agent[]> {
  const response = await api.api.agents.get({
    query: { q: query?.type, status: query?.status },
  })
  const data = extractDataSafe(response)
  if (!data || !Array.isArray(data)) return []
  return (data as ApiAgent[]).map(transformAgent)
}

async function fetchAgent(agentId: string): Promise<Agent | null> {
  const data = await fetchApi<ApiAgent>(`/api/agents/${agentId}`)
  if (!data) return null
  return transformAgent(data)
}

async function registerAgent(data: {
  name: string
  type: AgentType
  description: string
  capabilities: AgentCapability[]
  a2aEndpoint?: string
  mcpEndpoint?: string
}): Promise<Agent | null> {
  const response = await api.api.agents.post({
    name: data.name,
    type: data.type,
    description: data.description,
    capabilities: data.capabilities.map((c) => c.name),
    a2aEndpoint: data.a2aEndpoint,
    mcpEndpoint: data.mcpEndpoint,
  })
  const result = extractDataSafe(response)
  if (!result) return null
  return transformAgent(result as ApiAgent)
}

async function updateAgent(
  agentId: string,
  data: Partial<Agent>,
): Promise<boolean> {
  const response = await fetchApi(`/api/agents/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return response !== null
}

async function deregisterAgent(agentId: string): Promise<boolean> {
  const response = await fetchApi(`/api/agents/${agentId}`, {
    method: 'DELETE',
  })
  return response !== null
}

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
  return { agents: agents || [], isLoading, error, refetch }
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
  return { agent, isLoading, error, refetch }
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

export function useAgentOnChainMetrics(address: string) {
  const publicClient = usePublicClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['agentOnChainMetrics', address],
    queryFn: async () => {
      const contractAddress = getContractAddressSafe('IDENTITY_REGISTRY')
      if (!contractAddress || !publicClient) return null
      const result = (await publicClient.readContract({
        address: contractAddress as `0x\${string}`,
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
        args: [address as `0x\${string}`],
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
  return { metrics: data, isLoading, error }
}
