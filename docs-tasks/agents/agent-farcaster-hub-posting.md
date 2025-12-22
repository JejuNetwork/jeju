# Agent Task: Farcaster Hub RPC Message Signing and Posting

## Priority: P0
## Estimated Time: 2-3 days
## Dependencies: packages/farcaster, packages/kms

## Objective

Implement direct Hub RPC posting for Farcaster, enabling casts, reactions, and other actions without relying on Neynar API. This allows fully permissionless Farcaster integration using self-hosted hubs.

## Background

Currently, Jeju can READ from Farcaster hubs directly but relies on Neynar API for WRITING. We need:
- Ed25519 message signing per Farcaster spec
- Direct Hub submitMessage RPC
- All message types (casts, reactions, links, verifications)
- Compatible with self-hosted Hubble

## Source Files to Analyze

- `packages/farcaster/src/hub/client.ts` - Current hub client
- `@farcaster/hub-nodejs` package - Reference implementation
- Farcaster protocol spec: https://github.com/farcasterxyz/protocol

## Implementation Tasks

### 1. Message Builder

File: `packages/farcaster/src/hub/message-builder.ts`

```typescript
/**
 * Farcaster Message Builder
 * 
 * Builds and signs messages per Farcaster protocol spec.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Address, Hex } from 'viem';

// Farcaster epoch: Jan 1, 2021 00:00:00 UTC
const FARCASTER_EPOCH = 1609459200;

// Message types
export enum MessageType {
  CAST_ADD = 1,
  CAST_REMOVE = 2,
  REACTION_ADD = 3,
  REACTION_REMOVE = 4,
  LINK_ADD = 5,
  LINK_REMOVE = 6,
  VERIFICATION_ADD_ETH_ADDRESS = 7,
  VERIFICATION_REMOVE = 8,
  USER_DATA_ADD = 11,
  FRAME_ACTION = 13,
}

export enum ReactionType {
  LIKE = 1,
  RECAST = 2,
}

export enum UserDataType {
  PFP = 1,
  DISPLAY = 2,
  BIO = 3,
  URL = 5,
  USERNAME = 6,
}

// Message data structures
export interface CastAddBody {
  text: string;
  embeds?: Array<{ url: string } | { castId: CastId }>;
  mentions?: number[];
  mentionsPositions?: number[];
  parentCastId?: CastId;
  parentUrl?: string;
}

export interface CastId {
  fid: number;
  hash: Uint8Array;
}

export interface ReactionBody {
  type: ReactionType;
  targetCastId?: CastId;
  targetUrl?: string;
}

export interface LinkBody {
  type: string; // 'follow'
  targetFid: number;
}

export interface UserDataBody {
  type: UserDataType;
  value: string;
}

export interface MessageData {
  type: MessageType;
  fid: number;
  timestamp: number;
  network: number; // 1 = mainnet, 2 = testnet
  castAddBody?: CastAddBody;
  castRemoveBody?: { targetHash: Uint8Array };
  reactionBody?: ReactionBody;
  linkBody?: LinkBody;
  userDataBody?: UserDataBody;
  verificationAddBody?: {
    address: Uint8Array;
    claimSignature: Uint8Array;
    blockHash: Uint8Array;
    verificationType: number;
    chainId: number;
    protocol: number;
  };
}

export interface Message {
  data: MessageData;
  hash: Uint8Array;
  hashScheme: number; // 1 = BLAKE3
  signature: Uint8Array;
  signatureScheme: number; // 1 = ED25519
  signer: Uint8Array;
}

/**
 * Get current Farcaster timestamp (seconds since Farcaster epoch)
 */
export function getFarcasterTimestamp(): number {
  return Math.floor(Date.now() / 1000) - FARCASTER_EPOCH;
}

/**
 * Encode message data for hashing
 */
export function encodeMessageData(data: MessageData): Uint8Array {
  // Use protobuf encoding per Farcaster spec
  // This is a simplified version - use actual protobuf in production
  const json = JSON.stringify({
    type: data.type,
    fid: data.fid,
    timestamp: data.timestamp,
    network: data.network,
    ...data.castAddBody && { castAddBody: data.castAddBody },
    ...data.reactionBody && { reactionBody: data.reactionBody },
    ...data.linkBody && { linkBody: data.linkBody },
    ...data.userDataBody && { userDataBody: data.userDataBody },
  });
  return new TextEncoder().encode(json);
}

/**
 * Hash message data with BLAKE3
 */
export function hashMessageData(data: MessageData): Uint8Array {
  const encoded = encodeMessageData(data);
  return blake3(encoded, { dkLen: 20 }); // Truncate to 20 bytes per spec
}

/**
 * Sign message hash with Ed25519
 */
export async function signMessageHash(
  hash: Uint8Array,
  signerPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  return ed25519.sign(hash, signerPrivateKey);
}

/**
 * Build a complete signed message
 */
export async function buildMessage(
  data: MessageData,
  signerPrivateKey: Uint8Array,
): Promise<Message> {
  const hash = hashMessageData(data);
  const signature = await signMessageHash(hash, signerPrivateKey);
  const signerPublicKey = ed25519.getPublicKey(signerPrivateKey);
  
  return {
    data,
    hash,
    hashScheme: 1, // BLAKE3
    signature,
    signatureScheme: 1, // ED25519
    signer: signerPublicKey,
  };
}

/**
 * Verify message signature
 */
export function verifyMessage(message: Message): boolean {
  return ed25519.verify(message.signature, message.hash, message.signer);
}
```

### 2. Cast Builder

File: `packages/farcaster/src/hub/cast-builder.ts`

```typescript
/**
 * Cast Builder - Convenience functions for building cast messages
 */

import {
  buildMessage,
  MessageType,
  getFarcasterTimestamp,
  type CastAddBody,
  type CastId,
  type Message,
} from './message-builder';

export interface CastOptions {
  /** Reply to this cast */
  replyTo?: { fid: number; hash: Hex };
  /** Reply in this channel (URL) */
  channelUrl?: string;
  /** Embed URLs */
  embeds?: string[];
  /** Embed casts */
  embedCasts?: Array<{ fid: number; hash: Hex }>;
  /** Mentioned FIDs */
  mentions?: number[];
  /** Positions of mentions in text */
  mentionPositions?: number[];
}

export class CastBuilder {
  constructor(
    private readonly fid: number,
    private readonly signerPrivateKey: Uint8Array,
    private readonly network: 'mainnet' | 'testnet' = 'mainnet',
  ) {}
  
  /**
   * Build a cast message
   */
  async buildCast(text: string, options?: CastOptions): Promise<Message> {
    // Validate text length (320 bytes max)
    const textBytes = new TextEncoder().encode(text);
    if (textBytes.length > 320) {
      throw new Error('Cast text exceeds 320 bytes');
    }
    
    const castAddBody: CastAddBody = {
      text,
      embeds: [],
      mentions: options?.mentions ?? [],
      mentionsPositions: options?.mentionPositions ?? [],
    };
    
    // Add URL embeds
    if (options?.embeds) {
      for (const url of options.embeds) {
        castAddBody.embeds!.push({ url });
      }
    }
    
    // Add cast embeds
    if (options?.embedCasts) {
      for (const embed of options.embedCasts) {
        castAddBody.embeds!.push({
          castId: {
            fid: embed.fid,
            hash: hexToBytes(embed.hash.slice(2)),
          },
        });
      }
    }
    
    // Set parent (reply)
    if (options?.replyTo) {
      castAddBody.parentCastId = {
        fid: options.replyTo.fid,
        hash: hexToBytes(options.replyTo.hash.slice(2)),
      };
    } else if (options?.channelUrl) {
      castAddBody.parentUrl = options.channelUrl;
    }
    
    return buildMessage(
      {
        type: MessageType.CAST_ADD,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network === 'mainnet' ? 1 : 2,
        castAddBody,
      },
      this.signerPrivateKey,
    );
  }
  
  /**
   * Build a delete cast message
   */
  async buildDeleteCast(targetHash: Hex): Promise<Message> {
    return buildMessage(
      {
        type: MessageType.CAST_REMOVE,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network === 'mainnet' ? 1 : 2,
        castRemoveBody: {
          targetHash: hexToBytes(targetHash.slice(2)),
        },
      },
      this.signerPrivateKey,
    );
  }
}
```

### 3. Hub Submitter

File: `packages/farcaster/src/hub/submitter.ts`

```typescript
/**
 * Hub Message Submitter
 * 
 * Submits signed messages to Farcaster hubs via HTTP API.
 */

import type { Message } from './message-builder';

export interface HubSubmitterConfig {
  /** Hub HTTP API URL */
  hubUrl: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

export interface SubmitResult {
  success: boolean;
  hash?: string;
  error?: string;
  details?: unknown;
}

export class HubSubmitter {
  private readonly hubUrl: string;
  private readonly timeout: number;
  
  constructor(config: HubSubmitterConfig) {
    this.hubUrl = config.hubUrl.replace(/\/$/, '');
    this.timeout = config.timeoutMs ?? 10000;
  }
  
  /**
   * Submit a message to the hub
   */
  async submit(message: Message): Promise<SubmitResult> {
    const encoded = this.encodeMessage(message);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(`${this.hubUrl}/v1/submitMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: encoded,
        signal: controller.signal,
      });
      
      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Hub rejected message: ${response.status}`,
          details: error,
        };
      }
      
      const result = await response.json();
      
      return {
        success: true,
        hash: bytesToHex(message.hash),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  
  /**
   * Submit multiple messages
   */
  async submitBatch(messages: Message[]): Promise<SubmitResult[]> {
    return Promise.all(messages.map(msg => this.submit(msg)));
  }
  
  /**
   * Encode message for submission (protobuf)
   */
  private encodeMessage(message: Message): Uint8Array {
    // In production, use proper protobuf encoding
    // For now, use JSON (some hubs accept this)
    const json = JSON.stringify({
      data: message.data,
      hash: bytesToHex(message.hash),
      hashScheme: message.hashScheme,
      signature: bytesToHex(message.signature),
      signatureScheme: message.signatureScheme,
      signer: bytesToHex(message.signer),
    });
    return new TextEncoder().encode(json);
  }
}
```

### 4. High-Level Poster API

File: `packages/farcaster/src/hub/poster.ts`

```typescript
/**
 * Farcaster Poster
 * 
 * High-level API for posting to Farcaster via direct hub RPC.
 */

import { CastBuilder, type CastOptions } from './cast-builder';
import { HubSubmitter, type SubmitResult } from './submitter';
import {
  buildMessage,
  MessageType,
  ReactionType,
  getFarcasterTimestamp,
  type Message,
} from './message-builder';
import type { Hex } from 'viem';

export interface FarcasterPosterConfig {
  fid: number;
  signerPrivateKey: Uint8Array;
  hubUrl: string;
  network?: 'mainnet' | 'testnet';
}

export interface PostedCast {
  hash: Hex;
  fid: number;
  text: string;
  timestamp: number;
}

export class FarcasterPoster {
  private readonly castBuilder: CastBuilder;
  private readonly submitter: HubSubmitter;
  private readonly fid: number;
  private readonly signerPrivateKey: Uint8Array;
  private readonly network: 'mainnet' | 'testnet';
  
  constructor(config: FarcasterPosterConfig) {
    this.fid = config.fid;
    this.signerPrivateKey = config.signerPrivateKey;
    this.network = config.network ?? 'mainnet';
    
    this.castBuilder = new CastBuilder(
      config.fid,
      config.signerPrivateKey,
      this.network,
    );
    
    this.submitter = new HubSubmitter({
      hubUrl: config.hubUrl,
    });
  }
  
  /**
   * Post a cast
   */
  async cast(text: string, options?: CastOptions): Promise<PostedCast> {
    const message = await this.castBuilder.buildCast(text, options);
    const result = await this.submitter.submit(message);
    
    if (!result.success) {
      throw new Error(`Failed to post cast: ${result.error}`);
    }
    
    return {
      hash: `0x${result.hash}` as Hex,
      fid: this.fid,
      text,
      timestamp: message.data.timestamp,
    };
  }
  
  /**
   * Reply to a cast
   */
  async reply(
    text: string,
    replyTo: { fid: number; hash: Hex },
    options?: Omit<CastOptions, 'replyTo'>,
  ): Promise<PostedCast> {
    return this.cast(text, { ...options, replyTo });
  }
  
  /**
   * Delete a cast
   */
  async deleteCast(targetHash: Hex): Promise<void> {
    const message = await this.castBuilder.buildDeleteCast(targetHash);
    const result = await this.submitter.submit(message);
    
    if (!result.success) {
      throw new Error(`Failed to delete cast: ${result.error}`);
    }
  }
  
  /**
   * Like a cast
   */
  async like(target: { fid: number; hash: Hex }): Promise<void> {
    const message = await buildMessage(
      {
        type: MessageType.REACTION_ADD,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network === 'mainnet' ? 1 : 2,
        reactionBody: {
          type: ReactionType.LIKE,
          targetCastId: {
            fid: target.fid,
            hash: hexToBytes(target.hash.slice(2)),
          },
        },
      },
      this.signerPrivateKey,
    );
    
    const result = await this.submitter.submit(message);
    if (!result.success) {
      throw new Error(`Failed to like: ${result.error}`);
    }
  }
  
  /**
   * Recast
   */
  async recast(target: { fid: number; hash: Hex }): Promise<void> {
    const message = await buildMessage(
      {
        type: MessageType.REACTION_ADD,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network === 'mainnet' ? 1 : 2,
        reactionBody: {
          type: ReactionType.RECAST,
          targetCastId: {
            fid: target.fid,
            hash: hexToBytes(target.hash.slice(2)),
          },
        },
      },
      this.signerPrivateKey,
    );
    
    const result = await this.submitter.submit(message);
    if (!result.success) {
      throw new Error(`Failed to recast: ${result.error}`);
    }
  }
  
  /**
   * Follow a user
   */
  async follow(targetFid: number): Promise<void> {
    const message = await buildMessage(
      {
        type: MessageType.LINK_ADD,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network === 'mainnet' ? 1 : 2,
        linkBody: {
          type: 'follow',
          targetFid,
        },
      },
      this.signerPrivateKey,
    );
    
    const result = await this.submitter.submit(message);
    if (!result.success) {
      throw new Error(`Failed to follow: ${result.error}`);
    }
  }
  
  /**
   * Unfollow a user
   */
  async unfollow(targetFid: number): Promise<void> {
    const message = await buildMessage(
      {
        type: MessageType.LINK_REMOVE,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network === 'mainnet' ? 1 : 2,
        linkBody: {
          type: 'follow',
          targetFid,
        },
      },
      this.signerPrivateKey,
    );
    
    const result = await this.submitter.submit(message);
    if (!result.success) {
      throw new Error(`Failed to unfollow: ${result.error}`);
    }
  }
}
```

### 5. Export Updates

File: `packages/farcaster/src/index.ts`

```typescript
// Existing exports
export * from './hub/client';
export * from './hub/types';
export * from './hub/schemas';
export * from './identity/link';
export * from './frames/types';

// New posting exports
export * from './hub/message-builder';
export * from './hub/cast-builder';
export * from './hub/submitter';
export * from './hub/poster';
```

## Testing

File: `packages/farcaster/src/__tests__/poster.test.ts`

```typescript
import { describe, test, expect, beforeAll } from 'bun:test';
import { FarcasterPoster } from '../hub/poster';
import { ed25519 } from '@noble/curves/ed25519';

describe('FarcasterPoster', () => {
  let poster: FarcasterPoster;
  let signerPrivateKey: Uint8Array;
  
  beforeAll(() => {
    // Generate test signer key
    signerPrivateKey = ed25519.utils.randomPrivateKey();
    
    poster = new FarcasterPoster({
      fid: 12345, // Test FID
      signerPrivateKey,
      hubUrl: 'http://localhost:2281', // Local hub for testing
      network: 'testnet',
    });
  });
  
  test('builds valid cast message', async () => {
    const message = await poster['castBuilder'].buildCast('Hello, Farcaster!');
    
    expect(message.data.type).toBe(1); // CAST_ADD
    expect(message.data.fid).toBe(12345);
    expect(message.data.castAddBody?.text).toBe('Hello, Farcaster!');
    expect(message.hash.length).toBe(20);
    expect(message.signature.length).toBe(64);
  });
  
  test('builds reply message', async () => {
    const message = await poster['castBuilder'].buildCast('This is a reply', {
      replyTo: { fid: 1234, hash: '0x' + '00'.repeat(20) as Hex },
    });
    
    expect(message.data.castAddBody?.parentCastId).toBeDefined();
    expect(message.data.castAddBody?.parentCastId?.fid).toBe(1234);
  });
  
  test('builds reaction message', async () => {
    // This tests the internal message building
    // Actual submission would require a real hub
  });
});
```

## Acceptance Criteria

- [ ] Can build and sign cast messages
- [ ] Can build and sign reaction messages
- [ ] Can build and sign link messages
- [ ] Can submit messages to hub HTTP API
- [ ] Message format matches Farcaster spec
- [ ] Works with self-hosted Hubble
- [ ] All tests pass

## Output Files

1. `packages/farcaster/src/hub/message-builder.ts`
2. `packages/farcaster/src/hub/cast-builder.ts`
3. `packages/farcaster/src/hub/submitter.ts`
4. `packages/farcaster/src/hub/poster.ts`
5. `packages/farcaster/src/__tests__/poster.test.ts`

## Commands

```bash
cd packages/farcaster

# Install dependencies (if not already)
bun add @noble/curves @noble/hashes

# Run tests
bun test

# Type check
bun run typecheck
```

