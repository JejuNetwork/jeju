import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { API_BASE, apiDelete, apiFetch, apiPost, getHeaders } from '../lib/api'

export interface FarcasterUser {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  bio: string
  followerCount: number
  followingCount: number
  verifiedAddresses: string[]
}

export interface Cast {
  hash: string
  threadHash: string
  author: FarcasterUser
  text: string
  timestamp: number
  embeds: Array<{ url?: string }>
  reactions: {
    likes: number
    recasts: number
    viewerLiked: boolean
    viewerRecasted: boolean
  }
  replies: number
  channel: { id: string; name?: string; imageUrl?: string } | null
  parentHash: string | null
  parentFid: number | null
}

export interface FeedResponse {
  casts: Cast[]
  cursor?: string
}

export interface FarcasterStatus {
  connected: boolean
  fid: number | null
  username: string | null
  displayName: string | null
  pfpUrl: string | null
  signer: { hasSigner: boolean; isActive: boolean; publicKey: string | null }
}

export interface OnboardingStatus {
  completed: boolean
  steps: {
    linkFid: {
      complete: boolean
      data: { fid: number; username: string; displayName: string } | null
    }
    createSigner: { complete: boolean; data: { publicKey: string } | null }
    activateSigner: { complete: boolean }
  }
  user: {
    fid: number
    username: string
    displayName: string
    pfpUrl: string
  } | null
}

export interface LookupFidResult {
  found: boolean
  fid: number | null
  user: {
    fid: number
    username: string
    displayName: string
    pfpUrl: string
    bio: string
  } | null
}

export interface QuickConnectResult {
  success: boolean
  user: { fid: number; username: string; displayName: string; pfpUrl: string }
  signer: { publicKey: string; state: string }
  registrationRequired: boolean
  registration: {
    message: string
    deadline: number
    signerPublicKey: string
  } | null
}

export function useFarcasterStatus() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['farcaster', 'status', address],
    queryFn: async (): Promise<FarcasterStatus> => {
      if (!address) {
        return {
          connected: false,
          fid: null,
          username: null,
          displayName: null,
          pfpUrl: null,
          signer: { hasSigner: false, isActive: false, publicKey: null },
        }
      }
      return apiFetch('/api/farcaster/status', { address })
    },
    enabled: !!address,
    staleTime: 30_000,
  })
}

export function useOnboardingStatus() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['farcaster', 'onboarding', address],
    queryFn: () =>
      apiFetch<OnboardingStatus>('/api/farcaster/onboarding', { address }),
    enabled: !!address,
    staleTime: 30_000,
  })
}

export function useLookupFid(lookupAddress?: string) {
  return useQuery<LookupFidResult>({
    queryKey: ['farcaster', 'lookup', lookupAddress],
    queryFn: () =>
      apiFetch<LookupFidResult>(`/api/farcaster/lookup/${lookupAddress}`),
    enabled: !!lookupAddress,
    staleTime: 60_000,
  })
}

export function useLinkFid() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fid: number) =>
      apiPost('/api/farcaster/link', { fid }, address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'status'] })
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'onboarding'] })
    },
  })
}

export function useCreateSigner() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fid: number) =>
      apiPost('/api/farcaster/signer', { fid }, address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'status'] })
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'onboarding'] })
    },
  })
}

export function useActivateSigner() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { signerPublicKey: string; signature: string }) =>
      apiPost('/api/farcaster/signer/activate', params, address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'status'] })
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'onboarding'] })
    },
  })
}

export function useQuickConnect() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation<QuickConnectResult, Error, number>({
    mutationFn: (fid: number) =>
      apiPost<QuickConnectResult>('/api/farcaster/connect', { fid }, address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'status'] })
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'onboarding'] })
    },
  })
}

export function useFeed(options?: {
  channel?: string
  feedType?: 'channel' | 'trending' | 'user'
  fid?: number
}) {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['feed', options?.channel, options?.feedType, options?.fid],
    queryFn: async (): Promise<FeedResponse> => {
      const params = new URLSearchParams()
      if (options?.channel) params.set('channel', options.channel)
      if (options?.feedType) params.set('feedType', options.feedType)
      if (options?.fid) params.set('fid', String(options.fid))

      const response = await fetch(`${API_BASE}/api/feed?${params}`, {
        headers: getHeaders(address),
      })
      return response.json()
    },
    staleTime: 30_000,
  })
}

export function useChannelFeed(channelId: string) {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['feed', 'channel', channelId],
    queryFn: () =>
      apiFetch<FeedResponse>(`/api/feed/channel/${channelId}`, { address }),
    enabled: !!channelId,
    staleTime: 30_000,
  })
}

export function useUserFeed(fid: number) {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['feed', 'user', fid],
    queryFn: () => apiFetch<FeedResponse>(`/api/feed/user/${fid}`, { address }),
    enabled: !!fid,
    staleTime: 30_000,
  })
}

export function useTrendingFeed() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['feed', 'trending'],
    queryFn: () =>
      apiFetch<FeedResponse>('/api/feed?feedType=trending', { address }),
    staleTime: 30_000,
  })
}

export function usePublishCast() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      text: string
      channelId?: string
      parentHash?: string
      embeds?: Array<{ url: string }>
    }) => apiPost('/api/feed', params, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })
}

export function useDeleteCast() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (castHash: string) =>
      apiDelete(`/api/feed/${castHash}`, undefined, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })
}

export function useLikeCast() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { castHash: string; castFid: number }) =>
      apiPost('/api/feed/like', params, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })
}

export function useUnlikeCast() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { castHash: string; castFid: number }) =>
      apiDelete('/api/feed/like', params, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })
}

export function useRecastCast() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { castHash: string; castFid: number }) =>
      apiPost('/api/feed/recast', params, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })
}

export function useUnrecastCast() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { castHash: string; castFid: number }) =>
      apiDelete('/api/feed/recast', params, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })
}

export function useFollowUser() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (targetFid: number) => {
      const response = await fetch(`${API_BASE}/api/feed/follow/${targetFid}`, {
        method: 'POST',
        headers: getHeaders(address),
      })
      return response.json()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'user'] }),
  })
}

export function useUnfollowUser() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (targetFid: number) => {
      const response = await fetch(`${API_BASE}/api/feed/follow/${targetFid}`, {
        method: 'DELETE',
        headers: getHeaders(address),
      })
      return response.json()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['farcaster', 'user'] }),
  })
}

export function useFarcasterUser(fid: number) {
  return useQuery({
    queryKey: ['farcaster', 'user', fid],
    queryFn: () =>
      apiFetch<{ user: FarcasterUser } | { error: { code: string } }>(
        `/api/feed/user/${fid}/profile`,
      ),
    enabled: !!fid,
    staleTime: 60_000,
  })
}

export function useFarcasterUserByUsername(username: string) {
  return useQuery({
    queryKey: ['farcaster', 'user', 'username', username],
    queryFn: () => apiFetch(`/api/farcaster/user/by-username/${username}`),
    enabled: !!username,
    staleTime: 60_000,
  })
}

export function useFeedStatus() {
  return useQuery({
    queryKey: ['feed', 'status'],
    queryFn: () => apiFetch('/api/feed/status'),
    staleTime: 60_000,
  })
}
