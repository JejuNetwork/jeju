import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { type AutocratFeedCast, autocratMessaging } from '../../api/messaging'

export type { AutocratFeedCast }

/**
 * Hook for fetching the Autocrat channel feed
 */
export function useAutocratFeed(options?: { limit?: number }) {
  return useQuery({
    queryKey: ['autocrat', 'feed', options?.limit],
    queryFn: () => autocratMessaging.getChannelFeed({ limit: options?.limit }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/**
 * Hook for fetching user's FID from their address
 */
export function useFarcasterProfile() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['farcaster', 'profile', address],
    queryFn: async () => {
      if (!address) return null
      const fid = await autocratMessaging.getFidByAddress(address)
      if (!fid) return { fid: null }
      const profile = await autocratMessaging.getProfile(fid)
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
