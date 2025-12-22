# Agent Task: OAuth3 Farcaster Provider with Posting

## Priority: P0
## Estimated Time: 2 days
## Dependencies: agent-farcaster-hub-posting, agent-farcaster-signer-kms

## Objective

Update the OAuth3 Farcaster provider to support full posting capabilities via direct hub RPC, enabling authenticated Farcaster actions without Neynar dependency.

## Source Files to Analyze

- `packages/oauth3/src/providers/farcaster.ts` - Current provider
- `packages/farcaster/src/hub/poster.ts` - Hub posting
- `packages/farcaster/src/signer/service.ts` - Signer management
- `packages/shared/src/auth/siwf.ts` - SIWF utilities

## Implementation Tasks

### 1. Update Farcaster Provider

File: `packages/oauth3/src/providers/farcaster.ts` (complete rewrite)

```typescript
/**
 * Farcaster OAuth3 Provider
 * 
 * Full Farcaster integration with:
 * - Sign In With Farcaster (SIWF)
 * - Profile management
 * - Direct hub posting
 * - Frame validation
 */

import { FarcasterClient } from '@jejunetwork/farcaster/hub';
import { FarcasterPoster, type CastOptions } from '@jejunetwork/farcaster/hub/poster';
import { FarcasterSignerService, type SignerInfo } from '@jejunetwork/farcaster/signer';
import {
  verifySIWFMessage,
  createSIWFMessage,
  type SIWFMessage,
} from '@jejunetwork/shared/auth/siwf';
import type { Address, Hex } from 'viem';

// ============ Types ============

export interface FarcasterProfile {
  fid: number;
  username?: string;
  displayName?: string;
  bio?: string;
  pfpUrl?: string;
  followerCount: number;
  followingCount: number;
  verifications: Address[];
  custodyAddress: Address;
}

export interface FarcasterSession {
  fid: number;
  profile: FarcasterProfile;
  signerKeyId: string;
  signerPublicKey: Hex;
  expiresAt?: number;
}

export interface AuthChannelResult {
  channelToken: string;
  url: string;
  connectUri: string;
  expiresAt: number;
}

export interface PostedCast {
  hash: Hex;
  fid: number;
  text: string;
  timestamp: number;
  embeds?: string[];
  parentHash?: Hex;
  parentUrl?: string;
}

// ============ Provider ============

export interface FarcasterProviderConfig {
  hubUrl?: string;
  hubFallbackUrls?: string[];
  kmsEndpoint?: string;
  appName?: string;
  appFid?: number;
}

export class FarcasterProvider {
  private hubClient: FarcasterClient;
  private signerService: FarcasterSignerService;
  private posters: Map<number, FarcasterPoster> = new Map();
  private config: FarcasterProviderConfig;
  
  constructor(config?: FarcasterProviderConfig) {
    this.config = config ?? {};
    
    this.hubClient = new FarcasterClient({
      hubUrl: config?.hubUrl ?? 'https://hub.jeju.network',
      fallbackUrls: config?.hubFallbackUrls,
    });
    
    this.signerService = new FarcasterSignerService({
      kmsEndpoint: config?.kmsEndpoint,
      rpcUrl: 'https://mainnet.optimism.io',
    });
  }
  
  // ============ Authentication ============
  
  /**
   * Create SIWF auth channel (for QR code / deep link auth)
   */
  async createAuthChannel(): Promise<AuthChannelResult> {
    const channelToken = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    
    // Generate Warpcast auth URL
    const params = new URLSearchParams({
      channelToken,
      nonce: crypto.randomUUID(),
      notBefore: new Date().toISOString(),
      expirationTime: new Date(expiresAt).toISOString(),
    });
    
    const connectUri = `https://warpcast.com/~/siwf?${params.toString()}`;
    
    return {
      channelToken,
      url: connectUri,
      connectUri,
      expiresAt,
    };
  }
  
  /**
   * Poll auth channel for completion
   */
  async pollAuthChannel(channelToken: string): Promise<FarcasterSession | null> {
    // Poll Warpcast for auth result
    const response = await fetch(
      `https://api.warpcast.com/v2/siwf/result?channelToken=${channelToken}`,
    );
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (!data.result?.fid) {
      return null;
    }
    
    // Create signer for this FID
    const signerResult = await this.signerService.createSigner({
      fid: data.result.fid,
      appName: this.config.appName ?? 'Jeju Network',
      appFid: this.config.appFid,
    });
    
    // Get profile
    const profile = await this.getProfileByFid(data.result.fid);
    if (!profile) {
      throw new Error('Failed to fetch profile');
    }
    
    return {
      fid: data.result.fid,
      profile,
      signerKeyId: signerResult.signer.keyId,
      signerPublicKey: signerResult.signer.publicKey,
    };
  }
  
  /**
   * Verify SIWF message signature
   */
  async verifySIWF(message: SIWFMessage, signature: Hex): Promise<{
    valid: boolean;
    fid?: number;
    address?: Address;
  }> {
    return verifySIWFMessage(message, signature, this.hubClient);
  }
  
  // ============ Profile ============
  
  /**
   * Get profile by FID
   */
  async getProfileByFid(fid: number): Promise<FarcasterProfile | null> {
    const userData = await this.hubClient.getUserDataByFid(fid);
    if (!userData) return null;
    
    const verifications = await this.hubClient.getVerificationsByFid(fid);
    const custody = await this.hubClient.getCustodyAddress(fid);
    
    return {
      fid,
      username: userData.username,
      displayName: userData.displayName,
      bio: userData.bio,
      pfpUrl: userData.pfpUrl,
      followerCount: userData.followerCount ?? 0,
      followingCount: userData.followingCount ?? 0,
      verifications: verifications?.map(v => v.address as Address) ?? [],
      custodyAddress: custody!,
    };
  }
  
  /**
   * Get profile by username
   */
  async getProfileByUsername(username: string): Promise<FarcasterProfile | null> {
    const fid = await this.hubClient.getFidByUsername(username);
    if (!fid) return null;
    return this.getProfileByFid(fid);
  }
  
  /**
   * Get profile by verified address
   */
  async getProfileByAddress(address: Address): Promise<FarcasterProfile | null> {
    const fid = await this.hubClient.getFidByVerification(address);
    if (!fid) return null;
    return this.getProfileByFid(fid);
  }
  
  // ============ Posting ============
  
  /**
   * Get or create poster for FID
   */
  private async getPoster(fid: number): Promise<FarcasterPoster> {
    if (this.posters.has(fid)) {
      return this.posters.get(fid)!;
    }
    
    const signer = await this.signerService.getSignerForPosting(fid);
    if (!signer) {
      throw new Error(`No active signer for FID ${fid}`);
    }
    
    const poster = new FarcasterPoster({
      fid,
      hubUrl: this.config.hubUrl ?? 'https://hub.jeju.network',
      signerService: this.signerService,
    });
    
    this.posters.set(fid, poster);
    return poster;
  }
  
  /**
   * Post a cast
   */
  async cast(
    session: FarcasterSession,
    text: string,
    options?: CastOptions,
  ): Promise<PostedCast> {
    const poster = await this.getPoster(session.fid);
    const result = await poster.cast(text, options);
    
    return {
      hash: result.hash,
      fid: session.fid,
      text,
      timestamp: result.timestamp,
      embeds: options?.embeds,
      parentUrl: options?.channelUrl,
    };
  }
  
  /**
   * Reply to a cast
   */
  async reply(
    session: FarcasterSession,
    text: string,
    replyTo: { fid: number; hash: Hex },
    options?: Omit<CastOptions, 'replyTo'>,
  ): Promise<PostedCast> {
    const poster = await this.getPoster(session.fid);
    const result = await poster.reply(text, replyTo, options);
    
    return {
      hash: result.hash,
      fid: session.fid,
      text,
      timestamp: result.timestamp,
      parentHash: replyTo.hash,
    };
  }
  
  /**
   * Delete a cast
   */
  async deleteCast(session: FarcasterSession, castHash: Hex): Promise<void> {
    const poster = await this.getPoster(session.fid);
    await poster.deleteCast(castHash);
  }
  
  /**
   * Like a cast
   */
  async like(session: FarcasterSession, cast: { fid: number; hash: Hex }): Promise<void> {
    const poster = await this.getPoster(session.fid);
    await poster.like(cast);
  }
  
  /**
   * Unlike a cast
   */
  async unlike(session: FarcasterSession, cast: { fid: number; hash: Hex }): Promise<void> {
    const poster = await this.getPoster(session.fid);
    await poster.unlike(cast);
  }
  
  /**
   * Recast
   */
  async recast(session: FarcasterSession, cast: { fid: number; hash: Hex }): Promise<void> {
    const poster = await this.getPoster(session.fid);
    await poster.recast(cast);
  }
  
  /**
   * Follow a user
   */
  async follow(session: FarcasterSession, targetFid: number): Promise<void> {
    const poster = await this.getPoster(session.fid);
    await poster.follow(targetFid);
  }
  
  /**
   * Unfollow a user
   */
  async unfollow(session: FarcasterSession, targetFid: number): Promise<void> {
    const poster = await this.getPoster(session.fid);
    await poster.unfollow(targetFid);
  }
  
  // ============ Feed ============
  
  /**
   * Get user's casts
   */
  async getCasts(fid: number, options?: { limit?: number; cursor?: string }): Promise<{
    casts: Cast[];
    nextCursor?: string;
  }> {
    return this.hubClient.getCastsByFid(fid, options);
  }
  
  /**
   * Get home feed (casts from followed users)
   */
  async getHomeFeed(fid: number, options?: { limit?: number; cursor?: string }): Promise<{
    casts: Cast[];
    nextCursor?: string;
  }> {
    // Get following list
    const following = await this.hubClient.getFollowing(fid);
    
    // Get casts from all followed users
    const castPromises = following.map(f => 
      this.hubClient.getCastsByFid(f.fid, { limit: 10 })
    );
    
    const results = await Promise.all(castPromises);
    
    // Merge and sort by timestamp
    const allCasts = results.flatMap(r => r.casts)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    const limit = options?.limit ?? 50;
    
    return {
      casts: allCasts.slice(0, limit),
    };
  }
  
  /**
   * Get channel feed
   */
  async getChannelFeed(channelUrl: string, options?: { limit?: number; cursor?: string }): Promise<{
    casts: Cast[];
    nextCursor?: string;
  }> {
    return this.hubClient.getCastsByParent(channelUrl, options);
  }
  
  // ============ Frames ============
  
  /**
   * Validate frame action signature
   */
  async validateFrameAction(payload: FrameActionPayload): Promise<{
    valid: boolean;
    fid?: number;
    buttonIndex?: number;
  }> {
    try {
      const response = await fetch(
        `${this.config.hubUrl}/v1/validateMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: Buffer.from(payload.trustedData.messageBytes, 'hex'),
        }
      );
      
      if (!response.ok) {
        return { valid: false };
      }
      
      const result = await response.json();
      
      return {
        valid: result.valid === true,
        fid: result.message?.data?.fid,
        buttonIndex: result.message?.data?.frameActionBody?.buttonIndex,
      };
    } catch {
      return { valid: false };
    }
  }
  
  // ============ Signer Management ============
  
  /**
   * Create new signer for FID
   */
  async createSigner(fid: number): Promise<{
    signer: SignerInfo;
    approvalLink: string;
  }> {
    return this.signerService.createSigner({
      fid,
      appName: this.config.appName ?? 'Jeju Network',
      appFid: this.config.appFid,
    });
  }
  
  /**
   * Get signers for FID
   */
  async getSigners(fid: number): Promise<SignerInfo[]> {
    return this.signerService.listSigners(fid);
  }
  
  /**
   * Sync signer status from chain
   */
  async syncSignerStatus(keyId: string): Promise<SignerInfo> {
    return this.signerService.syncSignerStatus(keyId);
  }
}

// ============ Types ============

interface Cast {
  hash: Hex;
  fid: number;
  text: string;
  timestamp: number;
  embeds: Array<{ url: string } | { castId: { fid: number; hash: Hex } }>;
  mentions: number[];
  parentHash?: Hex;
  parentUrl?: string;
  reactions: { likes: number; recasts: number };
  replies: number;
}

interface FrameActionPayload {
  untrustedData: {
    fid: number;
    buttonIndex: number;
    inputText?: string;
    castId: { fid: number; hash: string };
    state?: string;
  };
  trustedData: {
    messageBytes: string;
  };
}

// ============ Export ============

export const farcasterProvider = new FarcasterProvider();
```

### 2. React Hooks

File: `packages/oauth3/src/react/hooks/useFarcaster.ts`

```typescript
import { useState, useCallback, useEffect } from 'react';
import {
  FarcasterProvider,
  type FarcasterSession,
  type FarcasterProfile,
  type PostedCast,
  type CastOptions,
} from '../../providers/farcaster';

const provider = new FarcasterProvider();

export function useFarcasterAuth() {
  const [session, setSession] = useState<FarcasterSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [authChannel, setAuthChannel] = useState<{
    url: string;
    channelToken: string;
  } | null>(null);
  
  const startAuth = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const channel = await provider.createAuthChannel();
      setAuthChannel({ url: channel.connectUri, channelToken: channel.channelToken });
      
      // Start polling
      const pollInterval = setInterval(async () => {
        const result = await provider.pollAuthChannel(channel.channelToken);
        if (result) {
          clearInterval(pollInterval);
          setSession(result);
          setAuthChannel(null);
          setLoading(false);
        }
      }, 2000);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (!session) {
          setLoading(false);
          setError(new Error('Auth timeout'));
          setAuthChannel(null);
        }
      }, 5 * 60 * 1000);
    } catch (err) {
      setError(err as Error);
      setLoading(false);
    }
  }, [session]);
  
  const signOut = useCallback(() => {
    setSession(null);
  }, []);
  
  return {
    session,
    loading,
    error,
    authChannel,
    startAuth,
    signOut,
    isAuthenticated: !!session,
  };
}

export function useFarcasterPosting(session: FarcasterSession | null) {
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const cast = useCallback(async (
    text: string,
    options?: CastOptions,
  ): Promise<PostedCast | null> => {
    if (!session) {
      setError(new Error('Not authenticated'));
      return null;
    }
    
    setPosting(true);
    setError(null);
    
    try {
      const result = await provider.cast(session, text, options);
      return result;
    } catch (err) {
      setError(err as Error);
      return null;
    } finally {
      setPosting(false);
    }
  }, [session]);
  
  const reply = useCallback(async (
    text: string,
    replyTo: { fid: number; hash: Hex },
  ): Promise<PostedCast | null> => {
    if (!session) return null;
    
    setPosting(true);
    try {
      return await provider.reply(session, text, replyTo);
    } catch (err) {
      setError(err as Error);
      return null;
    } finally {
      setPosting(false);
    }
  }, [session]);
  
  const like = useCallback(async (cast: { fid: number; hash: Hex }) => {
    if (!session) return;
    await provider.like(session, cast);
  }, [session]);
  
  const recast = useCallback(async (cast: { fid: number; hash: Hex }) => {
    if (!session) return;
    await provider.recast(session, cast);
  }, [session]);
  
  const follow = useCallback(async (targetFid: number) => {
    if (!session) return;
    await provider.follow(session, targetFid);
  }, [session]);
  
  return {
    cast,
    reply,
    like,
    recast,
    follow,
    posting,
    error,
  };
}

export function useFarcasterProfile(fidOrUsername: number | string) {
  const [profile, setProfile] = useState<FarcasterProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      try {
        const result = typeof fidOrUsername === 'number'
          ? await provider.getProfileByFid(fidOrUsername)
          : await provider.getProfileByUsername(fidOrUsername);
        setProfile(result);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchProfile();
  }, [fidOrUsername]);
  
  return { profile, loading, error };
}
```

## Acceptance Criteria

- [ ] SIWF authentication works
- [ ] Profile fetching works
- [ ] Cast posting via hub works
- [ ] Reactions (like, recast) work
- [ ] Following/unfollowing works
- [ ] Frame validation works
- [ ] React hooks provided
- [ ] No Neynar dependency for core features

## Output Files

1. `packages/oauth3/src/providers/farcaster.ts` (rewrite)
2. `packages/oauth3/src/react/hooks/useFarcaster.ts`
3. `packages/oauth3/src/react/components/FarcasterAuth.tsx`

## Testing

```typescript
describe('FarcasterProvider', () => {
  test('creates auth channel');
  test('fetches profile by FID');
  test('posts cast via hub');
  test('validates frame action');
  test('manages signers');
});
```

## Commands

```bash
cd packages/oauth3

# Run tests
bun test src/providers/farcaster.test.ts

# Type check
bun run typecheck
```

