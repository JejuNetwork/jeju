import { useOAuth3 } from '@jejunetwork/auth/react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback } from 'react'
import { API_URL } from '../config'

interface Agent {
  agentId: string
  owner: string
  name: string
  description?: string
  botType: 'ai_agent' | 'trading_bot' | 'org_tool'
  characterCid?: string
  stateCid: string
  vaultAddress: string
  vaultBalance?: string
  active: boolean
  registeredAt: number
  lastExecutedAt: number
  executionCount: number
  tickIntervalMs?: number
  capabilities?: {
    canChat?: boolean
    canTrade?: boolean
    canVote?: boolean
    canPropose?: boolean
    canStake?: boolean
    a2a?: boolean
    compute?: boolean
  }
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

interface ExecuteAgentRequest {
  agentId: string
  input?: {
    message?: string
    roomId?: string
    userId?: string
  }
}

interface ExecuteAgentResponse {
  executionId: string
  status: string
  output?: { response?: string }
}

interface FundVaultRequest {
  agentId: string
  amount: string
}

interface FundVaultResponse {
  txHash: string
}

const PAGE_SIZE = 20

/**
 * Hook to build auth headers for API calls
 */
function useAuthHeaders() {
  const { session, isAuthenticated, smartAccountAddress } = useOAuth3()

  const getHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (isAuthenticated && smartAccountAddress) {
      headers['X-Jeju-Address'] = smartAccountAddress
      if (session?.sessionId) {
        headers.Authorization = `Bearer ${session.sessionId}`
      }
    }

    return headers
  }, [isAuthenticated, smartAccountAddress, session])

  return { getHeaders, isAuthenticated }
}

export function useAgents(filters?: {
  name?: string
  owner?: string
  active?: boolean
  limit?: number
}) {
  const limit = filters?.limit ?? PAGE_SIZE

  return useInfiniteQuery({
    queryKey: ['agents', filters],
    queryFn: async ({ pageParam = 0 }): Promise<AgentsSearchResponse> => {
      const params = new URLSearchParams()
      if (filters?.name) params.set('name', filters.name)
      if (filters?.owner) params.set('owner', filters.owner)
      if (filters?.active !== undefined)
        params.set('active', String(filters.active))
      params.set('limit', String(limit))
      params.set('offset', String(pageParam))

      const response = await fetch(
        `${API_URL}/api/v1/search/agents?${params.toString()}`,
      )
      if (!response.ok) throw new Error('Failed to fetch agents')
      return response.json()
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined
      return allPages.length * limit
    },
    initialPageParam: 0,
    select: (data) => ({
      agents: data.pages.flatMap((page) => page.agents),
      total: data.pages[0]?.total ?? 0,
      hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
    }),
  })
}

/**
 * Get agents owned by the current user
 */
export function useMyAgents() {
  const { smartAccountAddress, isAuthenticated } = useOAuth3()

  return useAgents({
    owner:
      isAuthenticated && smartAccountAddress ? smartAccountAddress : undefined,
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
  const { getHeaders, isAuthenticated } = useAuthHeaders()

  return useMutation({
    mutationFn: async (
      request: RegisterAgentRequest,
    ): Promise<RegisterAgentResponse> => {
      if (!isAuthenticated) {
        throw new Error('Please connect your wallet to deploy an agent')
      }

      const response = await fetch(`${API_URL}/api/v1/agents`, {
        method: 'POST',
        headers: getHeaders(),
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

export function useExecuteAgent() {
  const queryClient = useQueryClient()
  const { getHeaders, isAuthenticated } = useAuthHeaders()

  return useMutation({
    mutationFn: async (
      request: ExecuteAgentRequest,
    ): Promise<ExecuteAgentResponse> => {
      if (!isAuthenticated) {
        throw new Error('Please connect your wallet to execute agents')
      }

      const response = await fetch(`${API_URL}/api/v1/execute`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          agentId: request.agentId,
          input: request.input ?? {},
        }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Execution failed')
      }
      const data = await response.json()
      return data.result
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent', variables.agentId] })
    },
  })
}

export function useFundVault() {
  const queryClient = useQueryClient()
  const { getHeaders, isAuthenticated } = useAuthHeaders()

  return useMutation({
    mutationFn: async (
      request: FundVaultRequest,
    ): Promise<FundVaultResponse> => {
      if (!isAuthenticated) {
        throw new Error('Please connect your wallet to fund an agent')
      }

      const response = await fetch(
        `${API_URL}/api/v1/agents/${request.agentId}/fund`,
        {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ amount: request.amount }),
        },
      )
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to fund vault')
      }
      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['agent-balance', variables.agentId],
      })
    },
  })
}

export type { Agent, RegisterAgentRequest, RegisterAgentResponse }
