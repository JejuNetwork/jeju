/**
 * Farcaster Feed Integration
 * Powers the Factory channel feed
 */

import { z } from 'zod'

const FACTORY_CHANNEL_ID = process.env.FACTORY_CHANNEL_ID || 'factory'
const NEYNAR_API_URL = process.env.NEYNAR_API_URL || 'https://api.neynar.com/v2'

const neynarUserSchema = z.object({
  fid: z.number(),
  username: z.string(),
  display_name: z.string(),
  pfp_url: z.string(),
  profile: z
    .object({
      bio: z
        .object({
          text: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  follower_count: z.number().optional(),
  following_count: z.number().optional(),
  verified_addresses: z
    .object({
      eth_addresses: z.array(z.string()).optional(),
    })
    .optional(),
})

const neynarCastSchema = z.object({
  hash: z.string(),
  thread_hash: z.string(),
  author: neynarUserSchema,
  text: z.string(),
  timestamp: z.string(),
  embeds: z.array(z.object({ url: z.string() })).optional(),
  reactions: z
    .object({
      likes: z.number().optional(),
      recasts: z.number().optional(),
    })
    .optional(),
  replies: z
    .object({
      count: z.number().optional(),
    })
    .optional(),
  channel: z
    .object({
      id: z.string(),
    })
    .nullable()
    .optional(),
})

export interface FarcasterUser {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  bio: string
  followerCount: number
  followingCount: number
  verifiedAddresses: string[]
}

export interface Cast {
  hash: string
  threadHash: string
  author: FarcasterUser
  text: string
  timestamp: number
  embeds: { url: string }[]
  reactions: {
    likes: number
    recasts: number
  }
  replies: number
  channel: string | null
}

class FarcasterClient {
  private apiKey: string | null

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.NEYNAR_API_KEY || null
  }

  private headers() {
    if (!this.apiKey) {
      // Return mock data if API key not configured
      return null
    }
    return {
      api_key: this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  async getChannelFeed(
    channelId: string = FACTORY_CHANNEL_ID,
    options: {
      limit?: number
      cursor?: string
    } = {},
  ): Promise<{ casts: Cast[]; cursor?: string }> {
    const headers = this.headers()

    // Return mock data if API key not configured
    if (!headers) {
      return {
        casts: [
          {
            hash: '0x1234',
            threadHash: '0x1234',
            author: {
              fid: 1,
              username: 'alice.eth',
              displayName: 'Alice',
              pfpUrl: 'https://avatars.githubusercontent.com/u/1',
              bio: 'Developer',
              followerCount: 1000,
              followingCount: 500,
              verifiedAddresses: [],
            },
            text: 'Just shipped v2.0 of the SDK! 🚀',
            timestamp: Date.now() - 60 * 60 * 1000,
            embeds: [],
            reactions: { likes: 42, recasts: 12 },
            replies: 5,
            channel: FACTORY_CHANNEL_ID,
          },
          {
            hash: '0x5678',
            threadHash: '0x5678',
            author: {
              fid: 2,
              username: 'bob.eth',
              displayName: 'Bob',
              pfpUrl: 'https://avatars.githubusercontent.com/u/2',
              bio: 'Builder',
              followerCount: 800,
              followingCount: 400,
              verifiedAddresses: [],
            },
            text: 'Working on the new bounty system',
            timestamp: Date.now() - 2 * 60 * 60 * 1000,
            embeds: [],
            reactions: { likes: 28, recasts: 5 },
            replies: 3,
            channel: FACTORY_CHANNEL_ID,
          },
        ],
      }
    }

    const params = new URLSearchParams()
    params.set('channel_id', channelId)
    if (options.limit) params.set('limit', String(options.limit))
    if (options.cursor) params.set('cursor', options.cursor)

    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/feed/channel?${params}`,
      {
        headers,
      },
    )

    if (!response.ok) throw new Error('Failed to fetch channel feed')
    const data = await response.json()

    return {
      casts: data.casts.map(this.transformCast.bind(this)),
      cursor: data.next?.cursor,
    }
  }

  async publishCast(
    signerUuid: string,
    text: string,
    options: {
      channelId?: string
      parentHash?: string
      embeds?: { url: string }[]
    } = {},
  ): Promise<Cast> {
    const headers = this.headers()
    if (!headers) throw new Error('Neynar API key not configured')

    const response = await fetch(`${NEYNAR_API_URL}/farcaster/cast`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        signer_uuid: signerUuid,
        text,
        channel_id: options.channelId || FACTORY_CHANNEL_ID,
        parent: options.parentHash,
        embeds: options.embeds,
      }),
    })

    if (!response.ok) throw new Error('Failed to publish cast')
    const data = await response.json()
    return this.transformCast(data.cast)
  }

  private transformCast(rawCast: unknown): Cast {
    const cast = neynarCastSchema.parse(rawCast)
    return {
      hash: cast.hash,
      threadHash: cast.thread_hash,
      author: this.transformUser(cast.author),
      text: cast.text,
      timestamp: new Date(cast.timestamp).getTime(),
      embeds: cast.embeds ?? [],
      reactions: {
        likes: cast.reactions?.likes ?? 0,
        recasts: cast.reactions?.recasts ?? 0,
      },
      replies: cast.replies?.count ?? 0,
      channel: cast.channel?.id ?? null,
    }
  }

  private transformUser(rawUser: unknown): FarcasterUser {
    const user = neynarUserSchema.parse(rawUser)
    return {
      fid: user.fid,
      username: user.username,
      displayName: user.display_name,
      pfpUrl: user.pfp_url,
      bio: user.profile?.bio?.text ?? '',
      followerCount: user.follower_count ?? 0,
      followingCount: user.following_count ?? 0,
      verifiedAddresses: user.verified_addresses?.eth_addresses ?? [],
    }
  }
}

export const farcasterClient = new FarcasterClient()
