/**
 * Farcaster Feed Integration
 * Powers the Factory channel feed
 */

import { z } from 'zod'
import { FACTORY_CHANNEL_ID, NEYNAR_API_URL } from '@/config'

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

export interface Channel {
  id: string
  name: string
  description: string
  imageUrl: string
  followerCount: number
  leadFid: number
}

class FarcasterClient {
  private apiKey: string | null

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.NEYNAR_API_KEY || null
  }

  private headers() {
    if (!this.apiKey) throw new Error('Neynar API key not configured')
    return {
      api_key: this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  // ============ Channel Operations ============

  async getChannel(channelId: string = FACTORY_CHANNEL_ID): Promise<Channel> {
    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/channel?id=${channelId}`,
      {
        headers: this.headers(),
      },
    )
    if (!response.ok) throw new Error('Failed to fetch channel')
    const data = await response.json()
    return data.channel
  }

  async getChannelFeed(
    channelId: string = FACTORY_CHANNEL_ID,
    options: {
      limit?: number
      cursor?: string
    } = {},
  ): Promise<{ casts: Cast[]; cursor?: string }> {
    const params = new URLSearchParams()
    params.set('channel_id', channelId)
    if (options.limit) params.set('limit', String(options.limit))
    if (options.cursor) params.set('cursor', options.cursor)

    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/feed/channel?${params}`,
      {
        headers: this.headers(),
      },
    )
    if (!response.ok) throw new Error('Failed to fetch channel feed')
    const data = await response.json()

    return {
      casts: data.casts.map(this.transformCast),
      cursor: data.next?.cursor,
    }
  }

  // ============ User Operations ============

  async getUser(fid: number): Promise<FarcasterUser> {
    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/user?fid=${fid}`,
      {
        headers: this.headers(),
      },
    )
    if (!response.ok) throw new Error('Failed to fetch user')
    const data = await response.json()
    return this.transformUser(data.user)
  }

  async getUserByAddress(address: string): Promise<FarcasterUser | null> {
    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/user/by_verification?address=${address}`,
      { headers: this.headers() },
    )
    if (!response.ok) return null
    const data = await response.json()
    return data.user ? this.transformUser(data.user) : null
  }

  // ============ Cast Operations ============

  async getCast(hash: string): Promise<Cast> {
    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/cast?identifier=${hash}&type=hash`,
      {
        headers: this.headers(),
      },
    )
    if (!response.ok) throw new Error('Failed to fetch cast')
    const data = await response.json()
    return this.transformCast(data.cast)
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
    const response = await fetch(`${NEYNAR_API_URL}/farcaster/cast`, {
      method: 'POST',
      headers: this.headers(),
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

  async likeCast(signerUuid: string, targetHash: string): Promise<void> {
    const response = await fetch(`${NEYNAR_API_URL}/farcaster/reaction`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        signer_uuid: signerUuid,
        reaction_type: 'like',
        target: targetHash,
      }),
    })
    if (!response.ok) throw new Error('Failed to like cast')
  }

  async recastCast(signerUuid: string, targetHash: string): Promise<void> {
    const response = await fetch(`${NEYNAR_API_URL}/farcaster/reaction`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        signer_uuid: signerUuid,
        reaction_type: 'recast',
        target: targetHash,
      }),
    })
    if (!response.ok) throw new Error('Failed to recast')
  }

  // ============ Search ============

  async searchCasts(
    query: string,
    options: {
      channelId?: string
      limit?: number
    } = {},
  ): Promise<Cast[]> {
    const params = new URLSearchParams()
    params.set('q', query)
    if (options.channelId) params.set('channel_id', options.channelId)
    if (options.limit) params.set('limit', String(options.limit))

    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/cast/search?${params}`,
      {
        headers: this.headers(),
      },
    )
    if (!response.ok) throw new Error('Failed to search casts')
    const data = await response.json()
    return data.casts.map(this.transformCast)
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

// ============ Private Messaging Integration ============

const MESSAGING_API =
  process.env.NEXT_PUBLIC_MESSAGING_URL || 'http://localhost:4050'

export interface DirectMessage {
  id: string
  from: string // FID or address
  to: string
  content: string
  encrypted: boolean
  timestamp: number
  read: boolean
  threadId?: string
}

export interface MessageThread {
  threadId: string
  participants: string[]
  lastMessage: DirectMessage
  unreadCount: number
  createdAt: number
}

class MessagingClient {
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  setAuth(address: string, signature: string, timestamp: string) {
    this.headers['x-jeju-address'] = address
    this.headers['x-jeju-signature'] = signature
    this.headers['x-jeju-timestamp'] = timestamp
  }

  /**
   * Get all message threads for the user
   */
  async getThreads(): Promise<MessageThread[]> {
    const response = await fetch(`${MESSAGING_API}/api/threads`, {
      headers: this.headers,
    })
    if (!response.ok) throw new Error('Failed to fetch threads')
    const data = (await response.json()) as { threads: MessageThread[] }
    return data.threads
  }

  /**
   * Get messages in a thread
   */
  async getMessages(
    threadId: string,
    cursor?: string,
  ): Promise<{
    messages: DirectMessage[]
    cursor?: string
  }> {
    const params = cursor ? `?cursor=${cursor}` : ''
    const response = await fetch(
      `${MESSAGING_API}/api/threads/${threadId}/messages${params}`,
      {
        headers: this.headers,
      },
    )
    if (!response.ok) throw new Error('Failed to fetch messages')
    return response.json()
  }

  /**
   * Send a direct message
   */
  async sendMessage(params: {
    to: string
    content: string
    threadId?: string
    encrypt?: boolean
  }): Promise<DirectMessage> {
    const response = await fetch(`${MESSAGING_API}/api/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(params),
    })
    if (!response.ok) throw new Error('Failed to send message')
    return response.json()
  }

  /**
   * Start a new conversation thread
   */
  async startThread(participant: string): Promise<MessageThread> {
    const response = await fetch(`${MESSAGING_API}/api/threads`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ participant }),
    })
    if (!response.ok) throw new Error('Failed to start thread')
    return response.json()
  }

  /**
   * Mark messages as read
   */
  async markRead(threadId: string): Promise<void> {
    await fetch(`${MESSAGING_API}/api/threads/${threadId}/read`, {
      method: 'POST',
      headers: this.headers,
    })
  }

  /**
   * Get unread count
   */
  async getUnreadCount(): Promise<number> {
    const response = await fetch(`${MESSAGING_API}/api/messages/unread`, {
      headers: this.headers,
    })
    if (!response.ok) return 0
    const data = (await response.json()) as { count: number }
    return data.count
  }

  /**
   * Subscribe to new messages via WebSocket
   *
   * Security considerations:
   * - Message size is validated to prevent DoS attacks
   * - Origin is validated server-side (Origin header)
   * - Messages are parsed with schema validation before processing
   */
  subscribeToMessages(onMessage: (msg: DirectMessage) => void): WebSocket {
    // Maximum message size (100KB) to prevent memory exhaustion attacks
    const MAX_MESSAGE_SIZE = 100 * 1024

    // Safely construct WebSocket URL from HTTP URL
    const wsUrl = (() => {
      const url = new URL(MESSAGING_API)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.pathname = '/ws/messages'
      return url.toString()
    })()

    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      // Validate message size to prevent DoS
      const data = event.data as string
      if (data.length > MAX_MESSAGE_SIZE) {
        console.warn('WebSocket message exceeded size limit, ignoring')
        return
      }

      // Parse with schema validation (parseWebSocketMessage uses Zod)
      const parseResult = safeParseWebSocketMessage(data)
      if (!parseResult.success) {
        console.warn('Invalid WebSocket message format:', parseResult.error)
        return
      }

      if (parseResult.data.type === 'message') {
        onMessage(parseResult.data.data)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    return ws
  }
}

// WebSocket message schema for validating incoming messages
const webSocketMessageSchema = z.object({
  type: z.string(),
  data: z.object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
    content: z.string(),
    encrypted: z.boolean(),
    timestamp: z.number(),
    read: z.boolean(),
    threadId: z.string().optional(),
  }),
})

type WebSocketMessage = z.infer<typeof webSocketMessageSchema>

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

function safeParseWebSocketMessage(
  data: string,
): SafeParseResult<WebSocketMessage> {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return { success: false, error: 'Invalid JSON' }
  }

  const result = webSocketMessageSchema.safeParse(parsed)
  if (!result.success) {
    return { success: false, error: result.error.message }
  }

  return { success: true, data: result.data }
}

export const messagingClient = new MessagingClient()

// ============ Factory-specific Messaging ============

/**
 * Send bounty-related message to worker/creator
 */
export async function sendBountyMessage(params: {
  bountyId: string
  recipientAddress: string
  messageType:
    | 'application'
    | 'acceptance'
    | 'rejection'
    | 'submission'
    | 'feedback'
  content: string
}): Promise<DirectMessage> {
  return messagingClient.sendMessage({
    to: params.recipientAddress,
    content: `[Bounty ${params.bountyId}] ${params.messageType.toUpperCase()}\n\n${params.content}`,
    encrypt: true,
  })
}

/**
 * Send collaboration request to another user/agent
 */
export async function sendCollaborationRequest(params: {
  to: string
  projectId?: string
  bountyId?: string
  role: string
  message: string
}): Promise<DirectMessage> {
  const context = params.projectId
    ? `Project: ${params.projectId}`
    : params.bountyId
      ? `Bounty: ${params.bountyId}`
      : 'General'

  return messagingClient.sendMessage({
    to: params.to,
    content: `[Collaboration Request - ${context}]\nRole: ${params.role}\n\n${params.message}`,
    encrypt: true,
  })
}
