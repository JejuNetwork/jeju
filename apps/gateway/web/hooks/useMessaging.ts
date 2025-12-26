/**
 * Gateway Messaging Hooks
 *
 * React hooks for Farcaster feed in the Gateway app
 * Uses the messaging service directly to fetch from Farcaster Hub
 */

import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import {
  type GatewayFeedCast,
  gatewayMessaging,
} from '../../api/services/messaging'

export type { GatewayFeedCast }

/**
 * Hook for fetching the Gateway channel feed
 */
export function useGatewayFeed(options?: { limit?: number }) {
  return useQuery({
    queryKey: ['gateway', 'feed', options?.limit],
    queryFn: () => gatewayMessaging.getChannelFeed({ limit: options?.limit }),
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
      const fid = await gatewayMessaging.getFidByAddress(address)
      if (!fid) return { fid: null }
      const profile = await gatewayMessaging.getProfile(fid)
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
