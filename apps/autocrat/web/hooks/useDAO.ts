import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import type {
  CreateAgentDraft,
  CreateDAODraft,
  DAOAgent,
  DAODetail,
  DAOListItem,
  DAOStatus,
  GovernanceParams,
  ProposalDetail,
  ProposalListItem,
  ProposalStatus,
  ProposalType,
} from '../types/dao'

const API_BASE = '/api/v1'

interface FetchDAOsParams {
  status?: DAOStatus | 'all'
  search?: string
  networkOnly?: boolean
  limit?: number
  offset?: number
}

async function fetchDAOs(params: FetchDAOsParams = {}): Promise<DAOListItem[]> {
  const endpoint =
    params.status === 'active'
      ? `${API_BASE}/dao/active`
      : `${API_BASE}/dao/list`

  const response = await fetch(endpoint)
  if (!response.ok) {
    throw new Error(`Failed to fetch DAOs: ${response.statusText}`)
  }

  const data = await response.json()
  const daos: DAOListItem[] = data.daos ?? data

  return daos.filter((dao) => {
    if (params.search) {
      const searchLower = params.search.toLowerCase()
      const matchesSearch =
        dao.name.toLowerCase().includes(searchLower) ||
        dao.displayName.toLowerCase().includes(searchLower) ||
        (dao.description?.toLowerCase().includes(searchLower) ?? false)
      if (!matchesSearch) return false
    }
    if (params.networkOnly && !dao.isNetworkDAO) return false
    return true
  })
}

async function fetchDAO(daoId: string): Promise<DAODetail> {
  const response = await fetch(`${API_BASE}/dao/${encodeURIComponent(daoId)}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch DAO: ${response.statusText}`)
  }
  return response.json()
}

async function fetchMyDAOs(address: string): Promise<DAOListItem[]> {
  const response = await fetch(`${API_BASE}/dao/my?address=${address}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch my DAOs: ${response.statusText}`)
  }
  return response.json()
}

export function useDAOs(params: FetchDAOsParams = {}) {
  return useQuery({
    queryKey: ['daos', params],
    queryFn: () => fetchDAOs(params),
    staleTime: 30_000,
  })
}

export function useDAO(daoId: string | undefined) {
  return useQuery({
    queryKey: ['dao', daoId],
    queryFn: () => fetchDAO(daoId as string),
    enabled: !!daoId,
    staleTime: 30_000,
  })
}

export function useMyDAOs() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['myDAOs', address],
    queryFn: () => fetchMyDAOs(address as string),
    enabled: !!address,
    staleTime: 30_000,
  })
}

async function createDAO(draft: CreateDAODraft): Promise<DAODetail> {
  const response = await fetch(`${API_BASE}/dao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message ?? 'Failed to create DAO')
  }
  return response.json()
}

async function updateDAO(
  daoId: string,
  updates: Partial<DAODetail>,
): Promise<DAODetail> {
  const response = await fetch(`${API_BASE}/dao/${daoId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message ?? 'Failed to update DAO')
  }
  return response.json()
}

async function updateGovernanceParams(
  daoId: string,
  params: GovernanceParams,
): Promise<DAODetail> {
  const response = await fetch(`${API_BASE}/dao/${daoId}/governance`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message ?? 'Failed to update governance params')
  }
  return response.json()
}

export function useCreateDAO() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createDAO,
    onSuccess: (newDAO) => {
      queryClient.invalidateQueries({ queryKey: ['daos'] })
      queryClient.invalidateQueries({ queryKey: ['myDAOs'] })
      queryClient.setQueryData(['dao', newDAO.daoId], newDAO)
    },
  })
}

export function useUpdateDAO(daoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (updates: Partial<DAODetail>) => updateDAO(daoId, updates),
    onSuccess: (updatedDAO) => {
      queryClient.setQueryData(['dao', daoId], updatedDAO)
      queryClient.invalidateQueries({ queryKey: ['daos'] })
    },
  })
}

export function useUpdateGovernanceParams(daoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: GovernanceParams) =>
      updateGovernanceParams(daoId, params),
    onSuccess: (updatedDAO) => {
      queryClient.setQueryData(['dao', daoId], updatedDAO)
    },
  })
}

async function fetchAgent(daoId: string, agentId: string): Promise<DAOAgent> {
  const response = await fetch(`${API_BASE}/dao/${daoId}/agents/${agentId}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch agent: ${response.statusText}`)
  }
  return response.json()
}

export function useAgent(
  daoId: string | undefined,
  agentId: string | undefined,
) {
  return useQuery({
    queryKey: ['agent', daoId, agentId],
    queryFn: () => fetchAgent(daoId as string, agentId as string),
    enabled: !!daoId && !!agentId,
    staleTime: 30_000,
  })
}

async function createAgent(
  daoId: string,
  agent: CreateAgentDraft,
): Promise<DAOAgent> {
  const response = await fetch(`${API_BASE}/dao/${daoId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agent),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message ?? 'Failed to create agent')
  }
  return response.json()
}

async function updateAgent(
  daoId: string,
  agentId: string,
  updates: Partial<DAOAgent>,
): Promise<DAOAgent> {
  const response = await fetch(`${API_BASE}/dao/${daoId}/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message ?? 'Failed to update agent')
  }
  return response.json()
}

async function deleteAgent(daoId: string, agentId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/dao/${daoId}/agents/${agentId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message ?? 'Failed to delete agent')
  }
}

export function useCreateAgent(daoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agent: CreateAgentDraft) => createAgent(daoId, agent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dao', daoId] })
    },
  })
}

export function useUpdateAgent(daoId: string, agentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (updates: Partial<DAOAgent>) =>
      updateAgent(daoId, agentId, updates),
    onSuccess: (updatedAgent) => {
      queryClient.setQueryData(['agent', daoId, agentId], updatedAgent)
      queryClient.invalidateQueries({ queryKey: ['dao', daoId] })
    },
  })
}

export function useDeleteAgent(daoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) => deleteAgent(daoId, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dao', daoId] })
    },
  })
}

interface FetchProposalsParams {
  daoId: string
  status?: ProposalStatus | 'all'
  type?: ProposalType | 'all'
  search?: string
  limit?: number
  offset?: number
}

async function fetchProposals(
  params: FetchProposalsParams,
): Promise<ProposalListItem[]> {
  const searchParams = new URLSearchParams()
  if (params.status && params.status !== 'all')
    searchParams.set('status', params.status)
  if (params.type && params.type !== 'all')
    searchParams.set('type', params.type)
  if (params.search) searchParams.set('search', params.search)
  if (params.limit) searchParams.set('limit', params.limit.toString())
  if (params.offset) searchParams.set('offset', params.offset.toString())

  const response = await fetch(
    `${API_BASE}/dao/${params.daoId}/proposals?${searchParams.toString()}`,
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch proposals: ${response.statusText}`)
  }
  return response.json()
}

async function fetchProposal(
  daoId: string,
  proposalId: string,
): Promise<ProposalDetail> {
  const response = await fetch(
    `${API_BASE}/dao/${daoId}/proposals/${proposalId}`,
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch proposal: ${response.statusText}`)
  }
  return response.json()
}

export function useProposals(params: FetchProposalsParams) {
  return useQuery({
    queryKey: ['proposals', params],
    queryFn: () => fetchProposals(params),
    enabled: !!params.daoId,
    staleTime: 30_000,
  })
}

export function useProposal(
  daoId: string | undefined,
  proposalId: string | undefined,
) {
  return useQuery({
    queryKey: ['proposal', daoId, proposalId],
    queryFn: () => fetchProposal(daoId as string, proposalId as string),
    enabled: !!daoId && !!proposalId,
    staleTime: 30_000,
  })
}

interface CreateProposalParams {
  title: string
  summary: string
  description: string
  proposalType: ProposalType
  tags: string[]
  targetContract?: string
  calldata?: string
  value?: string
}

async function createProposal(
  daoId: string,
  proposal: CreateProposalParams,
): Promise<ProposalDetail> {
  const response = await fetch(`${API_BASE}/dao/${daoId}/proposals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(proposal),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message ?? 'Failed to create proposal')
  }
  return response.json()
}

export function useCreateProposal(daoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (proposal: CreateProposalParams) =>
      createProposal(daoId, proposal),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals', { daoId }] })
      queryClient.invalidateQueries({ queryKey: ['dao', daoId] })
    },
  })
}

interface TreasuryData {
  balances: Array<{
    token: string
    symbol: string
    balance: string
    usdValue: string
    change24h: number
  }>
  transactions: Array<{
    id: string
    type: 'inflow' | 'outflow'
    description: string
    amount: string
    token: string
    timestamp: number
    txHash: string
    proposalId?: string
  }>
  totalUsdValue: string
}

export function useTreasury(daoId: string | undefined) {
  return useQuery({
    queryKey: ['treasury', daoId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/dao/${daoId}/treasury`)
      if (!response.ok) {
        throw new Error(`Failed to fetch treasury: ${response.statusText}`)
      }
      return response.json() as Promise<TreasuryData>
    },
    enabled: !!daoId,
    staleTime: 60_000,
  })
}
