/**
 * Cast Builder - Convenience functions for building cast messages
 *
 * Provides a high-level API for creating cast, reply, and thread messages.
 */

import type { Hex } from 'viem'
import {
  buildMessage,
  type CastAddBody,
  createCastId,
  type Embed,
  type FarcasterNetwork,
  getFarcasterTimestamp,
  hexToMessageBytes,
  type Message,
  MessageType,
} from './message-builder'
export interface CastOptions {
  /** Reply to this cast */
  replyTo?: { fid: number; hash: Hex }
  /** Reply in this channel (URL) */
  channelUrl?: string
  /** Embed URLs */
  embeds?: string[]
  /** Embed casts */
  embedCasts?: Array<{ fid: number; hash: Hex }>
  /** Mentioned FIDs */
  mentions?: number[]
  /** Positions of mentions in text (byte positions) */
  mentionPositions?: number[]
}

export interface CastBuilderConfig {
  fid: number
  signerPrivateKey: Uint8Array
  network?: 'mainnet' | 'testnet' | 'devnet'
}
export class CastBuilder {
  private readonly fid: number
  private readonly signerPrivateKey: Uint8Array
  private readonly network: FarcasterNetwork

  constructor(config: CastBuilderConfig) {
    this.fid = config.fid
    this.signerPrivateKey = config.signerPrivateKey
    this.network =
      config.network === 'testnet' ? 2 : config.network === 'devnet' ? 3 : 1
  }

  /**
   * Build a cast message
   */
  async buildCast(text: string, options?: CastOptions): Promise<Message> {
    // Validate text length (320 bytes max per Farcaster spec)
    const textBytes = new TextEncoder().encode(text)
    if (textBytes.length > 320) {
      throw new Error(`Cast text exceeds 320 bytes (got ${textBytes.length})`)
    }

    // Build embeds array
    const embeds: Embed[] = []

    if (options?.embeds) {
      for (const url of options.embeds) {
        embeds.push({ url })
      }
    }

    if (options?.embedCasts) {
      for (const embed of options.embedCasts) {
        embeds.push({
          castId: createCastId(embed.fid, embed.hash),
        })
      }
    }

    // Build cast body
    const castAddBody: CastAddBody = {
      text,
      embeds: embeds.length > 0 ? embeds : undefined,
      mentions: options?.mentions,
      mentionsPositions: options?.mentionPositions,
    }

    // Set parent (reply or channel)
    if (options?.replyTo) {
      castAddBody.parentCastId = createCastId(
        options.replyTo.fid,
        options.replyTo.hash,
      )
    } else if (options?.channelUrl) {
      castAddBody.parentUrl = options.channelUrl
    }

    return buildMessage(
      {
        type: MessageType.CAST_ADD,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: this.network,
        castAddBody,
      },
      this.signerPrivateKey,
    )
  }

  /**
   * Build a reply to a cast
   */
  async buildReply(
    text: string,
    replyTo: { fid: number; hash: Hex },
    options?: Omit<CastOptions, 'replyTo' | 'channelUrl'>,
  ): Promise<Message> {
    return this.buildCast(text, { ...options, replyTo })
  }

  /**
   * Build a cast in a channel
   */
  async buildChannelCast(
    text: string,
    channelUrl: string,
    options?: Omit<CastOptions, 'replyTo' | 'channelUrl'>,
  ): Promise<Message> {
    return this.buildCast(text, { ...options, channelUrl })
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
        network: this.network,
        castRemoveBody: {
          targetHash: hexToMessageBytes(targetHash),
        },
      },
      this.signerPrivateKey,
    )
  }

  /**
   * Build a thread of connected casts
   * Returns array of messages where each subsequent cast replies to the previous
   */
  async buildThread(
    texts: string[],
    options?: Pick<CastOptions, 'channelUrl' | 'embeds'>,
  ): Promise<Message[]> {
    if (texts.length === 0) {
      throw new Error('Thread must have at least one cast')
    }

    const messages: Message[] = []
    let previousMessage: Message | undefined

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      if (!text) continue

      const castOptions: CastOptions = {}

      // First cast can have channel
      if (i === 0 && options?.channelUrl) {
        castOptions.channelUrl = options.channelUrl
      }

      // Subsequent casts reply to previous
      if (previousMessage) {
        const hashHex = `0x${Array.from(previousMessage.hash)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')}` as Hex
        castOptions.replyTo = { fid: this.fid, hash: hashHex }
      }

      // Only first cast gets embeds
      if (i === 0 && options?.embeds) {
        castOptions.embeds = options.embeds
      }

      const message = await this.buildCast(text, castOptions)
      messages.push(message)
      previousMessage = message
    }

    return messages
  }

  /**
   * Build a quote cast (cast with embedded cast reference)
   */
  async buildQuoteCast(
    text: string,
    quotedCast: { fid: number; hash: Hex },
    options?: Omit<CastOptions, 'embedCasts'>,
  ): Promise<Message> {
    return this.buildCast(text, {
      ...options,
      embedCasts: [quotedCast],
    })
  }
}
/**
 * Create a simple cast message (convenience function)
 */
export async function createCast(
  fid: number,
  signerPrivateKey: Uint8Array,
  text: string,
  options?: CastOptions & { network?: 'mainnet' | 'testnet' | 'devnet' },
): Promise<Message> {
  const builder = new CastBuilder({
    fid,
    signerPrivateKey,
    network: options?.network,
  })
  return builder.buildCast(text, options)
}

/**
 * Create a reply message (convenience function)
 */
export async function createReply(
  fid: number,
  signerPrivateKey: Uint8Array,
  text: string,
  replyTo: { fid: number; hash: Hex },
  options?: { network?: 'mainnet' | 'testnet' | 'devnet' },
): Promise<Message> {
  const builder = new CastBuilder({
    fid,
    signerPrivateKey,
    network: options?.network,
  })
  return builder.buildReply(text, replyTo)
}

/**
 * Create a delete cast message (convenience function)
 */
export async function createDeleteCast(
  fid: number,
  signerPrivateKey: Uint8Array,
  targetHash: Hex,
  options?: { network?: 'mainnet' | 'testnet' | 'devnet' },
): Promise<Message> {
  const builder = new CastBuilder({
    fid,
    signerPrivateKey,
    network: options?.network,
  })
  return builder.buildDeleteCast(targetHash)
}
/**
 * Parse mentions from text and return mention data
 * Format: @username becomes @fid at the byte position
 */
export interface ParsedMention {
  fid: number
  position: number
  username: string
}

/**
 * Calculate text byte length (for validation)
 */
export function getTextByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Split long text into multiple casts for threading
 * Respects 320 byte limit and tries to split at word boundaries
 */
export function splitTextForThread(
  text: string,
  maxBytes: number = 320,
): string[] {
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    const bytes = new TextEncoder().encode(remaining)

    if (bytes.length <= maxBytes) {
      chunks.push(remaining)
      break
    }

    // Find a good split point (word boundary)
    let splitIndex = 0
    let currentBytes = 0

    const words = remaining.split(' ')
    const wordsWithSpaces: string[] = []

    for (let i = 0; i < words.length; i++) {
      const word = words[i] ?? ''
      wordsWithSpaces.push(i === 0 ? word : ` ${word}`)
    }

    for (const word of wordsWithSpaces) {
      const wordBytes = new TextEncoder().encode(word).length
      if (currentBytes + wordBytes > maxBytes - 3) {
        // -3 for "..."
        break
      }
      currentBytes += wordBytes
      splitIndex += word.length
    }

    if (splitIndex === 0) {
      // Word is too long, force split at byte boundary
      let byteCount = 0
      for (let i = 0; i < remaining.length; i++) {
        const charBytes = new TextEncoder().encode(remaining[i]).length
        if (byteCount + charBytes > maxBytes - 3) {
          splitIndex = i
          break
        }
        byteCount += charBytes
      }
    }

    chunks.push(`${remaining.slice(0, splitIndex).trim()}...`)
    remaining = `...${remaining.slice(splitIndex).trim()}`
  }

  return chunks
}
