# Agent Task: SDK FeedModule with Full Write Capabilities

## Priority: P1
## Estimated Time: 2 days
## Dependencies: agent-farcaster-oauth3, agent-farcaster-hub-posting

## Objective

Create a unified FeedModule in the Jeju SDK that provides read/write access to Farcaster and other social feeds, abstracting away the complexity of hub interactions.

## Source Files to Analyze

- `packages/sdk/src/client.ts` - Main SDK client
- `packages/oauth3/src/providers/farcaster.ts` - Farcaster provider
- `packages/farcaster/src/hub/poster.ts` - Hub posting

## Implementation Tasks

### 1. Feed Module Interface

File: `packages/sdk/src/feed/index.ts`

```typescript
/**
 * Feed Module - Unified social feed access
 * 
 * Provides read/write access to:
 * - Farcaster (casts, reactions, follows)
 * - Future: Lens, Bluesky, etc.
 */

import type { Address, Hex } from 'viem';
import type { NetworkType } from '@jejunetwork/types';
import type { JejuWallet } from '../wallet';

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Post {
  id: string;
  platform: 'farcaster' | 'lens' | 'bluesky';
  author: PostAuthor;
  content: string;
  embeds?: PostEmbed[];
  mentions?: PostMention[];
  replyTo?: { id: string; author: PostAuthor };
  channel?: { id: string; name: string; url?: string };
  reactions: PostReactions;
  replies: number;
  timestamp: number;
  hash?: Hex;
}

export interface PostAuthor {
  id: string; // FID for Farcaster
  address?: Address;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface PostEmbed {
  type: 'url' | 'image' | 'video' | 'post';
  url?: string;
  post?: Post;
  metadata?: {
    title?: string;
    description?: string;
    image?: string;
  };
}

export interface PostMention {
  id: string;
  username: string;
  position: number;
}

export interface PostReactions {
  likes: number;
  reposts: number;
  quotes: number;
  liked?: boolean;
  reposted?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  url?: string;
  followerCount: number;
  platform: 'farcaster';
}

export interface UserProfile {
  id: string;
  platform: 'farcaster' | 'lens' | 'bluesky';
  address?: Address;
  username?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  isFollowing?: boolean;
  isFollowedBy?: boolean;
}

export interface CreatePostParams {
  content: string;
  embeds?: string[];
  embedPosts?: Array<{ platform: string; id: string }>;
  mentions?: Array<{ id: string; position: number }>;
  replyTo?: { platform: string; id: string };
  channel?: string;
  platform?: 'farcaster';
}

export interface FeedFilter {
  platform?: 'farcaster' | 'all';
  type?: 'home' | 'user' | 'channel' | 'replies';
  userId?: string;
  channelId?: string;
  limit?: number;
  cursor?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         MODULE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

export interface FeedModule {
  // ============ Initialization ============
  
  /**
   * Initialize with Farcaster session
   */
  connectFarcaster(session: FarcasterSession): Promise<void>;
  
  /**
   * Check if Farcaster is connected
   */
  isFarcasterConnected(): boolean;
  
  /**
   * Get current Farcaster session
   */
  getFarcasterSession(): FarcasterSession | null;
  
  /**
   * Disconnect Farcaster
   */
  disconnectFarcaster(): void;
  
  // ============ Feed Reading ============
  
  /**
   * Get home feed
   */
  getHomeFeed(options?: { limit?: number; cursor?: string }): Promise<{
    posts: Post[];
    nextCursor?: string;
  }>;
  
  /**
   * Get user's posts
   */
  getUserPosts(userId: string, options?: { limit?: number; cursor?: string }): Promise<{
    posts: Post[];
    nextCursor?: string;
  }>;
  
  /**
   * Get channel feed
   */
  getChannelFeed(channelId: string, options?: { limit?: number; cursor?: string }): Promise<{
    posts: Post[];
    nextCursor?: string;
  }>;
  
  /**
   * Get post by ID
   */
  getPost(postId: string, platform?: string): Promise<Post | null>;
  
  /**
   * Get replies to a post
   */
  getReplies(postId: string, options?: { limit?: number; cursor?: string }): Promise<{
    posts: Post[];
    nextCursor?: string;
  }>;
  
  /**
   * Search posts
   */
  search(query: string, options?: { limit?: number; cursor?: string }): Promise<{
    posts: Post[];
    nextCursor?: string;
  }>;
  
  // ============ Posting ============
  
  /**
   * Create a post
   */
  post(params: CreatePostParams): Promise<Post>;
  
  /**
   * Reply to a post
   */
  reply(postId: string, content: string, options?: {
    embeds?: string[];
    mentions?: Array<{ id: string; position: number }>;
  }): Promise<Post>;
  
  /**
   * Delete a post
   */
  deletePost(postId: string): Promise<void>;
  
  // ============ Reactions ============
  
  /**
   * Like a post
   */
  like(postId: string): Promise<void>;
  
  /**
   * Unlike a post
   */
  unlike(postId: string): Promise<void>;
  
  /**
   * Repost
   */
  repost(postId: string): Promise<void>;
  
  /**
   * Unrepost
   */
  unrepost(postId: string): Promise<void>;
  
  /**
   * Quote post
   */
  quote(postId: string, content: string): Promise<Post>;
  
  // ============ Follows ============
  
  /**
   * Follow a user
   */
  follow(userId: string): Promise<void>;
  
  /**
   * Unfollow a user
   */
  unfollow(userId: string): Promise<void>;
  
  /**
   * Get followers
   */
  getFollowers(userId: string, options?: { limit?: number; cursor?: string }): Promise<{
    users: UserProfile[];
    nextCursor?: string;
  }>;
  
  /**
   * Get following
   */
  getFollowing(userId: string, options?: { limit?: number; cursor?: string }): Promise<{
    users: UserProfile[];
    nextCursor?: string;
  }>;
  
  // ============ Profiles ============
  
  /**
   * Get user profile
   */
  getProfile(userId: string): Promise<UserProfile | null>;
  
  /**
   * Get profile by username
   */
  getProfileByUsername(username: string, platform?: string): Promise<UserProfile | null>;
  
  /**
   * Get profile by address
   */
  getProfileByAddress(address: Address): Promise<UserProfile | null>;
  
  // ============ Channels ============
  
  /**
   * Get trending channels
   */
  getTrendingChannels(options?: { limit?: number }): Promise<Channel[]>;
  
  /**
   * Get channel by ID
   */
  getChannel(channelId: string): Promise<Channel | null>;
  
  /**
   * Search channels
   */
  searchChannels(query: string): Promise<Channel[]>;
  
  // ============ Streaming ============
  
  /**
   * Stream new posts in home feed
   */
  streamHomeFeed(): AsyncGenerator<Post>;
  
  /**
   * Stream posts in channel
   */
  streamChannel(channelId: string): AsyncGenerator<Post>;
  
  /**
   * Stream mentions
   */
  streamMentions(): AsyncGenerator<Post>;
  
  // ============ Notifications ============
  
  /**
   * Get notifications
   */
  getNotifications(options?: { limit?: number; cursor?: string }): Promise<{
    notifications: Notification[];
    nextCursor?: string;
  }>;
  
  /**
   * Stream notifications
   */
  streamNotifications(): AsyncGenerator<Notification>;
}

interface Notification {
  id: string;
  type: 'like' | 'repost' | 'reply' | 'mention' | 'follow';
  actor: PostAuthor;
  post?: Post;
  timestamp: number;
  read: boolean;
}

interface FarcasterSession {
  fid: number;
  signerKeyId: string;
}
```

### 2. Implementation

File: `packages/sdk/src/feed/implementation.ts`

```typescript
import { FarcasterProvider, type FarcasterSession as FCSession } from '@jejunetwork/oauth3/providers/farcaster';
import { FarcasterClient } from '@jejunetwork/farcaster/hub';
import type { FeedModule, Post, UserProfile, Channel, CreatePostParams } from './index';
import type { Address, Hex } from 'viem';

export function createFeedModule(
  wallet: JejuWallet,
  network: NetworkType,
): FeedModule {
  const farcasterProvider = new FarcasterProvider({
    hubUrl: network === 'mainnet'
      ? 'https://hub.jeju.network'
      : 'https://hub.testnet.jeju.network',
  });
  
  let farcasterSession: FCSession | null = null;
  
  // Converters
  const convertFCCastToPost = (cast: unknown): Post => {
    const c = cast as {
      hash: Hex;
      author: { fid: number; username?: string; displayName?: string; pfpUrl?: string };
      text: string;
      timestamp: number;
      embeds?: Array<{ url?: string }>;
      reactions?: { likes: number; recasts: number };
      replies?: number;
      parent?: { fid: number; hash: Hex };
      parentUrl?: string;
    };
    
    return {
      id: c.hash,
      platform: 'farcaster',
      author: {
        id: c.author.fid.toString(),
        username: c.author.username,
        displayName: c.author.displayName,
        avatarUrl: c.author.pfpUrl,
      },
      content: c.text,
      embeds: c.embeds?.filter((e): e is { url: string } => !!e.url).map(e => ({
        type: 'url' as const,
        url: e.url,
      })),
      reactions: {
        likes: c.reactions?.likes ?? 0,
        reposts: c.reactions?.recasts ?? 0,
        quotes: 0,
      },
      replies: c.replies ?? 0,
      timestamp: c.timestamp,
      hash: c.hash,
      replyTo: c.parent ? {
        id: c.parent.hash,
        author: { id: c.parent.fid.toString() },
      } : undefined,
      channel: c.parentUrl ? {
        id: c.parentUrl,
        name: c.parentUrl.split('/').pop() ?? '',
        url: c.parentUrl,
      } : undefined,
    };
  };
  
  return {
    async connectFarcaster(session) {
      farcasterSession = session as FCSession;
    },
    
    isFarcasterConnected() {
      return farcasterSession !== null;
    },
    
    getFarcasterSession() {
      return farcasterSession;
    },
    
    disconnectFarcaster() {
      farcasterSession = null;
    },
    
    async getHomeFeed(options) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      const result = await farcasterProvider.getHomeFeed(farcasterSession.fid, options);
      
      return {
        posts: result.casts.map(convertFCCastToPost),
        nextCursor: result.nextCursor,
      };
    },
    
    async getUserPosts(userId, options) {
      const fid = parseInt(userId);
      const result = await farcasterProvider.getCasts(fid, options);
      
      return {
        posts: result.casts.map(convertFCCastToPost),
        nextCursor: result.nextCursor,
      };
    },
    
    async getChannelFeed(channelId, options) {
      // Channel ID is the channel URL for Farcaster
      const result = await farcasterProvider.getChannelFeed(channelId, options);
      
      return {
        posts: result.casts.map(convertFCCastToPost),
        nextCursor: result.nextCursor,
      };
    },
    
    async getPost(postId) {
      // Post ID is the cast hash
      const hubClient = new FarcasterClient({
        hubUrl: farcasterProvider['config'].hubUrl!,
      });
      
      const cast = await hubClient.getCast(postId as Hex);
      if (!cast) return null;
      
      return convertFCCastToPost(cast);
    },
    
    async getReplies(postId, options) {
      const hubClient = new FarcasterClient({
        hubUrl: farcasterProvider['config'].hubUrl!,
      });
      
      const result = await hubClient.getReplies(postId as Hex, options);
      
      return {
        posts: result.casts.map(convertFCCastToPost),
        nextCursor: result.nextCursor,
      };
    },
    
    async search(query, options) {
      // Hub doesn't have native search - would need indexer
      // For now, return empty
      return { posts: [] };
    },
    
    async post(params) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      const result = await farcasterProvider.cast(
        farcasterSession,
        params.content,
        {
          embeds: params.embeds,
          channelUrl: params.channel,
        },
      );
      
      return {
        id: result.hash,
        platform: 'farcaster',
        author: {
          id: farcasterSession.fid.toString(),
        },
        content: params.content,
        reactions: { likes: 0, reposts: 0, quotes: 0 },
        replies: 0,
        timestamp: result.timestamp,
        hash: result.hash,
      };
    },
    
    async reply(postId, content, options) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      // Need to get parent cast to get FID
      const parentPost = await this.getPost(postId);
      if (!parentPost) {
        throw new Error('Parent post not found');
      }
      
      const result = await farcasterProvider.reply(
        farcasterSession,
        content,
        { fid: parseInt(parentPost.author.id), hash: postId as Hex },
        { embeds: options?.embeds },
      );
      
      return {
        id: result.hash,
        platform: 'farcaster',
        author: { id: farcasterSession.fid.toString() },
        content,
        replyTo: { id: postId, author: parentPost.author },
        reactions: { likes: 0, reposts: 0, quotes: 0 },
        replies: 0,
        timestamp: result.timestamp,
        hash: result.hash,
      };
    },
    
    async deletePost(postId) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      await farcasterProvider.deleteCast(farcasterSession, postId as Hex);
    },
    
    async like(postId) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      const post = await this.getPost(postId);
      if (!post) throw new Error('Post not found');
      
      await farcasterProvider.like(farcasterSession, {
        fid: parseInt(post.author.id),
        hash: postId as Hex,
      });
    },
    
    async unlike(postId) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      const post = await this.getPost(postId);
      if (!post) throw new Error('Post not found');
      
      await farcasterProvider.unlike(farcasterSession, {
        fid: parseInt(post.author.id),
        hash: postId as Hex,
      });
    },
    
    async repost(postId) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      const post = await this.getPost(postId);
      if (!post) throw new Error('Post not found');
      
      await farcasterProvider.recast(farcasterSession, {
        fid: parseInt(post.author.id),
        hash: postId as Hex,
      });
    },
    
    async unrepost(postId) {
      // Farcaster doesn't have unrecast via hub
      throw new Error('Unrepost not supported');
    },
    
    async quote(postId, content) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      const post = await this.getPost(postId);
      if (!post) throw new Error('Post not found');
      
      // Quote is a cast with embedded cast
      return this.post({
        content,
        embedPosts: [{ platform: 'farcaster', id: postId }],
      });
    },
    
    async follow(userId) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      await farcasterProvider.follow(farcasterSession, parseInt(userId));
    },
    
    async unfollow(userId) {
      if (!farcasterSession) {
        throw new Error('Not connected to Farcaster');
      }
      
      await farcasterProvider.unfollow(farcasterSession, parseInt(userId));
    },
    
    async getFollowers(userId, options) {
      const hubClient = new FarcasterClient({
        hubUrl: farcasterProvider['config'].hubUrl!,
      });
      
      const result = await hubClient.getFollowers(parseInt(userId), options);
      
      return {
        users: result.users.map((u: { fid: number; username?: string; displayName?: string; pfpUrl?: string; bio?: string }) => ({
          id: u.fid.toString(),
          platform: 'farcaster' as const,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.pfpUrl,
          bio: u.bio,
          followerCount: 0,
          followingCount: 0,
          postCount: 0,
        })),
        nextCursor: result.nextCursor,
      };
    },
    
    async getFollowing(userId, options) {
      const hubClient = new FarcasterClient({
        hubUrl: farcasterProvider['config'].hubUrl!,
      });
      
      const result = await hubClient.getFollowing(parseInt(userId), options);
      
      return {
        users: result.users.map((u: { fid: number; username?: string; displayName?: string; pfpUrl?: string; bio?: string }) => ({
          id: u.fid.toString(),
          platform: 'farcaster' as const,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.pfpUrl,
          bio: u.bio,
          followerCount: 0,
          followingCount: 0,
          postCount: 0,
        })),
        nextCursor: result.nextCursor,
      };
    },
    
    async getProfile(userId) {
      const profile = await farcasterProvider.getProfileByFid(parseInt(userId));
      if (!profile) return null;
      
      return {
        id: profile.fid.toString(),
        platform: 'farcaster',
        address: profile.custodyAddress,
        username: profile.username,
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.pfpUrl,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        postCount: 0,
      };
    },
    
    async getProfileByUsername(username) {
      const profile = await farcasterProvider.getProfileByUsername(username);
      if (!profile) return null;
      
      return {
        id: profile.fid.toString(),
        platform: 'farcaster',
        address: profile.custodyAddress,
        username: profile.username,
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.pfpUrl,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        postCount: 0,
      };
    },
    
    async getProfileByAddress(address) {
      const profile = await farcasterProvider.getProfileByAddress(address);
      if (!profile) return null;
      
      return {
        id: profile.fid.toString(),
        platform: 'farcaster',
        address: profile.custodyAddress,
        username: profile.username,
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.pfpUrl,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        postCount: 0,
      };
    },
    
    async getTrendingChannels(options) {
      // Would need indexer for trending
      return [];
    },
    
    async getChannel(channelId) {
      // Would need indexer
      return null;
    },
    
    async searchChannels(query) {
      // Would need indexer
      return [];
    },
    
    async *streamHomeFeed() {
      // Would need real-time hub subscription
      throw new Error('Streaming not implemented');
    },
    
    async *streamChannel(channelId) {
      throw new Error('Streaming not implemented');
    },
    
    async *streamMentions() {
      throw new Error('Streaming not implemented');
    },
    
    async getNotifications(options) {
      // Would need indexer tracking reactions/mentions
      return { notifications: [] };
    },
    
    async *streamNotifications() {
      throw new Error('Streaming not implemented');
    },
  };
}
```

## Acceptance Criteria

- [ ] FeedModule interface defined
- [ ] Farcaster implementation complete
- [ ] Post/reply/delete works
- [ ] Reactions work
- [ ] Follow/unfollow works
- [ ] Profile fetching works
- [ ] Feed fetching works

## Output Files

1. `packages/sdk/src/feed/index.ts`
2. `packages/sdk/src/feed/implementation.ts`
3. `packages/sdk/src/feed/react/hooks.ts`

## Commands

```bash
cd packages/sdk

# Run feed tests
bun test src/feed/*.test.ts

# Type check
bun run typecheck
```

