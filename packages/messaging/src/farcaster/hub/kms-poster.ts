/**
 * KMS-Backed Farcaster Poster
 *
 * Posts to Farcaster using KMS-backed signing.
 * Private keys NEVER exist in application memory - signing happens
 * inside the secure KMS enclave.
 *
 * SECURITY PROPERTIES:
 * - Private keys never leave the KMS
 * - Signing happens inside secure enclaves
 * - Protected against TEE side-channel attacks
 */

import { createLogger } from '@jejunetwork/shared'
import { blake3 } from '@noble/hashes/blake3'
import type { Hex } from 'viem'

import {
  encodeMessageData,
  type FarcasterNetwork,
  getFarcasterTimestamp,
  type Message,
  type MessageData,
  MessageType,
  ReactionType,
  UserDataType,
} from './message-builder'
import { FailoverHubSubmitter, type HubEndpoint, HubSubmitter } from './submitter'

const log = createLogger('kms-poster')

/**
 * KMS Signer Interface
 *
 * Represents a signer where the private key exists only inside the KMS.
 */
export interface KMSPosterSigner {
  /** Public key (Ed25519, safe to expose) */
  readonly publicKey: Uint8Array

  /**
   * Sign a message hash using the KMS.
   * The private key never leaves the secure enclave.
   */
  sign(messageHash: Uint8Array): Promise<Uint8Array>
}

/**
 * Configuration for KMS-backed Poster
 */
export interface KMSPosterConfig {
  /** Farcaster ID */
  fid: number
  /** KMS signer - private key never exposed */
  kmsSigner: KMSPosterSigner
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

/**
 * KMS-Backed Farcaster Poster
 *
 * All signing operations are delegated to the KMS.
 * Private keys never exist in application memory.
 */
export class KMSFarcasterPoster {
  private readonly kmsSigner: KMSPosterSigner
  private readonly submitter: HubSubmitter | FailoverHubSubmitter
  private readonly fid: number
  private readonly network: FarcasterNetwork

  constructor(config: KMSPosterConfig) {
    this.fid = config.fid
    this.kmsSigner = config.kmsSigner
    this.network =
      config.network === 'testnet' ? 2 : config.network === 'devnet' ? 3 : 1

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

    log.info('KMS Poster initialized - private keys protected in KMS', {
      fid: config.fid,
      network: config.network ?? 'mainnet',
    })
  }

  /**
   * Build and sign a message using KMS
   */
  private async buildMessage(data: MessageData): Promise<Message> {
    // Encode and hash the message data
    const encoded = encodeMessageData(data)
    const fullHash = blake3(encoded)
    const hash = fullHash.slice(0, 20) // Truncate to 20 bytes per Farcaster spec

    // Sign in KMS - private key never exposed
    const signature = await this.kmsSigner.sign(hash)

    return {
      data,
      hash,
      hashScheme: 1, // BLAKE3
      signature,
      signatureScheme: 1, // ED25519
      signer: this.kmsSigner.publicKey,
    }
  }

  /**
   * Post a cast
   */
  async cast(
    text: string,
    options?: {
      embeds?: string[]
      embedCasts?: ReactionTarget[]
      mentions?: number[]
      mentionsPositions?: number[]
      replyTo?: ReactionTarget
      channelUrl?: string
    },
  ): Promise<PostedCast> {
    const timestamp = getFarcasterTimestamp()

    const castAddBody = {
      text,
      embeds: [
        ...(options?.embeds?.map((url) => ({ url })) ?? []),
        ...(options?.embedCasts?.map((c) => ({
          castId: { fid: c.fid, hash: this.hexToBytes(c.hash) },
        })) ?? []),
      ],
      mentions: options?.mentions ?? [],
      mentionsPositions: options?.mentionsPositions ?? [],
      parentCastId: options?.replyTo
        ? { fid: options.replyTo.fid, hash: this.hexToBytes(options.replyTo.hash) }
        : undefined,
      parentUrl: options?.channelUrl,
    }

    const message = await this.buildMessage({
      type: MessageType.CAST_ADD,
      fid: this.fid,
      timestamp,
      network: this.network,
      castAddBody,
    })

    const result = await this.submitter.submit(message)

    if (!result.success) {
      throw new Error(`Failed to post cast: ${result.error}`)
    }

    return {
      hash: result.hash as Hex,
      fid: this.fid,
      text,
      timestamp,
    }
  }

  /**
   * Reply to a cast
   */
  async reply(text: string, replyTo: ReactionTarget): Promise<PostedCast> {
    return this.cast(text, { replyTo })
  }

  /**
   * Post to a channel
   */
  async castToChannel(text: string, channelUrl: string): Promise<PostedCast> {
    return this.cast(text, { channelUrl })
  }

  /**
   * Delete a cast
   */
  async deleteCast(targetHash: Hex): Promise<void> {
    const message = await this.buildMessage({
      type: MessageType.CAST_REMOVE,
      fid: this.fid,
      timestamp: getFarcasterTimestamp(),
      network: this.network,
      castRemoveBody: { targetHash: this.hexToBytes(targetHash) },
    })

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
   * Recast
   */
  async recast(target: ReactionTarget): Promise<void> {
    await this.addReaction(ReactionType.RECAST, target)
  }

  /**
   * Unrecast
   */
  async unrecast(target: ReactionTarget): Promise<void> {
    await this.removeReaction(ReactionType.RECAST, target)
  }

  private async addReaction(
    type: ReactionType,
    target: ReactionTarget,
  ): Promise<void> {
    const message = await this.buildMessage({
      type: MessageType.REACTION_ADD,
      fid: this.fid,
      timestamp: getFarcasterTimestamp(),
      network: this.network,
      reactionBody: {
        type,
        targetCastId: { fid: target.fid, hash: this.hexToBytes(target.hash) },
      },
    })

    const result = await this.submitter.submit(message)

    if (!result.success) {
      throw new Error(`Failed to add reaction: ${result.error}`)
    }
  }

  private async removeReaction(
    type: ReactionType,
    target: ReactionTarget,
  ): Promise<void> {
    const message = await this.buildMessage({
      type: MessageType.REACTION_REMOVE,
      fid: this.fid,
      timestamp: getFarcasterTimestamp(),
      network: this.network,
      reactionBody: {
        type,
        targetCastId: { fid: target.fid, hash: this.hexToBytes(target.hash) },
      },
    })

    const result = await this.submitter.submit(message)

    if (!result.success) {
      throw new Error(`Failed to remove reaction: ${result.error}`)
    }
  }

  /**
   * Follow a user
   */
  async follow(targetFid: number): Promise<void> {
    const message = await this.buildMessage({
      type: MessageType.LINK_ADD,
      fid: this.fid,
      timestamp: getFarcasterTimestamp(),
      network: this.network,
      linkBody: { type: 'follow', targetFid },
    })

    const result = await this.submitter.submit(message)

    if (!result.success) {
      throw new Error(`Failed to follow: ${result.error}`)
    }
  }

  /**
   * Unfollow a user
   */
  async unfollow(targetFid: number): Promise<void> {
    const message = await this.buildMessage({
      type: MessageType.LINK_REMOVE,
      fid: this.fid,
      timestamp: getFarcasterTimestamp(),
      network: this.network,
      linkBody: { type: 'follow', targetFid },
    })

    const result = await this.submitter.submit(message)

    if (!result.success) {
      throw new Error(`Failed to unfollow: ${result.error}`)
    }
  }

  /**
   * Update user data
   */
  async updateUserData(update: UserDataUpdate): Promise<void> {
    const typeMap: Record<UserDataUpdate['type'], UserDataType> = {
      pfp: UserDataType.PFP,
      display: UserDataType.DISPLAY,
      bio: UserDataType.BIO,
      url: UserDataType.URL,
      username: UserDataType.USERNAME,
    }

    const message = await this.buildMessage({
      type: MessageType.USER_DATA_ADD,
      fid: this.fid,
      timestamp: getFarcasterTimestamp(),
      network: this.network,
      userDataBody: { type: typeMap[update.type], value: update.value },
    })

    const result = await this.submitter.submit(message)

    if (!result.success) {
      throw new Error(`Failed to update user data: ${result.error}`)
    }
  }

  /**
   * Update profile picture
   */
  async updatePfp(url: string): Promise<void> {
    await this.updateUserData({ type: 'pfp', value: url })
  }

  /**
   * Update display name
   */
  async updateDisplayName(name: string): Promise<void> {
    await this.updateUserData({ type: 'display', value: name })
  }

  /**
   * Update bio
   */
  async updateBio(bio: string): Promise<void> {
    await this.updateUserData({ type: 'bio', value: bio })
  }

  /**
   * Get FID
   */
  getFid(): number {
    return this.fid
  }

  /**
   * Get network
   */
  getNetwork(): 'mainnet' | 'testnet' | 'devnet' {
    return this.network === 1
      ? 'mainnet'
      : this.network === 2
        ? 'testnet'
        : 'devnet'
  }

  private hexToBytes(hex: Hex): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = new Uint8Array(cleanHex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }
}

/**
 * Create a KMS-backed Farcaster poster.
 *
 * This is the recommended way to post to Farcaster in production.
 * Private keys never exist in application memory.
 */
export function createKMSPoster(config: KMSPosterConfig): KMSFarcasterPoster {
  return new KMSFarcasterPoster(config)
}

/**
 * Remote KMS Signer Implementation
 *
 * Connects to a remote KMS endpoint for signing.
 */
export class RemoteKMSPosterSigner implements KMSPosterSigner {
  readonly publicKey: Uint8Array

  private readonly endpoint: string
  private readonly keyId: string
  private readonly apiKey?: string
  private readonly timeoutMs: number

  constructor(config: {
    endpoint: string
    keyId: string
    publicKey: Uint8Array
    apiKey?: string
    timeoutMs?: number
  }) {
    this.endpoint = config.endpoint
    this.keyId = config.keyId
    this.publicKey = config.publicKey
    this.apiKey = config.apiKey
    this.timeoutMs = config.timeoutMs ?? 10000
  }

  async sign(messageHash: Uint8Array): Promise<Uint8Array> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`
      }

      const response = await fetch(`${this.endpoint}/sign`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          keyId: this.keyId,
          message: Buffer.from(messageHash).toString('base64'),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`KMS signing failed: ${response.status} - ${error}`)
      }

      const result = (await response.json()) as { signature: string }
      return Buffer.from(result.signature, 'base64')
    } finally {
      clearTimeout(timeout)
    }
  }
}

