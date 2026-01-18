import { hasArrayProperty, isPlainObject } from '@jejunetwork/types'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useReadContract } from 'wagmi'
import { z } from 'zod'
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

const bountyRegistryAbi = [
  {
    type: 'function',
    name: 'getBounty',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'creator', type: 'address' },
          { name: 'daoId', type: 'bytes32' },
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'rewardToken', type: 'address' },
          { name: 'rewardAmount', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'applicantCount', type: 'uint256' },
          { name: 'milestoneCount', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllBounties',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBountyCount',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOpenBounties',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

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

function isBountiesResponse(data: unknown): data is BountiesResponse {
  return hasArrayProperty(data, 'bounties')
}

// Zod schema for ApiBounty validation
const ApiBountySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  reward: z.string(),
  currency: z.string(),
  status: z.enum(['open', 'in_progress', 'review', 'completed', 'cancelled']),
  skills: z.array(z.string()),
  creator: z.string(),
  deadline: z.number(),
  milestones: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        reward: z.string(),
        currency: z.string(),
        deadline: z.number(),
      }),
    )
    .optional(),
  submissions: z.number().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

function isApiBounty(data: unknown): data is ApiBounty {
  return ApiBountySchema.safeParse(data).success
}

function transformBounty(b: ApiBounty): Bounty {
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    creator: b.creator,
    rewards: [
      {
        token: b.currency ?? 'ETH',
        amount: b.reward,
      },
    ],
    skills: b.skills ?? [],
    deadline: b.deadline,
    applicants: b.submissions ?? 0,
    status: b.status,
    milestones: b.milestones?.length ?? 1,
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

  const data = extractDataSafe(response)
  if (!isBountiesResponse(data)) return []

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
  const response = await api.api.bounties.stats.get()
  const data = extractDataSafe(response)

  if (!data || typeof data !== 'object') {
    return {
      openBounties: 0,
      totalValue: '0 ETH',
      completed: 0,
      avgPayout: '0 ETH',
    }
  }

  const statsData = data as {
    openBounties?: number
    totalValue?: string
    completed?: number
    avgPayout?: string
  }

  return {
    openBounties: statsData.openBounties ?? 0,
    totalValue: statsData.totalValue ?? '0 ETH',
    completed: statsData.completed ?? 0,
    avgPayout: statsData.avgPayout ?? '0 ETH',
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
    abi: bountyRegistryAbi,
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
    bounties: apiBounties ?? [],
    bountyIds,
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

export function useBounty(bountyId: string): {
  bounty: Bounty | null
  isLoading: boolean
} {
  const bountyRegistryAddress = getContractAddressSafe('daoRegistry')

  const { data: contractData, isLoading: contractLoading } = useReadContract({
    address: bountyRegistryAddress || undefined,
    abi: bountyRegistryAbi,
    functionName: 'getBounty',
    args: bountyId.startsWith('0x') ? [bountyId as `0x${string}`] : undefined,
    query: { enabled: !!bountyRegistryAddress && !!bountyId },
  })

  // Transform contract data to Bounty type
  const bountyData: Bounty | null = contractData
    ? {
        id: contractData.id,
        title: contractData.title,
        description: contractData.description,
        creator: contractData.creator,
        rewards: [
          {
            token: 'ETH', // Contract uses rewardToken address
            amount: String(contractData.rewardAmount),
          },
        ],
        skills: [],
        deadline: Number(contractData.deadline),
        applicants: Number(contractData.applicantCount),
        status: ['open', 'in_progress', 'review', 'completed', 'cancelled'][
          contractData.status
        ] as Bounty['status'],
        milestones: Number(contractData.milestoneCount),
        daoId: contractData.daoId,
      }
    : null

  const { data: apiBounty, isLoading: apiLoading } = useQuery({
    queryKey: ['bounty', bountyId],
    queryFn: async (): Promise<Bounty | null> => {
      const response = await api.api.bounties({ id: bountyId }).get()
      const data = extractDataSafe(response)
      if (!isPlainObject(data)) return null
      if ('error' in data) return null
      if (!isApiBounty(data)) return null
      return transformBounty(data)
    },
    enabled: !bountyData && !!bountyId,
    staleTime: 30000,
  })

  return {
    bounty: bountyData ?? apiBounty ?? null,
    isLoading: contractLoading || apiLoading,
  }
}
