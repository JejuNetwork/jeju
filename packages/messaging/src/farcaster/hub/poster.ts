/**
 * Farcaster Poster
 *
 * High-level API for posting to Farcaster via direct hub RPC.
 * Supports casts, reactions, links, and user data updates.
 */

import type { Hex } from 'viem'
import { CastBuilder, type CastOptions } from './cast-builder'
import {
  buildMessage,
  createCastId,
  type FarcasterNetwork,
  getFarcasterTimestamp,
  hexToMessageBytes,
  MessageType,
  ReactionType,
  UserDataType,
} from './message-builder'
import {
  FailoverHubSubmitter,
  type HubEndpoint,
  HubSubmitter,
} from './submitter'
export interface FarcasterPosterConfig {
  /** Farcaster ID */
  fid: number
  /** Ed25519 signer private key (32 bytes) */
  signerPrivateKey: Uint8Array
  /** Hub URL for message submission */
  hubUrl: string
  /** Optional fallback hub URLs */
  fallbackHubUrls?: string[]
  /** Network (mainnet, testnet, devnet) */
  network?: 'mainnet' | 'testnet' | 'devnet'
  /** Request timeout in ms */
  timeoutMs?: number
}

export interface PostedCast {
  hash: Hex
  fid: number
  text: string
  timestamp: number
}

export interface ReactionTarget {
  fid: number
  hash: Hex
}

export interface UserDataUpdate {
  type: 'pfp' | 'display' | 'bio' | 'url' | 'username'
  value: string
}
export class FarcasterPoster {
  private readonly castBuilder: CastBuilder
  private readonly submitter: HubSubmitter | FailoverHubSubmitter
  private readonly fid: number
  private readonly signerPrivateKey: Uint8Array
  private readonly network: FarcasterNetwork

  constructor(config: FarcasterPosterConfig) {
    this.fid = config.fid
    this.signerPrivateKey = config.signerPrivateKey
    this.network =
      config.network === 'testnet' ? 2 : config.network === 'devnet' ? 3 : 1

    this.castBuilder = new CastBuilder({
      fid: config.fid,
      signerPrivateKey: config.signerPrivateKey,
      network: config.network,
    })

    // Use failover submitter if fallback URLs provided
    if (config.fallbackHubUrls && config.fallbackHubUrls.length > 0) {
      const hubs: HubEndpoint[] = [
        { url: config.hubUrl, priority: 0 },
        ...config.fallbackHubUrls.map((url, i) => ({ url, priority: i + 1 })),
      ]
      this.submitter = new FailoverHubSubmitter(hubs, config.timeoutMs)
    } else {
      this.submitter = new HubSubmitter({
        hubUrl: config.hubUrl,
        timeoutMs: config.timeoutMs,
      })
    }
  }
  /**
   * Post a cast
   */
  async cast(text: string, options?: CastOptions): Promise<PostedCast> {
    const message = await this.castBuilder.buildCast(text, options)
    const result = await this.submitter.submit(message)

    if (!result.success) {
      throw new Error(
        `Failed to post cast: ${result.error}${result.details ? ` - ${result.details}` : ''}`,
      )
    }

    return {
      hash: result.hash as Hex,
      fid: this.fid,
      text,
      timestamp: message.data.timestamp,
    }
  }

  /**
   * Reply to a cast
   */
  async reply(
    text: string,
    replyTo: ReactionTarget,
    options?: Omit<CastOptions, 'replyTo'>,
  ): Promise<PostedCast> {
    return this.cast(text, { ...options, replyTo })
  }

  /**
   * Post a cast in a channel
   */
  async castToChannel(
    text: string,
    channelUrl: string,
    options?: Omit<CastOptions, 'channelUrl'>,
  ): Promise<PostedCast> {
    return this.cast(text, { ...options, channelUrl })
  }

  /**
   * Post a thread (multiple connected casts)
   */
  async thread(
    texts: string[],
    options?: { channelUrl?: string; embeds?: string[] },
  ): Promise<PostedCast[]> {
    const messages = await this.castBuilder.buildThread(texts, options)
    const postedCasts: PostedCast[] = []

    for (let i = 0; i < messages.length; i++) {
      const result = await this.submitter.submit(messages[i])

      if (!result.success) {
        throw new Error(
          `Failed to post cast ${i + 1}/${texts.length}: ${result.error}`,
        )
      }

      postedCasts.push({
        hash: result.hash as Hex,
        fid: this.fid,
        text: texts[i],
        timestamp: messages[i].data.timestamp,
      })
    }

    return postedCasts
  }

  /**
   * Quote a cast (cast with embedded cast)
   */
  async quote(text: string, quotedCast: ReactionTarget): Promise<PostedCast> {
    return this.cast(text, { embedCasts: [quotedCast] })
  }

  /**
   * Delete a cast
   */
  async deleteCast(targetHash: Hex): Promise<void> {
    const message = await this.castBuilder.buildDeleteCast(targetHash)
    const result = await this.submitter.submit(message)

    if (!result.success) {
      throw new Error(`Failed to delete cast: ${result.error}`)
    }
  }
  /**
   * Like a cast
   */
  async like(target: ReactionTarget): Promise<void> {
    await this.addReaction(ReactionType.LIKE, target)
  }

  /**
   * Unlike a cast
   */
  async unlike(target: ReactionTarget): Promise<void> {
    await this.removeReaction(ReactionType.LIKE, target)
  }

  /**
   * Recast (repost) a cast
   */
  async recast(target: ReactionTarget): Promise<void> {
    await this.addReaction(ReactionType.RECAST, target)
  }

  /**
   * Unrecast a cast
   */
  async unrecast(target: ReactionTarget): Promise<void> {
    await this.removeReaction(ReactionType.RECAST, target)
  }

  private async addReaction(
    type: ReactionType,
    target: ReactionTarget,
  ): Promise<void> {
    const message = await buildMessage(
      {
        type: MessageType.REACTION_ADD,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network,
        reactionBody: {
          type,
          targetCastId: createCastId(target.fid, target.hash),
        },
      },
      this.signerPrivateKey,
    )

    const result = await this.submitter.submit(message)
    if (!result.success) {
      throw new Error(`Failed to add reaction: ${result.error}`)
    }
  }

  private async removeReaction(
    type: ReactionType,
    target: ReactionTarget,
  ): Promise<void> {
    const message = await buildMessage(
      {
        type: MessageType.REACTION_REMOVE,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network,
        reactionBody: {
          type,
          targetCastId: createCastId(target.fid, target.hash),
        },
      },
      this.signerPrivateKey,
    )

    const result = await this.submitter.submit(message)
    if (!result.success) {
      throw new Error(`Failed to remove reaction: ${result.error}`)
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
        network: this.network,
        linkBody: {
          type: 'follow',
          targetFid,
        },
      },
      this.signerPrivateKey,
    )

    const result = await this.submitter.submit(message)
    if (!result.success) {
      throw new Error(`Failed to follow: ${result.error}`)
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
        network: this.network,
        linkBody: {
          type: 'follow',
          targetFid,
        },
      },
      this.signerPrivateKey,
    )

    const result = await this.submitter.submit(message)
    if (!result.success) {
      throw new Error(`Failed to unfollow: ${result.error}`)
    }
  }
  /**
   * Update user profile data
   */
  async updateUserData(update: UserDataUpdate): Promise<void> {
    const typeMap: Record<UserDataUpdate['type'], UserDataType> = {
      pfp: UserDataType.PFP,
      display: UserDataType.DISPLAY,
      bio: UserDataType.BIO,
      url: UserDataType.URL,
      username: UserDataType.USERNAME,
    }

    const message = await buildMessage(
      {
        type: MessageType.USER_DATA_ADD,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network,
        userDataBody: {
          type: typeMap[update.type],
          value: update.value,
        },
      },
      this.signerPrivateKey,
    )

    const result = await this.submitter.submit(message)
    if (!result.success) {
      throw new Error(`Failed to update user data: ${result.error}`)
    }
  }

  /**
   * Update profile picture URL
   */
  async updatePfp(url: string): Promise<void> {
    return this.updateUserData({ type: 'pfp', value: url })
  }

  /**
   * Update display name
   */
  async updateDisplayName(name: string): Promise<void> {
    return this.updateUserData({ type: 'display', value: name })
  }

  /**
   * Update bio
   */
  async updateBio(bio: string): Promise<void> {
    return this.updateUserData({ type: 'bio', value: bio })
  }
  /**
   * Like multiple casts (continues on individual failures)
   */
  async likeMany(
    targets: ReactionTarget[],
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0
    let failed = 0

    for (const target of targets) {
      const success = await this.like(target)
        .then(() => true)
        .catch(() => false)
      if (success) {
        succeeded++
      } else {
        failed++
      }
    }

    return { succeeded, failed }
  }

  /**
   * Follow multiple users (continues on individual failures)
   */
  async followMany(
    fids: number[],
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0
    let failed = 0

    for (const fid of fids) {
      const success = await this.follow(fid)
        .then(() => true)
        .catch(() => false)
      if (success) {
        succeeded++
      } else {
        failed++
      }
    }

    return { succeeded, failed }
  }
  /**
   * Get the FID this poster is configured for
   */
  getFid(): number {
    return this.fid
  }

  /**
   * Get the network this poster is configured for
   */
  getNetwork(): 'mainnet' | 'testnet' | 'devnet' {
    return this.network === 1
      ? 'mainnet'
      : this.network === 2
        ? 'testnet'
        : 'devnet'
  }
}
/**
 * Create a FarcasterPoster from hex private key
 */
export function createPoster(
  fid: number,
  signerPrivateKeyHex: Hex,
  hubUrl: string,
  options?: {
    fallbackHubUrls?: string[]
    network?: 'mainnet' | 'testnet' | 'devnet'
    timeoutMs?: number
  },
): FarcasterPoster {
  const signerPrivateKey = hexToMessageBytes(signerPrivateKeyHex)

  return new FarcasterPoster({
    fid,
    signerPrivateKey,
    hubUrl,
    ...options,
  })
}

/**
 * Default hub URLs for different networks
 */
export const DEFAULT_HUBS = {
  mainnet: 'https://nemes.farcaster.xyz:2281',
  testnet: 'https://testnet.farcaster.xyz:2281',
} as const
