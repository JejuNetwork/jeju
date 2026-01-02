import { getCacheClient } from '@jejunetwork/cache'
import {
  type FarcasterCast,
  FarcasterClient,
  type FarcasterProfile,
} from '@jejunetwork/messaging'
import type { Address, Hex } from 'viem'

import { config } from './config'

const HUB_URL = config.farcasterHubUrl
const MPC_SIGNER_URL = config.mpcSignerUrl

export interface KMSPostResult {
  hash: Hex
  fid: number
  text: string
  timestamp: number
}

export type BazaarChannelType =
  | 'coin'
  | 'item'
  | 'collection'
  | 'perp'
  | 'prediction'

export interface BazaarChannel {
  type: BazaarChannelType
  id: string
  name: string
  url: string
  warpcastUrl: string
}

export function getChannelUrl(type: BazaarChannelType, id: string): string {
  const channelId = `bazaar-${type}-${id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
  return `https://warpcast.com/~/channel/${channelId}`
}

export function getChannel(
  type: BazaarChannelType,
  id: string,
  name: string,
): BazaarChannel {
  const channelId = `bazaar-${type}-${id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
  return {
    type,
    id,
    name,
    url: `https://warpcast.com/~/channel/${channelId}`,
    warpcastUrl: `https://warpcast.com/~/channel/${channelId}`,
  }
}

export function getCoinChannel(
  chainId: number,
  address: Address,
  name: string,
): BazaarChannel {
  return getChannel('coin', `${chainId}-${address.slice(0, 10)}`, name)
}

export function getItemChannel(
  collectionAddress: Address,
  tokenId: string,
  name: string,
): BazaarChannel {
  return getChannel(
    'item',
    `${collectionAddress.slice(0, 10)}-${tokenId}`,
    name,
  )
}

export function getCollectionChannel(
  address: Address,
  name: string,
): BazaarChannel {
  return getChannel('collection', address.slice(0, 10), name)
}

export function getPerpChannel(ticker: string): BazaarChannel {
  return getChannel('perp', ticker.toLowerCase(), `$${ticker} Perp`)
}

export function getPredictionChannel(
  marketId: string,
  question: string,
): BazaarChannel {
  const shortQuestion =
    question.length > 30 ? `${question.slice(0, 30)}...` : question
  return getChannel('prediction', marketId, shortQuestion)
}

// DWS cache for Farcaster profiles (5 minute TTL)
const PROFILE_CACHE_TTL = 300 // 5 minutes in seconds

function getProfileCache() {
  return getCacheClient('bazaar-profiles')
}

export interface BazaarFeedCast {
  hash: string
  author: {
    fid: number
    username: string
    displayName: string
    pfpUrl: string
  }
  text: string
  timestamp: number
  embeds: Array<{ url: string }>
  parentHash?: string
}

export interface MarketplaceNotification {
  type:
    | 'listing_sold'
    | 'bid_received'
    | 'auction_ended'
    | 'collection_trending'
    | 'price_alert'
  title: string
  body: string
  data?: Record<string, string | number>
}

class BazaarMessagingService {
  private hubClient: FarcasterClient

  constructor() {
    this.hubClient = new FarcasterClient({ hubUrl: HUB_URL })
  }

  async getChannelFeed(
    channelUrl: string,
    options?: {
      limit?: number
      cursor?: string
    },
  ): Promise<{ casts: BazaarFeedCast[]; cursor?: string }> {
    const response = await this.hubClient.getCastsByChannel(channelUrl, {
      pageSize: options?.limit ?? 20,
      pageToken: options?.cursor,
    })

    const casts = await this.enrichCasts(response.messages)

    return {
      casts,
      cursor: response.nextPageToken,
    }
  }

  async getEntityFeed(
    type: BazaarChannelType,
    id: string,
    options?: {
      limit?: number
      cursor?: string
    },
  ): Promise<{ casts: BazaarFeedCast[]; cursor?: string }> {
    const channelUrl = getChannelUrl(type, id)
    return this.getChannelFeed(channelUrl, options)
  }

  getComposeUrl(params: {
    channelUrl: string
    text?: string
    embeds?: string[]
  }): string {
    const baseUrl = 'https://warpcast.com/~/compose'
    const searchParams = new URLSearchParams()
    if (params.text) searchParams.set('text', params.text)
    if (params.channelUrl) searchParams.set('channelUrl', params.channelUrl)
    if (params.embeds?.length) {
      for (const url of params.embeds) {
        searchParams.append('embeds[]', url)
      }
    }
    return `${baseUrl}?${searchParams.toString()}`
  }

  getEntityComposeUrl(params: {
    type: BazaarChannelType
    id: string
    text?: string
    embeds?: string[]
  }): string {
    const channelUrl = getChannelUrl(params.type, params.id)
    return this.getComposeUrl({
      channelUrl,
      text: params.text,
      embeds: params.embeds,
    })
  }

  async getProfile(fid: number): Promise<FarcasterProfile | null> {
    const cache = getProfileCache()
    const cacheKey = `profile:${fid}`

    // Check DWS cache first
    const cached = await cache.get(cacheKey).catch(() => null)
    if (cached) {
      return JSON.parse(cached) as FarcasterProfile
    }

    const profile = await this.hubClient.getProfile(fid)
    if (profile) {
      cache
        .set(cacheKey, JSON.stringify(profile), PROFILE_CACHE_TTL)
        .catch(() => {})
    }
    return profile
  }

  async getFidByAddress(address: Address): Promise<number | null> {
    const profile = await this.hubClient.getProfileByVerifiedAddress(address)
    return profile?.fid ?? null
  }

  private async enrichCasts(casts: FarcasterCast[]): Promise<BazaarFeedCast[]> {
    const fids = [...new Set(casts.map((c) => c.fid))]
    const profiles = await Promise.all(fids.map((fid) => this.getProfile(fid)))
    const profileMap = new Map<number, FarcasterProfile>()
    for (let i = 0; i < fids.length; i++) {
      const profile = profiles[i]
      if (profile) {
        profileMap.set(fids[i], profile)
      }
    }

    return casts.map((cast) => {
      const profile = profileMap.get(cast.fid)
      return {
        hash: cast.hash,
        author: {
          fid: cast.fid,
          username: profile?.username ?? '',
          displayName: profile?.displayName ?? '',
          pfpUrl: profile?.pfpUrl ?? '',
        },
        text: cast.text,
        timestamp: cast.timestamp,
        embeds: cast.embeds
          .filter((e) => e.url)
          .map((e) => ({ url: e.url as string })),
        parentHash: cast.parentHash ?? undefined,
      }
    })
  }

  createNotification(
    payload: MarketplaceNotification,
    channel: BazaarChannel,
  ): {
    type: string
    title: string
    body: string
    data: Record<string, string | number>
    channel: string
    channelUrl: string
  } {
    return {
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      channel: channel.name,
      channelUrl: channel.url,
    }
  }

  listingSoldNotification(params: {
    nftName: string
    price: string
    buyer: string
    collection: string
  }): MarketplaceNotification {
    return {
      type: 'listing_sold',
      title: 'Item Sold',
      body: `${params.nftName} sold for ${params.price} to ${params.buyer}`,
      data: {
        nftName: params.nftName,
        price: params.price,
        buyer: params.buyer,
        collection: params.collection,
      },
    }
  }

  bidReceivedNotification(params: {
    nftName: string
    bidAmount: string
    bidder: string
  }): MarketplaceNotification {
    return {
      type: 'bid_received',
      title: 'New Bid Received',
      body: `${params.bidder} bid ${params.bidAmount} on ${params.nftName}`,
      data: {
        nftName: params.nftName,
        bidAmount: params.bidAmount,
        bidder: params.bidder,
      },
    }
  }

  auctionEndedNotification(params: {
    nftName: string
    winner: string
    finalPrice: string
  }): MarketplaceNotification {
    return {
      type: 'auction_ended',
      title: 'Auction Ended',
      body: `${params.winner} won ${params.nftName} for ${params.finalPrice}`,
      data: {
        nftName: params.nftName,
        winner: params.winner,
        finalPrice: params.finalPrice,
      },
    }
  }

  collectionTrendingNotification(params: {
    collectionName: string
    volumeChange: string
    floorChange: string
  }): MarketplaceNotification {
    return {
      type: 'collection_trending',
      title: 'Collection Trending',
      body: `${params.collectionName} volume ${params.volumeChange}, floor ${params.floorChange}`,
      data: {
        collectionName: params.collectionName,
        volumeChange: params.volumeChange,
        floorChange: params.floorChange,
      },
    }
  }

  async postToChannelWithKMS(params: {
    signerId: string
    text: string
    channelUrl: string
    embeds?: string[]
  }): Promise<KMSPostResult> {
    if (!MPC_SIGNER_URL) {
      throw new Error(
        'MPC_SIGNER_URL not configured. Set MPC_SIGNER_URL environment variable.',
      )
    }

    const response = await fetch(`${MPC_SIGNER_URL}/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signerId: params.signerId,
        text: params.text,
        parentUrl: params.channelUrl,
        embeds: params.embeds?.map((url) => ({ url })),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to post via MPC signer: ${error}`)
    }

    const result = (await response.json()) as KMSPostResult
    return result
  }

  async postToEntityChannelWithKMS(params: {
    signerId: string
    type: BazaarChannelType
    id: string
    text: string
    embeds?: string[]
  }): Promise<KMSPostResult> {
    const channelUrl = getChannelUrl(params.type, params.id)
    return this.postToChannelWithKMS({
      signerId: params.signerId,
      text: params.text,
      channelUrl,
      embeds: params.embeds,
    })
  }

  isKMSPostingAvailable(): boolean {
    return Boolean(MPC_SIGNER_URL)
  }
}

export const bazaarMessaging = new BazaarMessagingService()
export { BazaarMessagingService }
