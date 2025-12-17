/**
 * @fileoverview Permissionless Farcaster Hub Client
 * 
 * Connects directly to Farcaster Hub (Hubble) nodes without API keys.
 * This is the permissionless alternative to Neynar.
 */

import type { Address, Hex } from 'viem';
import type {
  HubConfig,
  FarcasterProfile,
  FarcasterCast,
  FarcasterReaction,
  FarcasterLink,
  FarcasterVerification,
  UserData,
  UserDataType,
  HubInfoResponse,
  CastFilter,
  PaginatedResponse,
} from './types';

const DEFAULT_HUB_URL = 'nemes.farcaster.xyz:2283';
const DEFAULT_HTTP_URL = 'https://nemes.farcaster.xyz:2281';
const DEFAULT_TIMEOUT = 10000;

/**
 * Permissionless Farcaster Hub Client
 * 
 * @example
 * ```typescript
 * // Use self-hosted hub (recommended)
 * const client = new FarcasterClient({
 *   hubUrl: 'hub.jejunetwork.org:2283',
 * });
 * 
 * // Or use public hub
 * const client = new FarcasterClient();
 * 
 * const profile = await client.getProfile(123);
 * ```
 */
export class FarcasterClient {
  private hubUrl: string;
  private httpUrl: string;
  private timeoutMs: number;

  constructor(config: Partial<HubConfig> = {}) {
    this.hubUrl = config.hubUrl || DEFAULT_HUB_URL;
    this.httpUrl = config.httpUrl || this.deriveHttpUrl(this.hubUrl);
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
  }

  private deriveHttpUrl(hubUrl: string): string {
    // Convert gRPC URL to HTTP URL
    const [host] = hubUrl.split(':');
    return `http://${host}:2281`;
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, this.httpUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Hub request failed: ${response.status} ${response.statusText}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ============ Hub Info ============

  /**
   * Get hub info (version, sync status, stats)
   */
  async getHubInfo(): Promise<HubInfoResponse> {
    return this.fetch<HubInfoResponse>('/v1/info');
  }

  /**
   * Check if hub is syncing
   */
  async isSyncing(): Promise<boolean> {
    const info = await this.getHubInfo();
    return info.isSyncing;
  }

  // ============ Profiles ============

  /**
   * Get profile by FID
   */
  async getProfile(fid: number): Promise<FarcasterProfile> {
    const userData = await this.getUserDataByFid(fid);
    const verifications = await this.getVerificationsByFid(fid);

    const profile: FarcasterProfile = {
      fid,
      username: '',
      displayName: '',
      bio: '',
      pfpUrl: '',
      custodyAddress: '0x0' as Address,
      verifiedAddresses: [],
      followerCount: 0,
      followingCount: 0,
      registeredAt: 0,
    };

    // Parse user data
    for (const data of userData) {
      switch (data.type) {
        case 'username':
          profile.username = data.value;
          break;
        case 'display':
          profile.displayName = data.value;
          break;
        case 'bio':
          profile.bio = data.value;
          break;
        case 'pfp':
          profile.pfpUrl = data.value;
          break;
      }
      if (!profile.registeredAt || data.timestamp < profile.registeredAt) {
        profile.registeredAt = data.timestamp;
      }
    }

    // Add verified addresses
    profile.verifiedAddresses = verifications
      .filter((v) => v.protocol === 'ethereum')
      .map((v) => v.address);

    // Get follower/following counts
    const [followers, following] = await Promise.all([
      this.getLinksByTargetFid(fid),
      this.getLinksByFid(fid),
    ]);

    profile.followerCount = followers.messages.length;
    profile.followingCount = following.messages.length;

    return profile;
  }

  /**
   * Get profile by username
   */
  async getProfileByUsername(username: string): Promise<FarcasterProfile | null> {
    try {
      const response = await this.fetch<{ proofs: Array<{ fid: number }> }>(
        '/v1/userNameProofByName',
        { name: username }
      );
      if (response.proofs.length > 0) {
        return this.getProfile(response.proofs[0].fid);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get profile by verified address
   */
  async getProfileByVerifiedAddress(address: Address): Promise<FarcasterProfile | null> {
    try {
      const response = await this.fetch<{ 
        messages: Array<{ data: { fid: number } }> 
      }>('/v1/verificationsByFid', {
        address: address.toLowerCase(),
      });

      if (response.messages.length > 0) {
        return this.getProfile(response.messages[0].data.fid);
      }
      return null;
    } catch {
      return null;
    }
  }

  // ============ User Data ============

  /**
   * Get all user data for FID
   */
  async getUserDataByFid(fid: number): Promise<UserData[]> {
    const response = await this.fetch<{
      messages: Array<{
        data: {
          fid: number;
          timestamp: number;
          userDataBody: { type: string; value: string };
        };
      }>;
    }>('/v1/userDataByFid', { fid: fid.toString() });

    return response.messages.map((msg) => ({
      fid: msg.data.fid,
      type: this.parseUserDataType(msg.data.userDataBody.type),
      value: msg.data.userDataBody.value,
      timestamp: msg.data.timestamp,
    }));
  }

  private parseUserDataType(type: string): UserDataType {
    const typeMap: Record<string, UserDataType> = {
      USER_DATA_TYPE_PFP: 'pfp',
      USER_DATA_TYPE_DISPLAY: 'display',
      USER_DATA_TYPE_BIO: 'bio',
      USER_DATA_TYPE_URL: 'url',
      USER_DATA_TYPE_USERNAME: 'username',
      USER_DATA_TYPE_LOCATION: 'location',
    };
    return typeMap[type] || 'username';
  }

  // ============ Casts ============

  /**
   * Get casts by FID
   */
  async getCastsByFid(
    fid: number,
    options: CastFilter = {}
  ): Promise<PaginatedResponse<FarcasterCast>> {
    const params: Record<string, string> = {
      fid: fid.toString(),
    };
    if (options.pageSize) params.pageSize = options.pageSize.toString();
    if (options.pageToken) params.pageToken = options.pageToken;
    if (options.reverse) params.reverse = 'true';

    const response = await this.fetch<{
      messages: Array<{
        hash: string;
        data: {
          fid: number;
          timestamp: number;
          castAddBody: {
            text: string;
            parentCastId?: { fid: number; hash: string };
            parentUrl?: string;
            embeds: Array<{ url?: string; castId?: { fid: number; hash: string } }>;
            mentions: number[];
            mentionsPositions: number[];
          };
        };
      }>;
      nextPageToken?: string;
    }>('/v1/castsByFid', params);

    return {
      messages: response.messages.map((msg) => ({
        hash: msg.hash as Hex,
        fid: msg.data.fid,
        text: msg.data.castAddBody.text,
        timestamp: msg.data.timestamp,
        parentHash: msg.data.castAddBody.parentCastId?.hash as Hex | undefined,
        parentFid: msg.data.castAddBody.parentCastId?.fid,
        parentUrl: msg.data.castAddBody.parentUrl,
        embeds: msg.data.castAddBody.embeds.map((e) => ({
          url: e.url,
          castId: e.castId ? { fid: e.castId.fid, hash: e.castId.hash as Hex } : undefined,
        })),
        mentions: msg.data.castAddBody.mentions,
        mentionsPositions: msg.data.castAddBody.mentionsPositions,
      })),
      nextPageToken: response.nextPageToken,
    };
  }

  /**
   * Get casts by channel (parent URL)
   */
  async getCastsByChannel(
    channelUrl: string,
    options: CastFilter = {}
  ): Promise<PaginatedResponse<FarcasterCast>> {
    const params: Record<string, string> = {
      url: channelUrl,
    };
    if (options.pageSize) params.pageSize = options.pageSize.toString();
    if (options.pageToken) params.pageToken = options.pageToken;

    const response = await this.fetch<{
      messages: Array<{
        hash: string;
        data: {
          fid: number;
          timestamp: number;
          castAddBody: {
            text: string;
            parentUrl?: string;
            embeds: Array<{ url?: string }>;
            mentions: number[];
            mentionsPositions: number[];
          };
        };
      }>;
      nextPageToken?: string;
    }>('/v1/castsByParent', params);

    return {
      messages: response.messages.map((msg) => ({
        hash: msg.hash as Hex,
        fid: msg.data.fid,
        text: msg.data.castAddBody.text,
        timestamp: msg.data.timestamp,
        parentUrl: msg.data.castAddBody.parentUrl,
        embeds: msg.data.castAddBody.embeds.map((e) => ({ url: e.url })),
        mentions: msg.data.castAddBody.mentions,
        mentionsPositions: msg.data.castAddBody.mentionsPositions,
      })),
      nextPageToken: response.nextPageToken,
    };
  }

  /**
   * Get cast by hash
   */
  async getCast(fid: number, hash: Hex): Promise<FarcasterCast | null> {
    try {
      const response = await this.fetch<{
        data: {
          fid: number;
          timestamp: number;
          castAddBody: {
            text: string;
            parentCastId?: { fid: number; hash: string };
            parentUrl?: string;
            embeds: Array<{ url?: string }>;
            mentions: number[];
            mentionsPositions: number[];
          };
        };
        hash: string;
      }>('/v1/castById', { fid: fid.toString(), hash });

      return {
        hash: response.hash as Hex,
        fid: response.data.fid,
        text: response.data.castAddBody.text,
        timestamp: response.data.timestamp,
        parentHash: response.data.castAddBody.parentCastId?.hash as Hex | undefined,
        parentFid: response.data.castAddBody.parentCastId?.fid,
        parentUrl: response.data.castAddBody.parentUrl,
        embeds: response.data.castAddBody.embeds.map((e) => ({ url: e.url })),
        mentions: response.data.castAddBody.mentions,
        mentionsPositions: response.data.castAddBody.mentionsPositions,
      };
    } catch {
      return null;
    }
  }

  // ============ Reactions ============

  /**
   * Get reactions by FID
   */
  async getReactionsByFid(fid: number): Promise<PaginatedResponse<FarcasterReaction>> {
    const response = await this.fetch<{
      messages: Array<{
        data: {
          fid: number;
          timestamp: number;
          reactionBody: {
            type: string;
            targetCastId: { fid: number; hash: string };
          };
        };
      }>;
      nextPageToken?: string;
    }>('/v1/reactionsByFid', { fid: fid.toString() });

    return {
      messages: response.messages.map((msg) => ({
        fid: msg.data.fid,
        targetFid: msg.data.reactionBody.targetCastId.fid,
        targetHash: msg.data.reactionBody.targetCastId.hash as Hex,
        type: msg.data.reactionBody.type === 'REACTION_TYPE_LIKE' ? 'like' : 'recast',
        timestamp: msg.data.timestamp,
      })),
      nextPageToken: response.nextPageToken,
    };
  }

  // ============ Links (Follows) ============

  /**
   * Get links (follows) by FID
   */
  async getLinksByFid(fid: number): Promise<PaginatedResponse<FarcasterLink>> {
    const response = await this.fetch<{
      messages: Array<{
        data: {
          fid: number;
          timestamp: number;
          linkBody: { type: string; targetFid: number };
        };
      }>;
      nextPageToken?: string;
    }>('/v1/linksByFid', { fid: fid.toString() });

    return {
      messages: response.messages.map((msg) => ({
        fid: msg.data.fid,
        targetFid: msg.data.linkBody.targetFid,
        type: 'follow',
        timestamp: msg.data.timestamp,
      })),
      nextPageToken: response.nextPageToken,
    };
  }

  /**
   * Get followers (links targeting FID)
   */
  async getLinksByTargetFid(targetFid: number): Promise<PaginatedResponse<FarcasterLink>> {
    const response = await this.fetch<{
      messages: Array<{
        data: {
          fid: number;
          timestamp: number;
          linkBody: { type: string; targetFid: number };
        };
      }>;
      nextPageToken?: string;
    }>('/v1/linksByTargetFid', { target_fid: targetFid.toString() });

    return {
      messages: response.messages.map((msg) => ({
        fid: msg.data.fid,
        targetFid: msg.data.linkBody.targetFid,
        type: 'follow',
        timestamp: msg.data.timestamp,
      })),
      nextPageToken: response.nextPageToken,
    };
  }

  // ============ Verifications ============

  /**
   * Get verifications by FID
   */
  async getVerificationsByFid(fid: number): Promise<FarcasterVerification[]> {
    const response = await this.fetch<{
      messages: Array<{
        data: {
          fid: number;
          timestamp: number;
          verificationAddAddressBody: {
            address: string;
            protocol: string;
            chainId: number;
          };
        };
      }>;
    }>('/v1/verificationsByFid', { fid: fid.toString() });

    return response.messages.map((msg) => ({
      fid: msg.data.fid,
      address: msg.data.verificationAddAddressBody.address as Address,
      protocol:
        msg.data.verificationAddAddressBody.protocol === 'PROTOCOL_SOLANA'
          ? 'solana'
          : 'ethereum',
      timestamp: msg.data.timestamp,
      chainId: msg.data.verificationAddAddressBody.chainId,
    }));
  }

  // ============ Events ============

  /**
   * Subscribe to hub events (via HTTP long-polling)
   */
  async *subscribeToEvents(fromEventId?: number): AsyncGenerator<HubEvent> {
    let currentEventId = fromEventId || 0;

    while (true) {
      try {
        const response = await this.fetch<{
          events: Array<{
            id: number;
            type: string;
            body: Record<string, unknown>;
          }>;
        }>('/v1/events', {
          from_event_id: currentEventId.toString(),
        });

        for (const event of response.events) {
          currentEventId = event.id;
          yield {
            id: event.id,
            type: event.type as HubEventType,
            body: event.body,
          };
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        // Retry on error
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

export interface HubEvent {
  id: number;
  type: HubEventType;
  body: Record<string, unknown>;
}

export type HubEventType =
  | 'HUB_EVENT_TYPE_MERGE_MESSAGE'
  | 'HUB_EVENT_TYPE_PRUNE_MESSAGE'
  | 'HUB_EVENT_TYPE_REVOKE_MESSAGE'
  | 'HUB_EVENT_TYPE_MERGE_ID_REGISTRY_EVENT'
  | 'HUB_EVENT_TYPE_MERGE_NAME_REGISTRY_EVENT';

// Export singleton for convenience
export const farcasterClient = new FarcasterClient();

