/**
 * Farcaster Feed Integration
 * Powers the Factory channel feed
 */

import { FARCASTER_HUB_URL, NEYNAR_API_URL, FACTORY_CHANNEL_ID } from '@/config';

export interface FarcasterUser {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  verifiedAddresses: string[];
}

export interface Cast {
  hash: string;
  threadHash: string;
  author: FarcasterUser;
  text: string;
  timestamp: number;
  embeds: { url: string }[];
  reactions: {
    likes: number;
    recasts: number;
  };
  replies: number;
  channel: string | null;
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  followerCount: number;
  leadFid: number;
}

class FarcasterClient {
  private apiKey: string | null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.NEYNAR_API_KEY || null;
  }

  private headers() {
    if (!this.apiKey) throw new Error('Neynar API key not configured');
    return {
      'api_key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  // ============ Channel Operations ============

  async getChannel(channelId: string = FACTORY_CHANNEL_ID): Promise<Channel> {
    const response = await fetch(`${NEYNAR_API_URL}/farcaster/channel?id=${channelId}`, {
      headers: this.headers(),
    });
    if (!response.ok) throw new Error('Failed to fetch channel');
    const data = await response.json();
    return data.channel;
  }

  async getChannelFeed(channelId: string = FACTORY_CHANNEL_ID, options: {
    limit?: number;
    cursor?: string;
  } = {}): Promise<{ casts: Cast[]; cursor?: string }> {
    const params = new URLSearchParams();
    params.set('channel_id', channelId);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.cursor) params.set('cursor', options.cursor);

    const response = await fetch(`${NEYNAR_API_URL}/farcaster/feed/channel?${params}`, {
      headers: this.headers(),
    });
    if (!response.ok) throw new Error('Failed to fetch channel feed');
    const data = await response.json();

    return {
      casts: data.casts.map(this.transformCast),
      cursor: data.next?.cursor,
    };
  }

  // ============ User Operations ============

  async getUser(fid: number): Promise<FarcasterUser> {
    const response = await fetch(`${NEYNAR_API_URL}/farcaster/user?fid=${fid}`, {
      headers: this.headers(),
    });
    if (!response.ok) throw new Error('Failed to fetch user');
    const data = await response.json();
    return this.transformUser(data.user);
  }

  async getUserByAddress(address: string): Promise<FarcasterUser | null> {
    const response = await fetch(
      `${NEYNAR_API_URL}/farcaster/user/by_verification?address=${address}`,
      { headers: this.headers() }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.user ? this.transformUser(data.user) : null;
  }

  // ============ Cast Operations ============

  async getCast(hash: string): Promise<Cast> {
    const response = await fetch(`${NEYNAR_API_URL}/farcaster/cast?identifier=${hash}&type=hash`, {
      headers: this.headers(),
    });
    if (!response.ok) throw new Error('Failed to fetch cast');
    const data = await response.json();
    return this.transformCast(data.cast);
  }

  async publishCast(
    signerUuid: string,
    text: string,
    options: {
      channelId?: string;
      parentHash?: string;
      embeds?: { url: string }[];
    } = {}
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
    });
    if (!response.ok) throw new Error('Failed to publish cast');
    const data = await response.json();
    return this.transformCast(data.cast);
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
    });
    if (!response.ok) throw new Error('Failed to like cast');
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
    });
    if (!response.ok) throw new Error('Failed to recast');
  }

  // ============ Search ============

  async searchCasts(query: string, options: {
    channelId?: string;
    limit?: number;
  } = {}): Promise<Cast[]> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (options.channelId) params.set('channel_id', options.channelId);
    if (options.limit) params.set('limit', String(options.limit));

    const response = await fetch(`${NEYNAR_API_URL}/farcaster/cast/search?${params}`, {
      headers: this.headers(),
    });
    if (!response.ok) throw new Error('Failed to search casts');
    const data = await response.json();
    return data.casts.map(this.transformCast);
  }

  // ============ Helpers ============

  private transformCast(cast: Record<string, unknown>): Cast {
    const author = cast.author as Record<string, unknown>;
    return {
      hash: cast.hash as string,
      threadHash: cast.thread_hash as string,
      author: this.transformUser(author),
      text: cast.text as string,
      timestamp: new Date(cast.timestamp as string).getTime(),
      embeds: (cast.embeds as { url: string }[]) || [],
      reactions: {
        likes: (cast.reactions as Record<string, number>)?.likes || 0,
        recasts: (cast.reactions as Record<string, number>)?.recasts || 0,
      },
      replies: (cast.replies as Record<string, number>)?.count || 0,
      channel: (cast.channel as Record<string, string>)?.id || null,
    };
  }

  private transformUser(user: Record<string, unknown>): FarcasterUser {
    return {
      fid: user.fid as number,
      username: user.username as string,
      displayName: user.display_name as string,
      pfpUrl: user.pfp_url as string,
      bio: (user.profile as Record<string, Record<string, string>>)?.bio?.text || '',
      followerCount: user.follower_count as number,
      followingCount: user.following_count as number,
      verifiedAddresses: (user.verified_addresses as Record<string, string[]>)?.eth_addresses || [],
    };
  }
}

export const farcasterClient = new FarcasterClient();

// ============ Private Messaging Integration ============

const MESSAGING_API = process.env.NEXT_PUBLIC_MESSAGING_URL || 'http://localhost:4050';

export interface DirectMessage {
  id: string;
  from: string; // FID or address
  to: string;
  content: string;
  encrypted: boolean;
  timestamp: number;
  read: boolean;
  threadId?: string;
}

export interface MessageThread {
  threadId: string;
  participants: string[];
  lastMessage: DirectMessage;
  unreadCount: number;
  createdAt: number;
}

class MessagingClient {
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  setAuth(address: string, signature: string, timestamp: string) {
    this.headers['x-jeju-address'] = address;
    this.headers['x-jeju-signature'] = signature;
    this.headers['x-jeju-timestamp'] = timestamp;
  }

  /**
   * Get all message threads for the user
   */
  async getThreads(): Promise<MessageThread[]> {
    const response = await fetch(`${MESSAGING_API}/api/threads`, {
      headers: this.headers,
    });
    if (!response.ok) throw new Error('Failed to fetch threads');
    const data = await response.json() as { threads: MessageThread[] };
    return data.threads;
  }

  /**
   * Get messages in a thread
   */
  async getMessages(threadId: string, cursor?: string): Promise<{
    messages: DirectMessage[];
    cursor?: string;
  }> {
    const params = cursor ? `?cursor=${cursor}` : '';
    const response = await fetch(`${MESSAGING_API}/api/threads/${threadId}/messages${params}`, {
      headers: this.headers,
    });
    if (!response.ok) throw new Error('Failed to fetch messages');
    return response.json();
  }

  /**
   * Send a direct message
   */
  async sendMessage(params: {
    to: string;
    content: string;
    threadId?: string;
    encrypt?: boolean;
  }): Promise<DirectMessage> {
    const response = await fetch(`${MESSAGING_API}/api/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error('Failed to send message');
    return response.json();
  }

  /**
   * Start a new conversation thread
   */
  async startThread(participant: string): Promise<MessageThread> {
    const response = await fetch(`${MESSAGING_API}/api/threads`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ participant }),
    });
    if (!response.ok) throw new Error('Failed to start thread');
    return response.json();
  }

  /**
   * Mark messages as read
   */
  async markRead(threadId: string): Promise<void> {
    await fetch(`${MESSAGING_API}/api/threads/${threadId}/read`, {
      method: 'POST',
      headers: this.headers,
    });
  }

  /**
   * Get unread count
   */
  async getUnreadCount(): Promise<number> {
    const response = await fetch(`${MESSAGING_API}/api/messages/unread`, {
      headers: this.headers,
    });
    if (!response.ok) return 0;
    const data = await response.json() as { count: number };
    return data.count;
  }

  /**
   * Subscribe to new messages via WebSocket
   */
  subscribeToMessages(onMessage: (msg: DirectMessage) => void): WebSocket {
    const ws = new WebSocket(`${MESSAGING_API.replace('http', 'ws')}/ws/messages`);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'message') {
        onMessage(msg.data);
      }
    };
    return ws;
  }
}

export const messagingClient = new MessagingClient();

// ============ Factory-specific Messaging ============

/**
 * Send bounty-related message to worker/creator
 */
export async function sendBountyMessage(params: {
  bountyId: string;
  recipientAddress: string;
  messageType: 'application' | 'acceptance' | 'rejection' | 'submission' | 'feedback';
  content: string;
}): Promise<DirectMessage> {
  return messagingClient.sendMessage({
    to: params.recipientAddress,
    content: `[Bounty ${params.bountyId}] ${params.messageType.toUpperCase()}\n\n${params.content}`,
    encrypt: true,
  });
}

/**
 * Send collaboration request to another user/agent
 */
export async function sendCollaborationRequest(params: {
  to: string;
  projectId?: string;
  bountyId?: string;
  role: string;
  message: string;
}): Promise<DirectMessage> {
  const context = params.projectId 
    ? `Project: ${params.projectId}` 
    : params.bountyId 
      ? `Bounty: ${params.bountyId}` 
      : 'General';
      
  return messagingClient.sendMessage({
    to: params.to,
    content: `[Collaboration Request - ${context}]\nRole: ${params.role}\n\n${params.message}`,
    encrypt: true,
  });
}
