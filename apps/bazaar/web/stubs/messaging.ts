/**
 * Browser-safe messaging utilities
 * 
 * Re-exports only browser-compatible parts of the messaging module.
 * Server-side functionality (FarcasterClient) is handled via API.
 */

import type { Address } from 'viem'

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

// API-based messaging service for browser
class BazaarMessagingServiceBrowser {
  private apiUrl: string

  constructor() {
    this.apiUrl = typeof window !== 'undefined' 
      ? `${window.location.origin}/api`
      : '/api'
  }

  async getChannelFeed(
    channelUrl: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<{ casts: BazaarFeedCast[]; cursor?: string }> {
    const params = new URLSearchParams()
    params.set('channelUrl', channelUrl)
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.cursor) params.set('cursor', options.cursor)

    const response = await fetch(`${this.apiUrl}/messaging/feed?${params}`)
    if (!response.ok) {
      return { casts: [] }
    }
    return response.json()
  }

  async getEntityFeed(
    type: BazaarChannelType,
    id: string,
    options?: { limit?: number; cursor?: string },
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

  async getProfile(fid: number): Promise<{ username?: string; displayName?: string; pfpUrl?: string } | null> {
    const response = await fetch(`${this.apiUrl}/messaging/profile?fid=${fid}`)
    if (!response.ok) return null
    return response.json()
  }

  async getFidByAddress(address: Address): Promise<number | null> {
    const response = await fetch(`${this.apiUrl}/messaging/fid?address=${address}`)
    if (!response.ok) return null
    const data = await response.json()
    return data.fid ?? null
  }
}

export const bazaarMessaging = new BazaarMessagingServiceBrowser()
export { BazaarMessagingServiceBrowser as BazaarMessagingService }
