/**
 * Bazaar Messaging Hooks
 *
 * React hooks for Farcaster channel feeds in the Bazaar app.
 * Each entity (coin, item, perp, prediction) has its own channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { useAccount } from 'wagmi'
import {
  type BazaarChannel,
  type BazaarChannelType,
  type BazaarFeedCast,
  bazaarMessaging,
  getCoinChannel,
  getCollectionChannel,
  getItemChannel,
  getPerpChannel,
  getPredictionChannel,
} from '../../api/messaging'

export type { BazaarChannel, BazaarChannelType, BazaarFeedCast }

export {
  getCoinChannel,
  getCollectionChannel,
  getItemChannel,
  getPerpChannel,
  getPredictionChannel,
}

/**
 * Hook for fetching a channel feed by URL
 */
export function useChannelFeed(
  channelUrl: string,
  options?: { limit?: number; enabled?: boolean },
) {
  return useQuery({
    queryKey: ['channel', 'feed', channelUrl, options?.limit],
    queryFn: () =>
      bazaarMessaging.getChannelFeed(channelUrl, { limit: options?.limit }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: options?.enabled !== false && Boolean(channelUrl),
  })
}

/**
 * Hook for fetching an entity channel feed
 */
export function useEntityFeed(
  type: BazaarChannelType,
  id: string,
  options?: { limit?: number; enabled?: boolean },
) {
  return useQuery({
    queryKey: ['entity', 'feed', type, id, options?.limit],
    queryFn: () =>
      bazaarMessaging.getEntityFeed(type, id, { limit: options?.limit }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: options?.enabled !== false && Boolean(type) && Boolean(id),
  })
}

/**
 * Hook for coin channel feed
 */
export function useCoinFeed(
  chainId: number,
  address: Address,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getCoinChannel(chainId, address, '')
  return useChannelFeed(channel.url, options)
}

/**
 * Hook for item channel feed
 */
export function useItemFeed(
  collectionAddress: Address,
  tokenId: string,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getItemChannel(collectionAddress, tokenId, '')
  return useChannelFeed(channel.url, options)
}

/**
 * Hook for collection channel feed
 */
export function useCollectionFeed(
  address: Address,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getCollectionChannel(address, '')
  return useChannelFeed(channel.url, options)
}

/**
 * Hook for perp channel feed
 */
export function usePerpFeed(
  ticker: string,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getPerpChannel(ticker)
  return useChannelFeed(channel.url, options)
}

/**
 * Hook for prediction market channel feed
 */
export function usePredictionFeed(
  marketId: string,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getPredictionChannel(marketId, '')
  return useChannelFeed(channel.url, options)
}

/**
 * Hook for the main Bazaar channel feed
 */
const BAZAAR_CHANNEL_URL = 'https://warpcast.com/~/channel/bazaar'

export function useBazaarFeed(options?: { limit?: number; enabled?: boolean }) {
  return useChannelFeed(BAZAAR_CHANNEL_URL, options)
}

/**
 * Hook for posting to a channel
 */
export function usePostToChannel(channelUrl: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      text: string
      fid: number
      signerPrivateKey: Hex
      embeds?: string[]
    }) => {
      return bazaarMessaging.postToChannel({
        channelUrl,
        text: params.text,
        fid: params.fid,
        signerPrivateKey: params.signerPrivateKey,
        embeds: params.embeds,
      })
    },
    onSuccess: () => {
      // Invalidate the feed cache to refetch
      queryClient.invalidateQueries({
        queryKey: ['channel', 'feed', channelUrl],
      })
    },
  })
}

/**
 * Hook for posting to an entity channel
 */
export function usePostToEntityChannel(type: BazaarChannelType, id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      text: string
      fid: number
      signerPrivateKey: Hex
      embeds?: string[]
    }) => {
      return bazaarMessaging.postToEntityChannel({
        type,
        id,
        text: params.text,
        fid: params.fid,
        signerPrivateKey: params.signerPrivateKey,
        embeds: params.embeds,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity', 'feed', type, id] })
    },
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
      if (!fid)
        return { fid: null, username: undefined, displayName: undefined }
      const profile = await bazaarMessaging.getProfile(fid)
      return {
        fid,
        username: profile?.username,
        displayName: profile?.displayName,
        pfpUrl: profile?.pfpUrl,
      }
    },
    enabled: Boolean(address),
    staleTime: 60_000,
  })
}

/**
 * Hook for getting FID by address (for posting)
 */
export function useFarcasterFid() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['farcaster', 'fid', address],
    queryFn: async () => {
      if (!address) return null
      return bazaarMessaging.getFidByAddress(address)
    },
    enabled: Boolean(address),
    staleTime: 300_000,
  })
}
