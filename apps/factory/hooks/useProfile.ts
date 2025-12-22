import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { api, extractDataSafe } from '../lib/client'
import {
  useContributorByWallet,
  useRepositoryClaims,
  useSocialLinks,
} from './useContributor'

export interface ProfileStats {
  repositories: number
  bounties: number
  contributions: number
  stars: number
  followers: number
  following: number
}

export interface ReputationData {
  score: number
  tier: 'bronze' | 'silver' | 'gold' | 'diamond'
  badges: string[]
}

export interface ProfileData {
  address: string
  name: string
  type: 'user' | 'org'
  avatar: string
  bio: string
  location?: string
  website?: string
  twitter?: string
  farcaster?: string
  github?: string
  discord?: string
  joinedAt: number
  stats: ProfileStats
  reputation: ReputationData
  skills: string[]
  isGuardian: boolean
  isContributor: boolean
  contributorId?: string
}

export interface ProfileBounty {
  id: string
  title: string
  status: 'open' | 'in_progress' | 'review' | 'completed'
  reward: string
  completedAt?: number
}

export interface ProfileRepo {
  name: string
  fullName: string
  description: string
  language: string
  stars: number
  forks: number
  updatedAt: number
}

const API_BASE =
  typeof window !== 'undefined'
    ? ''
    : process.env.FACTORY_API_URL || getCoreAppUrl('FACTORY')

async function fetchApi<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) return null
  return response.json()
}

async function fetchLeaderboardData(
  address: string,
): Promise<{ score: number; rank: number; contributions: number }> {
  const data = await fetchApi<{
    address: string
    score: number
    rank: number
    contributions: number
  }>(`/api/leaderboard/user/${address}`)
  return data
    ? { score: data.score, rank: data.rank, contributions: data.contributions }
    : { score: 0, rank: 0, contributions: 0 }
}

async function fetchUserBounties(address: string): Promise<ProfileBounty[]> {
  const response = await api.api.bounties.get({ query: { creator: address } })
  interface BountiesResponse {
    bounties: Array<{
      id: string
      title: string
      status: string
      reward: string
      currency: string
    }>
  }
  const data = extractDataSafe(response) as BountiesResponse | null
  if (!data?.bounties) return []
  return data.bounties.map((b) => ({
    id: b.id,
    title: b.title,
    status: b.status as ProfileBounty['status'],
    reward: `${b.reward} ${b.currency}`,
  }))
}

async function fetchUserRepos(owner: string): Promise<ProfileRepo[]> {
  const response = await api.api.git.get({ query: { owner } })
  interface ApiRepo {
    name: string
    owner?: string
    description?: string
    stars: number
    forks: number
    updatedAt: number
  }
  const data = extractDataSafe(response)
  if (!data || !Array.isArray(data)) return []
  return (data as ApiRepo[]).map((r) => ({
    name: r.name,
    fullName: r.owner ? `${r.owner}/${r.name}` : r.name,
    description: r.description || '',
    language: 'TypeScript',
    stars: r.stars || 0,
    forks: r.forks || 0,
    updatedAt: r.updatedAt || Date.now(),
  }))
}

async function fetchGuardianStatus(address: string): Promise<boolean> {
  const data = await fetchApi<{ isGuardian: boolean }>(
    `/api/leaderboard/user/${address}`,
  )
  return data?.isGuardian ?? false
}

export function useProfile(address: Address) {
  const { profile: contributorProfile, isLoading: contributorLoading } =
    useContributorByWallet(address)
  const { links: socialLinks } = useSocialLinks(
    contributorProfile?.contributorId,
  )
  const { claims: repoClaims } = useRepositoryClaims(
    contributorProfile?.contributorId,
  )

  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery({
    queryKey: ['leaderboard', address],
    queryFn: () => fetchLeaderboardData(address),
    staleTime: 60000,
  })

  const { data: bounties, isLoading: bountiesLoading } = useQuery({
    queryKey: ['userBounties', address],
    queryFn: () => fetchUserBounties(address),
    staleTime: 30000,
  })

  const githubLink = socialLinks.find((l) => l.platform === 'github')
  const githubUsername = githubLink?.handle || ''

  const { data: repos, isLoading: reposLoading } = useQuery({
    queryKey: ['userRepos', githubUsername],
    queryFn: () => fetchUserRepos(githubUsername),
    enabled: !!githubUsername,
    staleTime: 60000,
  })

  const { data: isGuardian } = useQuery({
    queryKey: ['guardianStatus', address],
    queryFn: () => fetchGuardianStatus(address),
    staleTime: 120000,
  })

  const computeTier = (
    score: number,
  ): 'bronze' | 'silver' | 'gold' | 'diamond' => {
    if (score >= 10000) return 'diamond'
    if (score >= 5000) return 'gold'
    if (score >= 1000) return 'silver'
    return 'bronze'
  }

  const profile: ProfileData | null = address
    ? {
        address: address,
        name: githubUsername || `${address.slice(0, 6)}...${address.slice(-4)}`,
        type: 'user',
        avatar: githubUsername
          ? `https://avatars.githubusercontent.com/${githubUsername}`
          : `https://api.dicebear.com/7.x/identicon/svg?seed=${address}`,
        bio: '',
        location: undefined,
        website: undefined,
        twitter: socialLinks.find((l) => l.platform === 'twitter')?.handle,
        farcaster: socialLinks.find((l) => l.platform === 'farcaster')?.handle,
        github: githubUsername,
        discord: socialLinks.find((l) => l.platform === 'discord')?.handle,
        joinedAt: contributorProfile?.registeredAt
          ? contributorProfile.registeredAt * 1000
          : Date.now(),
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
      }
    : null

  return {
    profile,
    bounties: bounties || [],
    repos: repos || [],
    socialLinks,
    isLoading:
      contributorLoading ||
      leaderboardLoading ||
      bountiesLoading ||
      reposLoading,
  }
}
