import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { type CrucibleFeedCast, crucibleMessaging } from '../../api/messaging'

export type { CrucibleFeedCast }

/**
 * Hook for fetching the Crucible channel feed
 */
export function useCrucibleFeed(options?: { limit?: number }) {
  return useQuery({
    queryKey: ['crucible', 'feed', options?.limit],
    queryFn: () => crucibleMessaging.getChannelFeed({ limit: options?.limit }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/**
 * Hook for fetching user's FID from their address
 */
export function useFarcasterProfile(address?: Address) {
  return useQuery({
    queryKey: ['farcaster', 'profile', address],
    queryFn: async () => {
      if (!address) return null
      const fid = await crucibleMessaging.getFidByAddress(address)
      if (!fid) return { fid: null }
      const profile = await crucibleMessaging.getProfile(fid)
      return {
        fid,
        username: profile?.username,
        displayName: profile?.displayName,
      }
    },
    enabled: !!address,
    staleTime: 60_000,
  })
}
