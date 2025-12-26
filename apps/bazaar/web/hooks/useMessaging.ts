/**
 * Bazaar Messaging Hooks
 *
 * React hooks for Farcaster feed in the Bazaar app
 * Uses the messaging package directly to fetch from Farcaster Hub
 */

import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { type BazaarFeedCast, bazaarMessaging } from '../../api/messaging'

export type { BazaarFeedCast }

/**
 * Hook for fetching the Bazaar channel feed
 */
export function useBazaarFeed(options?: { limit?: number }) {
  return useQuery({
    queryKey: ['bazaar', 'feed', options?.limit],
    queryFn: () => bazaarMessaging.getChannelFeed({ limit: options?.limit }),
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
      const fid = await bazaarMessaging.getFidByAddress(address)
      if (!fid) return { fid: null }
      const profile = await bazaarMessaging.getProfile(fid)
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
