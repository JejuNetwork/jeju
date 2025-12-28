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

export function useCoinFeed(
  chainId: number,
  address: Address,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getCoinChannel(chainId, address, '')
  return useChannelFeed(channel.url, options)
}

export function useItemFeed(
  collectionAddress: Address,
  tokenId: string,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getItemChannel(collectionAddress, tokenId, '')
  return useChannelFeed(channel.url, options)
}

export function useCollectionFeed(
  address: Address,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getCollectionChannel(address, '')
  return useChannelFeed(channel.url, options)
}

export function usePerpFeed(
  ticker: string,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getPerpChannel(ticker)
  return useChannelFeed(channel.url, options)
}

export function usePredictionFeed(
  marketId: string,
  options?: { limit?: number; enabled?: boolean },
) {
  const channel = getPredictionChannel(marketId, '')
  return useChannelFeed(channel.url, options)
}

const BAZAAR_CHANNEL_URL = 'https://warpcast.com/~/channel/bazaar'

export function useBazaarFeed(options?: { limit?: number; enabled?: boolean }) {
  return useChannelFeed(BAZAAR_CHANNEL_URL, options)
}

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
