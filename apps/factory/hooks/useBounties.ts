'use client';

import { useQuery } from '@tanstack/react-query';
import { useReadContract } from 'wagmi';
import { parseAbi, formatEther } from 'viem';
import type { Address } from 'viem';
import { getDwsUrl, getContractAddressSafe } from '../config/contracts';

// ============ Types ============

export interface BountyReward {
  token: string;
  amount: string;
}

export interface Bounty {
  id: string;
  title: string;
  description: string;
  creator: string;
  rewards: BountyReward[];
  skills: string[];
  deadline: number;
  applicants: number;
  status: 'open' | 'in_progress' | 'review' | 'completed' | 'cancelled';
  milestones: number;
  daoId?: string;
}

export interface BountyStats {
  openBounties: number;
  totalValue: string;
  completed: number;
  avgPayout: string;
}

// ============ Contract ABI ============

const BOUNTY_REGISTRY_ABI = parseAbi([
  'function getBounty(bytes32 bountyId) external view returns (tuple(bytes32 id, address creator, bytes32 daoId, string title, string description, address rewardToken, uint256 rewardAmount, uint256 deadline, uint8 status, uint256 applicantCount, uint256 milestoneCount))',
  'function getAllBounties() external view returns (bytes32[])',
  'function getBountyCount() external view returns (uint256)',
  'function getOpenBounties() external view returns (bytes32[])',
]);

// ============ Fetchers ============

async function fetchBountiesFromAPI(): Promise<Bounty[]> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/bounties`);
  if (!res.ok) return [];
  const data = await res.json();
  
  return (data.bounties || []).map((b: {
    id: string;
    title: string;
    description: string;
    creator: string;
    rewardToken: string;
    rewardAmount: string;
    skills: string[];
    deadline: number;
    applicantCount: number;
    status: number;
    milestoneCount: number;
    daoId?: string;
  }) => ({
    id: b.id,
    title: b.title,
    description: b.description || '',
    creator: b.creator,
    rewards: [{
      token: b.rewardToken === '0x0000000000000000000000000000000000000000' ? 'ETH' : b.rewardToken,
      amount: formatEther(BigInt(b.rewardAmount || '0')),
    }],
    skills: b.skills || [],
    deadline: b.deadline,
    applicants: b.applicantCount || 0,
    status: mapBountyStatus(b.status),
    milestones: b.milestoneCount || 1,
    daoId: b.daoId,
  }));
}

async function fetchBountyStats(): Promise<BountyStats> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/bounties/stats`);
  if (!res.ok) {
    return { openBounties: 0, totalValue: '0 ETH', completed: 0, avgPayout: '0 ETH' };
  }
  return res.json();
}

function mapBountyStatus(status: number): Bounty['status'] {
  const statusMap: Record<number, Bounty['status']> = {
    0: 'open',
    1: 'in_progress',
    2: 'review',
    3: 'completed',
    4: 'cancelled',
  };
  return statusMap[status] || 'open';
}

// ============ Hooks ============

export function useBounties(filter?: {
  status?: Bounty['status'];
  creator?: Address;
  daoId?: string;
}) {
  const bountyRegistryAddress = getContractAddressSafe('bountyRegistry');

  // Try to fetch from contract first
  const { data: bountyIds } = useReadContract({
    address: bountyRegistryAddress || undefined,
    abi: BOUNTY_REGISTRY_ABI,
    functionName: 'getAllBounties',
    query: { enabled: !!bountyRegistryAddress },
  });

  // Fallback to API
  const { data: apiBounties, isLoading, error, refetch } = useQuery({
    queryKey: ['bounties', filter],
    queryFn: fetchBountiesFromAPI,
    staleTime: 30000,
  });

  // Apply filters
  let bounties = apiBounties || [];
  if (filter?.status && filter.status !== 'open') {
    bounties = bounties.filter(b => b.status === filter.status);
  }
  if (filter?.creator) {
    bounties = bounties.filter(b => b.creator.toLowerCase() === filter.creator?.toLowerCase());
  }
  if (filter?.daoId) {
    bounties = bounties.filter(b => b.daoId === filter.daoId);
  }

  return {
    bounties,
    bountyIds: bountyIds as string[] | undefined,
    isLoading,
    error,
    refetch,
  };
}

export function useBountyStats() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['bountyStats'],
    queryFn: fetchBountyStats,
    staleTime: 60000,
  });

  return {
    stats: stats || {
      openBounties: 0,
      totalValue: '0 ETH',
      completed: 0,
      avgPayout: '0 ETH',
    },
    isLoading,
    error,
  };
}

export function useBounty(bountyId: string) {
  const bountyRegistryAddress = getContractAddressSafe('daoRegistry');

  const { data: bountyData, isLoading: contractLoading } = useReadContract({
    address: bountyRegistryAddress || undefined,
    abi: BOUNTY_REGISTRY_ABI,
    functionName: 'getBounty',
    args: [bountyId as `0x${string}`],
    query: { enabled: !!bountyRegistryAddress && !!bountyId },
  });

  // Fallback to API for single bounty
  const { data: apiBounty, isLoading: apiLoading } = useQuery({
    queryKey: ['bounty', bountyId],
    queryFn: async () => {
      const dwsUrl = getDwsUrl();
      const res = await fetch(`${dwsUrl}/api/bounties/${bountyId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !bountyData && !!bountyId,
    staleTime: 30000,
  });

  return {
    bounty: bountyData || apiBounty,
    isLoading: contractLoading || apiLoading,
  };
}

