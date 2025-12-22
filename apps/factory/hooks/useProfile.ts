'use client';

import { useQuery } from '@tanstack/react-query';
import { useContributorByWallet, useSocialLinks, useRepositoryClaims } from './useContributor';
import { getDwsUrl } from '../config/contracts';
import type { Address } from 'viem';

// ============ Types ============

export interface ProfileStats {
  repositories: number;
  bounties: number;
  contributions: number;
  stars: number;
  followers: number;
  following: number;
}

export interface ReputationData {
  score: number;
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  badges: string[];
}

export interface ProfileData {
  address: string;
  name: string;
  type: 'user' | 'org';
  avatar: string;
  bio: string;
  location?: string;
  website?: string;
  twitter?: string;
  farcaster?: string;
  github?: string;
  discord?: string;
  joinedAt: number;
  stats: ProfileStats;
  reputation: ReputationData;
  skills: string[];
  isGuardian: boolean;
  isContributor: boolean;
  contributorId?: string;
}

export interface ProfileBounty {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'review' | 'completed';
  reward: string;
  completedAt?: number;
}

export interface ProfileRepo {
  name: string;
  fullName: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  updatedAt: number;
}

// ============ API Fetchers ============

async function fetchLeaderboardData(address: string): Promise<{ score: number; rank: number; contributions: number }> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/leaderboard/user/${address}`);
  if (!res.ok) {
    return { score: 0, rank: 0, contributions: 0 };
  }
  return res.json();
}

async function fetchUserBounties(address: string): Promise<ProfileBounty[]> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/bounties?worker=${address}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.bounties || []).map((b: { id: string; title: string; status: string; rewardAmount: string; rewardToken: string; completedAt?: number }) => ({
    id: b.id,
    title: b.title,
    status: b.status,
    reward: `${b.rewardAmount} ${b.rewardToken}`,
    completedAt: b.completedAt,
  }));
}

async function fetchUserRepos(owner: string): Promise<ProfileRepo[]> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/git/repos?owner=${owner}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.repositories || []).map((r: { name: string; owner: string; description: string; language: string; stars: number; forks: number; updatedAt: number }) => ({
    name: r.name,
    fullName: `${r.owner}/${r.name}`,
    description: r.description || '',
    language: r.language || 'Unknown',
    stars: r.stars || 0,
    forks: r.forks || 0,
    updatedAt: r.updatedAt || Date.now(),
  }));
}

async function fetchGuardianStatus(address: string): Promise<boolean> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/guardians/${address}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.isGuardian || false;
}

// ============ Hook ============

export function useProfile(address: Address) {
  // Get contributor data from contract
  const { profile: contributorProfile, isLoading: contributorLoading } = useContributorByWallet(address);
  const { links: socialLinks } = useSocialLinks(contributorProfile?.contributorId);
  const { claims: repoClaims } = useRepositoryClaims(contributorProfile?.contributorId);

  // Fetch additional data from DWS API
  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery({
    queryKey: ['leaderboard', address],
    queryFn: () => fetchLeaderboardData(address),
    staleTime: 60000,
  });

  const { data: bounties, isLoading: bountiesLoading } = useQuery({
    queryKey: ['userBounties', address],
    queryFn: () => fetchUserBounties(address),
    staleTime: 30000,
  });

  // Try to get github username from social links
  const githubLink = socialLinks.find(l => l.platform === 'github');
  const githubUsername = githubLink?.handle || '';

  const { data: repos, isLoading: reposLoading } = useQuery({
    queryKey: ['userRepos', githubUsername],
    queryFn: () => fetchUserRepos(githubUsername),
    enabled: !!githubUsername,
    staleTime: 60000,
  });

  const { data: isGuardian } = useQuery({
    queryKey: ['guardianStatus', address],
    queryFn: () => fetchGuardianStatus(address),
    staleTime: 120000,
  });

  // Compute tier from score
  const computeTier = (score: number): 'bronze' | 'silver' | 'gold' | 'diamond' => {
    if (score >= 10000) return 'diamond';
    if (score >= 5000) return 'gold';
    if (score >= 1000) return 'silver';
    return 'bronze';
  };

  // Build profile object
  const profile: ProfileData | null = address ? {
    address: address,
    name: githubUsername || `${address.slice(0, 6)}...${address.slice(-4)}`,
    type: 'user',
    avatar: githubUsername 
      ? `https://avatars.githubusercontent.com/${githubUsername}` 
      : `https://api.dicebear.com/7.x/identicon/svg?seed=${address}`,
    bio: '',
    location: undefined,
    website: undefined,
    twitter: socialLinks.find(l => l.platform === 'twitter')?.handle,
    farcaster: socialLinks.find(l => l.platform === 'farcaster')?.handle,
    github: githubUsername,
    discord: socialLinks.find(l => l.platform === 'discord')?.handle,
    joinedAt: contributorProfile?.registeredAt ? contributorProfile.registeredAt * 1000 : Date.now(),
    stats: {
      repositories: repos?.length || repoClaims.length || 0,
      bounties: bounties?.length || 0,
      contributions: leaderboardData?.contributions || 0,
      stars: repos?.reduce((acc, r) => acc + r.stars, 0) || 0,
      followers: 0,
      following: 0,
    },
    reputation: {
      score: leaderboardData?.score || 0,
      tier: computeTier(leaderboardData?.score || 0),
      badges: isGuardian ? ['Guardian'] : [],
    },
    skills: [],
    isGuardian: isGuardian || false,
    isContributor: !!contributorProfile,
    contributorId: contributorProfile?.contributorId,
  } : null;

  return {
    profile,
    bounties: bounties || [],
    repos: repos || [],
    socialLinks,
    isLoading: contributorLoading || leaderboardLoading || bountiesLoading || reposLoading,
  };
}

