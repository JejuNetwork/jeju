import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { parseAbi } from 'viem'
import { useReadContract } from 'wagmi'
import { getContractAddressSafe } from '../config/contracts'
import { api, extractDataSafe } from '../lib/client'

export interface BountyReward {
  token: string
  amount: string
}

export interface Bounty {
  id: string
  title: string
  description: string
  creator: string
  rewards: BountyReward[]
  skills: string[]
  deadline: number
  applicants: number
  status: 'open' | 'in_progress' | 'review' | 'completed' | 'cancelled'
  milestones: number
  daoId?: string
}

export interface BountyStats {
  openBounties: number
  totalValue: string
  completed: number
  avgPayout: string
}

const BOUNTY_REGISTRY_ABI = parseAbi([
  'function getBounty(bytes32 bountyId) external view returns (tuple(bytes32 id, address creator, bytes32 daoId, string title, string description, address rewardToken, uint256 rewardAmount, uint256 deadline, uint8 status, uint256 applicantCount, uint256 milestoneCount))',
  'function getAllBounties() external view returns (bytes32[])',
  'function getBountyCount() external view returns (uint256)',
  'function getOpenBounties() external view returns (bytes32[])',
])

// API response types
interface ApiBounty {
  id: string
  title: string
  description: string
  reward: string
  currency: string
  status: 'open' | 'in_progress' | 'review' | 'completed' | 'cancelled'
  skills: string[]
  creator: string
  deadline: number
  milestones?: Array<{
    name: string
    description: string
    reward: string
    currency: string
    deadline: number
  }>
  submissions: number
  createdAt: number
  updatedAt: number
}

interface BountiesResponse {
  bounties: ApiBounty[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

function transformBounty(b: ApiBounty): Bounty {
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    creator: b.creator,
    rewards: [
      {
        token: b.currency || 'ETH',
        amount: b.reward,
      },
    ],
    skills: b.skills || [],
    deadline: b.deadline,
    applicants: b.submissions || 0,
    status: b.status,
    milestones: b.milestones?.length || 1,
  }
}

async function fetchBounties(filter?: {
  status?: Bounty['status']
  creator?: Address
  daoId?: string
}): Promise<Bounty[]> {
  const response = await api.api.bounties.get({
    query: {
      status: filter?.status,
    },
  })

  const data = extractDataSafe(response) as BountiesResponse | null
  if (!data?.bounties) return []

  let bounties = data.bounties.map(transformBounty)

  // Apply client-side filters for fields not in API
  if (filter?.creator) {
    bounties = bounties.filter(
      (b) => b.creator.toLowerCase() === filter.creator?.toLowerCase(),
    )
  }
  if (filter?.daoId) {
    bounties = bounties.filter((b) => b.daoId === filter.daoId)
  }

  return bounties
}

async function fetchBountyStats(): Promise<BountyStats> {
  // Stats endpoint - calculate from bounties list if no dedicated endpoint
  const response = await api.api.bounties.get({})
  const data = extractDataSafe(response) as BountiesResponse | null

  if (!data?.bounties) {
    return {
      openBounties: 0,
      totalValue: '0 ETH',
      completed: 0,
      avgPayout: '0 ETH',
    }
  }

  const bounties = data.bounties
  const openBounties = bounties.filter((b) => b.status === 'open').length
  const completed = bounties.filter((b) => b.status === 'completed').length
  const totalValue = bounties.reduce(
    (sum, b) => sum + Number.parseFloat(b.reward || '0'),
    0,
  )
  const avgPayout = completed > 0 ? totalValue / completed : 0

  return {
    openBounties,
    totalValue: `${totalValue.toFixed(2)} ETH`,
    completed,
    avgPayout: `${avgPayout.toFixed(2)} ETH`,
  }
}

export function useBounties(filter?: {
  status?: Bounty['status']
  creator?: Address
  daoId?: string
}) {
  const bountyRegistryAddress = getContractAddressSafe('bountyRegistry')

  // Try to fetch from contract first
  const { data: bountyIds } = useReadContract({
    address: bountyRegistryAddress || undefined,
    abi: BOUNTY_REGISTRY_ABI,
    functionName: 'getAllBounties',
    query: { enabled: !!bountyRegistryAddress },
  })

  // Fallback to API
  const {
    data: apiBounties,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['bounties', filter],
    queryFn: () => fetchBounties(filter),
    staleTime: 30000,
  })

  return {
    bounties: apiBounties || [],
    bountyIds: bountyIds as string[] | undefined,
    isLoading,
    error,
    refetch,
  }
}

export function useBountyStats() {
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['bountyStats'],
    queryFn: fetchBountyStats,
    staleTime: 60000,
  })

  return {
    stats: stats || {
      openBounties: 0,
      totalValue: '0 ETH',
      completed: 0,
      avgPayout: '0 ETH',
    },
    isLoading,
    error,
  }
}

export function useBounty(bountyId: string) {
  const bountyRegistryAddress = getContractAddressSafe('daoRegistry')

  const { data: bountyData, isLoading: contractLoading } = useReadContract({
    address: bountyRegistryAddress || undefined,
    abi: BOUNTY_REGISTRY_ABI,
    functionName: 'getBounty',
    args: [bountyId as `0x${string}`],
    query: { enabled: !!bountyRegistryAddress && !!bountyId },
  })

  // Fallback to API for single bounty
  const { data: apiBounty, isLoading: apiLoading } = useQuery({
    queryKey: ['bounty', bountyId],
    queryFn: async () => {
      const response = await api.api.bounties({ id: bountyId }).get()
      const data = extractDataSafe(response)
      if (!data) return null
      return transformBounty(data as ApiBounty)
    },
    enabled: !bountyData && !!bountyId,
    staleTime: 30000,
  })

  return {
    bounty: bountyData || apiBounty,
    isLoading: contractLoading || apiLoading,
  }
}
