/**
 * Bazaar Messaging Hooks
 *
 * React hooks for Farcaster channel feeds in the Bazaar app.
 * Each entity (coin, item, perp, prediction) has its own channel.
 *
 * SECURITY: Posting is done via Warpcast redirect (client-side signing).
 * Server-side posting would require KMS integration for TEE safety.
 */

import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
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
 * Hook for getting Warpcast compose URL (safe posting via redirect)
 *
 * SECURITY: Uses client-side Warpcast for signing.
 * Server-side posting would require KMS-backed Farcaster signer.
 */
export function useComposeUrl(channelUrl: string) {
  return {
    getComposeUrl: (params?: { text?: string; embeds?: string[] }) =>
      bazaarMessaging.getComposeUrl({
        channelUrl,
        text: params?.text,
        embeds: params?.embeds,
      }),
  }
}

/**
 * Hook for getting Warpcast compose URL for entity channel
 */
export function useEntityComposeUrl(type: BazaarChannelType, id: string) {
  return {
    getComposeUrl: (params?: { text?: string; embeds?: string[] }) =>
      bazaarMessaging.getEntityComposeUrl({
        type,
        id,
        text: params?.text,
        embeds: params?.embeds,
      }),
  }
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
