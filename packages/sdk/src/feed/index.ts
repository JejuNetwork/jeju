/**
 * Feed Module - Social Feed Integration (Farcaster)
 *
 * Provides TypeScript interface for:
 * - Viewing and posting to social feeds
 * - Channel management
 * - User profiles and follows
 * - Reactions and comments
 */

import type { NetworkType } from '@jejunetwork/types'
import type { Address } from 'viem'
import { getServicesConfig } from '../config'
import type { JejuWallet } from '../wallet'

// ============================================================================
// Types
// ============================================================================

export interface FeedPost {
  id: string
  hash: string
  author: FeedUser
  content: string
  embeds?: Array<{
    url?: string
    metadata?: {
      title?: string
      description?: string
      image?: string
    }
  }>
  channel?: FeedChannel
  timestamp: string
  likes: number
  recasts: number
  replies: number
  parentHash?: string
  rootHash?: string
  reactions: {
    liked: boolean
    recasted: boolean
  }
}

export interface FeedUser {
  fid: number
  username: string
  displayName: string
  pfpUrl?: string
  bio?: string
  followerCount: number
  followingCount: number
  address?: Address
  verifiedAddresses?: Address[]
  isFollowing?: boolean
  isFollowedBy?: boolean
}

export interface FeedChannel {
  id: string
  name: string
  description?: string
  imageUrl?: string
  leadFid: number
  followerCount: number
  createdAt: string
  isFollowing?: boolean
}

export interface PostCastParams {
  text: string
  channelId?: string
  parentHash?: string
  embeds?: string[]
  mentions?: number[] // fids
  mentionPositions?: number[]
}

export interface FeedFilters {
  channel?: string
  author?: string | number
  limit?: number
  cursor?: string
}

export interface SearchParams {
  query: string
  limit?: number
  cursor?: string
}

// ============================================================================
// Module Interface
// ============================================================================

export interface FeedModule {
  // Feed Reading
  getHomeFeed(
    cursor?: string,
    limit?: number,
  ): Promise<{
    posts: FeedPost[]
    nextCursor?: string
  }>
  getChannelFeed(
    channelId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{
    posts: FeedPost[]
    nextCursor?: string
  }>
  getUserFeed(
    fid: number,
    cursor?: string,
    limit?: number,
  ): Promise<{
    posts: FeedPost[]
    nextCursor?: string
  }>
  getTrendingFeed(
    cursor?: string,
    limit?: number,
  ): Promise<{
    posts: FeedPost[]
    nextCursor?: string
  }>
  getPost(hash: string): Promise<FeedPost | null>
  getReplies(
    hash: string,
    cursor?: string,
  ): Promise<{
    posts: FeedPost[]
    nextCursor?: string
  }>

  // Posting
  post(params: PostCastParams): Promise<FeedPost>
  reply(parentHash: string, text: string, embeds?: string[]): Promise<FeedPost>
  deletePost(hash: string): Promise<void>

  // Reactions
  like(hash: string): Promise<void>
  unlike(hash: string): Promise<void>
  recast(hash: string): Promise<void>
  unrecast(hash: string): Promise<void>

  // Users
  getUser(fid: number): Promise<FeedUser | null>
  getUserByUsername(username: string): Promise<FeedUser | null>
  getUserByAddress(address: Address): Promise<FeedUser | null>
  searchUsers(query: string): Promise<FeedUser[]>
  follow(fid: number): Promise<void>
  unfollow(fid: number): Promise<void>
  getFollowers(
    fid: number,
    cursor?: string,
  ): Promise<{
    users: FeedUser[]
    nextCursor?: string
  }>
  getFollowing(
    fid: number,
    cursor?: string,
  ): Promise<{
    users: FeedUser[]
    nextCursor?: string
  }>

  // Channels
  getChannel(channelId: string): Promise<FeedChannel | null>
  listChannels(
    cursor?: string,
    limit?: number,
  ): Promise<{
    channels: FeedChannel[]
    nextCursor?: string
  }>
  getTrendingChannels(limit?: number): Promise<FeedChannel[]>
  searchChannels(query: string): Promise<FeedChannel[]>
  followChannel(channelId: string): Promise<void>
  unfollowChannel(channelId: string): Promise<void>
  getMyChannels(): Promise<FeedChannel[]>

  // Notifications
  getNotifications(cursor?: string): Promise<{
    notifications: Array<{
      id: string
      type: 'like' | 'recast' | 'reply' | 'follow' | 'mention'
      actor: FeedUser
      post?: FeedPost
      timestamp: string
      isRead: boolean
    }>
    nextCursor?: string
  }>
  markNotificationsRead(notificationIds: string[]): Promise<void>

  // Search
  searchPosts(query: string, limit?: number): Promise<FeedPost[]>

  // Wallet Connection
  linkWallet(signedMessage: string): Promise<void>
  unlinkWallet(): Promise<void>
  getLinkedFid(): Promise<number | null>
}

// ============================================================================
// Implementation
// ============================================================================

export function createFeedModule(
  wallet: JejuWallet,
  network: NetworkType,
): FeedModule {
  const services = getServicesConfig(network)
  const baseUrl = `${services.factory.api}/api/feed`

  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const timestamp = Date.now().toString()
    const message = `feed:${timestamp}`
    const signature = await wallet.signMessage(message)

    return {
      'Content-Type': 'application/json',
      'x-jeju-address': wallet.address,
      'x-jeju-timestamp': timestamp,
      'x-jeju-signature': signature,
    }
  }

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = await buildAuthHeaders()
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Feed API error: ${response.status} - ${error}`)
    }

    return response.json() as Promise<T>
  }

  return {
    // Feed Reading
    async getHomeFeed(cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request<{ posts: FeedPost[]; nextCursor?: string }>(
        `/home?${params}`,
      )
    },

    async getChannelFeed(channelId, cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request<{ posts: FeedPost[]; nextCursor?: string }>(
        `/channels/${channelId}/feed?${params}`,
      )
    },

    async getUserFeed(fid, cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request<{ posts: FeedPost[]; nextCursor?: string }>(
        `/users/${fid}/feed?${params}`,
      )
    },

    async getTrendingFeed(cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request<{ posts: FeedPost[]; nextCursor?: string }>(
        `/trending?${params}`,
      )
    },

    async getPost(hash) {
      return request<FeedPost | null>(`/posts/${hash}`)
    },

    async getReplies(hash, cursor) {
      const params = cursor ? `?cursor=${cursor}` : ''
      return request<{ posts: FeedPost[]; nextCursor?: string }>(
        `/posts/${hash}/replies${params}`,
      )
    },

    // Posting
    async post(params) {
      return request<FeedPost>('/posts', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },

    async reply(parentHash, text, embeds) {
      return request<FeedPost>('/posts', {
        method: 'POST',
        body: JSON.stringify({
          text,
          parentHash,
          embeds,
        }),
      })
    },

    async deletePost(hash) {
      await request(`/posts/${hash}`, { method: 'DELETE' })
    },

    // Reactions
    async like(hash) {
      await request(`/posts/${hash}/like`, { method: 'POST' })
    },

    async unlike(hash) {
      await request(`/posts/${hash}/like`, { method: 'DELETE' })
    },

    async recast(hash) {
      await request(`/posts/${hash}/recast`, { method: 'POST' })
    },

    async unrecast(hash) {
      await request(`/posts/${hash}/recast`, { method: 'DELETE' })
    },

    // Users
    async getUser(fid) {
      return request<FeedUser | null>(`/users/${fid}`)
    },

    async getUserByUsername(username) {
      return request<FeedUser | null>(`/users/by-username/${username}`)
    },

    async getUserByAddress(address) {
      return request<FeedUser | null>(`/users/by-address/${address}`)
    },

    async searchUsers(query) {
      return request<FeedUser[]>(`/users/search?q=${encodeURIComponent(query)}`)
    },

    async follow(fid) {
      await request(`/users/${fid}/follow`, { method: 'POST' })
    },

    async unfollow(fid) {
      await request(`/users/${fid}/follow`, { method: 'DELETE' })
    },

    async getFollowers(fid, cursor) {
      const params = cursor ? `?cursor=${cursor}` : ''
      return request<{ users: FeedUser[]; nextCursor?: string }>(
        `/users/${fid}/followers${params}`,
      )
    },

    async getFollowing(fid, cursor) {
      const params = cursor ? `?cursor=${cursor}` : ''
      return request<{ users: FeedUser[]; nextCursor?: string }>(
        `/users/${fid}/following${params}`,
      )
    },

    // Channels
    async getChannel(channelId) {
      return request<FeedChannel | null>(`/channels/${channelId}`)
    },

    async listChannels(cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request<{ channels: FeedChannel[]; nextCursor?: string }>(
        `/channels?${params}`,
      )
    },

    async getTrendingChannels(limit = 10) {
      return request<FeedChannel[]>(`/channels/trending?limit=${limit}`)
    },

    async searchChannels(query) {
      return request<FeedChannel[]>(
        `/channels/search?q=${encodeURIComponent(query)}`,
      )
    },

    async followChannel(channelId) {
      await request(`/channels/${channelId}/follow`, { method: 'POST' })
    },

    async unfollowChannel(channelId) {
      await request(`/channels/${channelId}/follow`, { method: 'DELETE' })
    },

    async getMyChannels() {
      return request<FeedChannel[]>('/channels/my')
    },

    // Notifications
    async getNotifications(cursor) {
      const params = cursor ? `?cursor=${cursor}` : ''
      return request<{
        notifications: Array<{
          id: string
          type: 'like' | 'recast' | 'reply' | 'follow' | 'mention'
          actor: FeedUser
          post?: FeedPost
          timestamp: string
          isRead: boolean
        }>
        nextCursor?: string
      }>(`/notifications${params}`)
    },

    async markNotificationsRead(notificationIds) {
      await request('/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ ids: notificationIds }),
      })
    },

    // Search
    async searchPosts(query, limit = 25) {
      return request<FeedPost[]>(
        `/posts/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      )
    },

    // Wallet Connection
    async linkWallet(signedMessage) {
      await request('/wallet/link', {
        method: 'POST',
        body: JSON.stringify({
          address: wallet.address,
          signature: signedMessage,
        }),
      })
    },

    async unlinkWallet() {
      await request('/wallet/unlink', { method: 'POST' })
    },

    async getLinkedFid() {
      const result = await request<{ fid: number | null }>('/wallet/linked')
      return result.fid
    },
  }
}
