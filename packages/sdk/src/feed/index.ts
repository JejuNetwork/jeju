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
import { z } from 'zod'
import { getServicesConfig } from '../config'
import type { JejuWallet } from '../wallet'

// API response schemas for validation
const FeedUserSchema = z.object({
  fid: z.number(),
  username: z.string(),
  displayName: z.string(),
  pfpUrl: z.string().optional(),
  bio: z.string().optional(),
  followerCount: z.number(),
  followingCount: z.number(),
  address: z
    .string()
    .transform((s) => s as Address)
    .optional(),
  verifiedAddresses: z
    .array(z.string().transform((s) => s as Address))
    .optional(),
  isFollowing: z.boolean().optional(),
  isFollowedBy: z.boolean().optional(),
})

const FeedChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  leadFid: z.number(),
  followerCount: z.number(),
  createdAt: z.string(),
  isFollowing: z.boolean().optional(),
})

const FeedPostSchema: z.ZodType<FeedPost> = z.lazy(() =>
  z.object({
    id: z.string(),
    hash: z.string(),
    author: FeedUserSchema,
    content: z.string(),
    embeds: z
      .array(
        z.object({
          url: z.string().optional(),
          metadata: z
            .object({
              title: z.string().optional(),
              description: z.string().optional(),
              image: z.string().optional(),
            })
            .optional(),
        }),
      )
      .optional(),
    channel: FeedChannelSchema.optional(),
    timestamp: z.string(),
    likes: z.number(),
    recasts: z.number(),
    replies: z.number(),
    parentHash: z.string().optional(),
    rootHash: z.string().optional(),
    reactions: z.object({
      liked: z.boolean(),
      recasted: z.boolean(),
    }),
  }),
)

const FeedResponseSchema = z.object({
  posts: z.array(FeedPostSchema),
  nextCursor: z.string().optional(),
})

const UsersResponseSchema = z.object({
  users: z.array(FeedUserSchema),
  nextCursor: z.string().optional(),
})

const ChannelsResponseSchema = z.object({
  channels: z.array(FeedChannelSchema),
  nextCursor: z.string().optional(),
})

const NotificationSchema = z.object({
  id: z.string(),
  type: z.enum(['like', 'recast', 'reply', 'follow', 'mention']),
  actor: FeedUserSchema,
  post: FeedPostSchema.optional(),
  timestamp: z.string(),
  isRead: z.boolean(),
})

const NotificationsResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  nextCursor: z.string().optional(),
})

const LinkedFidResponseSchema = z.object({
  fid: z.number().nullable(),
})

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
    schema?: z.ZodType<T>,
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

    const json: unknown = await response.json()
    if (schema) {
      return schema.parse(json)
    }
    return json as T
  }

  return {
    // Feed Reading
    async getHomeFeed(cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request(`/home?${params}`, {}, FeedResponseSchema)
    },

    async getChannelFeed(channelId, cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request(
        `/channels/${channelId}/feed?${params}`,
        {},
        FeedResponseSchema,
      )
    },

    async getUserFeed(fid, cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request(`/users/${fid}/feed?${params}`, {}, FeedResponseSchema)
    },

    async getTrendingFeed(cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request(`/trending?${params}`, {}, FeedResponseSchema)
    },

    async getPost(hash) {
      return request(`/posts/${hash}`, {}, FeedPostSchema.nullable())
    },

    async getReplies(hash, cursor) {
      const params = cursor ? `?cursor=${cursor}` : ''
      return request(`/posts/${hash}/replies${params}`, {}, FeedResponseSchema)
    },

    // Posting
    async post(params) {
      return request(
        '/posts',
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
        FeedPostSchema,
      )
    },

    async reply(parentHash, text, embeds) {
      return request(
        '/posts',
        {
          method: 'POST',
          body: JSON.stringify({
            text,
            parentHash,
            embeds,
          }),
        },
        FeedPostSchema,
      )
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
      return request(`/users/${fid}`, {}, FeedUserSchema.nullable())
    },

    async getUserByUsername(username) {
      return request(
        `/users/by-username/${username}`,
        {},
        FeedUserSchema.nullable(),
      )
    },

    async getUserByAddress(address) {
      return request(
        `/users/by-address/${address}`,
        {},
        FeedUserSchema.nullable(),
      )
    },

    async searchUsers(query) {
      return request(
        `/users/search?q=${encodeURIComponent(query)}`,
        {},
        z.array(FeedUserSchema),
      )
    },

    async follow(fid) {
      await request(`/users/${fid}/follow`, { method: 'POST' })
    },

    async unfollow(fid) {
      await request(`/users/${fid}/follow`, { method: 'DELETE' })
    },

    async getFollowers(fid, cursor) {
      const params = cursor ? `?cursor=${cursor}` : ''
      return request(
        `/users/${fid}/followers${params}`,
        {},
        UsersResponseSchema,
      )
    },

    async getFollowing(fid, cursor) {
      const params = cursor ? `?cursor=${cursor}` : ''
      return request(
        `/users/${fid}/following${params}`,
        {},
        UsersResponseSchema,
      )
    },

    // Channels
    async getChannel(channelId) {
      return request(`/channels/${channelId}`, {}, FeedChannelSchema.nullable())
    },

    async listChannels(cursor, limit = 25) {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', limit.toString())
      return request(`/channels?${params}`, {}, ChannelsResponseSchema)
    },

    async getTrendingChannels(limit = 10) {
      return request(
        `/channels/trending?limit=${limit}`,
        {},
        z.array(FeedChannelSchema),
      )
    },

    async searchChannels(query) {
      return request(
        `/channels/search?q=${encodeURIComponent(query)}`,
        {},
        z.array(FeedChannelSchema),
      )
    },

    async followChannel(channelId) {
      await request(`/channels/${channelId}/follow`, { method: 'POST' })
    },

    async unfollowChannel(channelId) {
      await request(`/channels/${channelId}/follow`, { method: 'DELETE' })
    },

    async getMyChannels() {
      return request('/channels/my', {}, z.array(FeedChannelSchema))
    },

    // Notifications
    async getNotifications(cursor) {
      const params = cursor ? `?cursor=${cursor}` : ''
      return request(`/notifications${params}`, {}, NotificationsResponseSchema)
    },

    async markNotificationsRead(notificationIds) {
      await request('/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ ids: notificationIds }),
      })
    },

    // Search
    async searchPosts(query, limit = 25) {
      return request(
        `/posts/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        {},
        z.array(FeedPostSchema),
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
      const result = await request(
        '/wallet/linked',
        {},
        LinkedFidResponseSchema,
      )
      return result.fid
    },
  }
}
