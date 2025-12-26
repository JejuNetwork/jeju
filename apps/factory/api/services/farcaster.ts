/**
 * Farcaster Service
 *
 * Unified Farcaster service combining:
 * - Neynar API for rich feed data (reactions, replies, etc.)
 * - Hub client for direct operations
 * - Local cache for user reactions
 */

import { getFarcasterApiUrl, getNeynarApiKey } from '@jejunetwork/config'
import type { PostedCast } from '@jejunetwork/messaging'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import {
  createCastReaction,
  createFidLink,
  deleteCastReaction,
  type FidLinkRow,
  getFidLink,
  getUserReactionsForCasts,
} from '../db/client'
import * as hubService from './hub'
import { getActiveSignerWithPoster, hasActiveSigner } from './signer'

const FACTORY_CHANNEL_ID = process.env.FACTORY_CHANNEL_ID ?? 'factory'
const NEYNAR_API_URL = getFarcasterApiUrl()
const NEYNAR_API_KEY = getNeynarApiKey()

// ============================================================================
// NEYNAR SCHEMAS
// ============================================================================

const NeynarUserSchema = z.object({
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

const NeynarCastSchema = z.object({
  hash: z.string(),
  thread_hash: z.string(),
  author: NeynarUserSchema,
  text: z.string(),
  timestamp: z.string(),
  embeds: z.array(z.object({ url: z.string().optional() })).optional(),
  reactions: z
    .object({
      likes_count: z.number().optional(),
      recasts_count: z.number().optional(),
      likes: z.array(z.object({ fid: z.number() })).optional(),
      recasts: z.array(z.object({ fid: z.number() })).optional(),
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
      name: z.string().optional(),
      image_url: z.string().optional(),
    })
    .nullable()
    .optional(),
  parent_hash: z.string().nullable().optional(),
  parent_author: z.object({ fid: z.number().nullable() }).nullable().optional(),
})

const NeynarFeedResponseSchema = z.object({
  casts: z.array(NeynarCastSchema),
  next: z.object({ cursor: z.string().optional() }).optional(),
})

// ============================================================================
// TYPES
// ============================================================================

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
  embeds: Array<{ url?: string }>
  reactions: {
    likes: number
    recasts: number
    viewerLiked: boolean
    viewerRecasted: boolean
  }
  replies: number
  channel: {
    id: string
    name?: string
    imageUrl?: string
  } | null
  parentHash: string | null
  parentFid: number | null
}

export interface FeedResponse {
  casts: Cast[]
  cursor?: string
}

// ============================================================================
// HELPERS
// ============================================================================

function getNeynarHeaders(): Record<string, string> | null {
  if (!NEYNAR_API_KEY) {
    return null
  }
  return {
    api_key: NEYNAR_API_KEY,
    'Content-Type': 'application/json',
  }
}

function transformNeynarUser(
  rawUser: z.infer<typeof NeynarUserSchema>,
): FarcasterUser {
  return {
    fid: rawUser.fid,
    username: rawUser.username,
    displayName: rawUser.display_name,
    pfpUrl: rawUser.pfp_url,
    bio: rawUser.profile?.bio?.text ?? '',
    followerCount: rawUser.follower_count ?? 0,
    followingCount: rawUser.following_count ?? 0,
    verifiedAddresses: rawUser.verified_addresses?.eth_addresses ?? [],
  }
}

function transformNeynarCast(
  rawCast: z.infer<typeof NeynarCastSchema>,
  viewerFid?: number,
): Cast {
  const viewerLiked = viewerFid
    ? (rawCast.reactions?.likes?.some((l) => l.fid === viewerFid) ?? false)
    : false
  const viewerRecasted = viewerFid
    ? (rawCast.reactions?.recasts?.some((r) => r.fid === viewerFid) ?? false)
    : false

  return {
    hash: rawCast.hash,
    threadHash: rawCast.thread_hash,
    author: transformNeynarUser(rawCast.author),
    text: rawCast.text,
    timestamp: new Date(rawCast.timestamp).getTime(),
    embeds: rawCast.embeds?.map((e) => ({ url: e.url })) ?? [],
    reactions: {
      likes: rawCast.reactions?.likes_count ?? 0,
      recasts: rawCast.reactions?.recasts_count ?? 0,
      viewerLiked,
      viewerRecasted,
    },
    replies: rawCast.replies?.count ?? 0,
    channel: rawCast.channel
      ? {
          id: rawCast.channel.id,
          name: rawCast.channel.name,
          imageUrl: rawCast.channel.image_url,
        }
      : null,
    parentHash: rawCast.parent_hash ?? null,
    parentFid: rawCast.parent_author?.fid ?? null,
  }
}

// ============================================================================
// FEED OPERATIONS
// ============================================================================

/**
 * Get channel feed from Neynar (preferred for rich data)
 */
export async function getChannelFeed(
  channelId: string = FACTORY_CHANNEL_ID,
  options: {
    limit?: number
    cursor?: string
    viewerFid?: number
  } = {},
): Promise<FeedResponse> {
  const headers = getNeynarHeaders()

  // Fall back to hub if Neynar not configured
  // Note: Hub fallback temporarily disabled due to schema validation issues in messaging package
  if (!headers) {
    return { casts: [] }
  }

  const params = new URLSearchParams()
  params.set('channel_id', channelId)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.viewerFid) params.set('viewer_fid', String(options.viewerFid))

  const response = await fetch(
    `${NEYNAR_API_URL}/farcaster/feed/channel?${params}`,
    { headers },
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch channel feed: ${response.status}`)
  }

  const data: unknown = await response.json()
  const parsed = NeynarFeedResponseSchema.parse(data)

  return {
    casts: parsed.casts.map((c) => transformNeynarCast(c, options.viewerFid)),
    cursor: parsed.next?.cursor,
  }
}

/**
 * Get user's cast feed
 */
export async function getUserFeed(
  fid: number,
  options: {
    limit?: number
    cursor?: string
    viewerFid?: number
  } = {},
): Promise<FeedResponse> {
  const headers = getNeynarHeaders()

  // Note: Hub fallback temporarily disabled due to schema validation issues in messaging package
  if (!headers) {
    return { casts: [] }
  }

  const params = new URLSearchParams()
  params.set('fid', String(fid))
  params.set('feed_type', 'filter')
  params.set('filter_type', 'fids')
  params.set('fids', String(fid))
  if (options.limit) params.set('limit', String(options.limit))
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.viewerFid) params.set('viewer_fid', String(options.viewerFid))

  const response = await fetch(`${NEYNAR_API_URL}/farcaster/feed?${params}`, {
    headers,
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch user feed: ${response.status}`)
  }

  const data: unknown = await response.json()
  const parsed = NeynarFeedResponseSchema.parse(data)

  return {
    casts: parsed.casts.map((c) => transformNeynarCast(c, options.viewerFid)),
    cursor: parsed.next?.cursor,
  }
}

/**
 * Get trending feed
 */
export async function getTrendingFeed(
  options: { limit?: number; cursor?: string; viewerFid?: number } = {},
): Promise<FeedResponse> {
  const headers = getNeynarHeaders()
  if (!headers) {
    return { casts: [] }
  }

  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.viewerFid) params.set('viewer_fid', String(options.viewerFid))

  const response = await fetch(
    `${NEYNAR_API_URL}/farcaster/feed/trending?${params}`,
    { headers },
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch trending feed: ${response.status}`)
  }

  const data: unknown = await response.json()
  const parsed = NeynarFeedResponseSchema.parse(data)

  return {
    casts: parsed.casts.map((c) => transformNeynarCast(c, options.viewerFid)),
    cursor: parsed.next?.cursor,
  }
}

// ============================================================================
// CAST OPERATIONS
// ============================================================================

/**
 * Publish a cast (requires active signer)
 */
export async function publishCast(
  address: Address,
  text: string,
  options: {
    channelId?: string
    parentHash?: Hex
    parentFid?: number
    embeds?: string[]
  } = {},
): Promise<PostedCast> {
  const signerData = getActiveSignerWithPoster(address)
  if (!signerData) {
    throw new Error(
      'No active signer found. Please connect your Farcaster account.',
    )
  }

  const { poster } = signerData
  const channelUrl = options.channelId
    ? `https://warpcast.com/~/channel/${options.channelId}`
    : undefined

  if (options.parentHash && options.parentFid) {
    return poster.reply(
      text,
      { fid: options.parentFid, hash: options.parentHash },
      {
        channelUrl,
        embeds: options.embeds,
      },
    )
  }

  return poster.cast(text, {
    channelUrl,
    embeds: options.embeds,
  })
}

/**
 * Delete a cast
 */
export async function deleteCast(
  address: Address,
  castHash: Hex,
): Promise<void> {
  const signerData = getActiveSignerWithPoster(address)
  if (!signerData) {
    throw new Error('No active signer found')
  }

  await signerData.poster.deleteCast(castHash)
}

/**
 * Like a cast
 */
export async function likeCast(
  address: Address,
  target: { fid: number; hash: Hex },
): Promise<void> {
  const signerData = getActiveSignerWithPoster(address)
  if (!signerData) {
    throw new Error('No active signer found')
  }

  await signerData.poster.like(target)

  // Cache locally
  createCastReaction({
    address,
    castHash: target.hash,
    castFid: target.fid,
    reactionType: 'like',
  })
}

/**
 * Unlike a cast
 */
export async function unlikeCast(
  address: Address,
  target: { fid: number; hash: Hex },
): Promise<void> {
  const signerData = getActiveSignerWithPoster(address)
  if (!signerData) {
    throw new Error('No active signer found')
  }

  await signerData.poster.unlike(target)

  // Remove from cache
  deleteCastReaction(address, target.hash, 'like')
}

/**
 * Recast a cast
 */
export async function recastCast(
  address: Address,
  target: { fid: number; hash: Hex },
): Promise<void> {
  const signerData = getActiveSignerWithPoster(address)
  if (!signerData) {
    throw new Error('No active signer found')
  }

  await signerData.poster.recast(target)

  // Cache locally
  createCastReaction({
    address,
    castHash: target.hash,
    castFid: target.fid,
    reactionType: 'recast',
  })
}

/**
 * Remove recast
 */
export async function unrecastCast(
  address: Address,
  target: { fid: number; hash: Hex },
): Promise<void> {
  const signerData = getActiveSignerWithPoster(address)
  if (!signerData) {
    throw new Error('No active signer found')
  }

  await signerData.poster.unrecast(target)

  // Remove from cache
  deleteCastReaction(address, target.hash, 'recast')
}

// ============================================================================
// FOLLOW OPERATIONS
// ============================================================================

/**
 * Follow a user
 */
export async function followUser(
  address: Address,
  targetFid: number,
): Promise<void> {
  const signerData = getActiveSignerWithPoster(address)
  if (!signerData) {
    throw new Error('No active signer found')
  }

  await signerData.poster.follow(targetFid)
}

/**
 * Unfollow a user
 */
export async function unfollowUser(
  address: Address,
  targetFid: number,
): Promise<void> {
  const signerData = getActiveSignerWithPoster(address)
  if (!signerData) {
    throw new Error('No active signer found')
  }

  await signerData.poster.unfollow(targetFid)
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

/** Transform hub profile to FarcasterUser */
function transformProfile(profile: {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  bio: string
  followerCount: number
  followingCount: number
  verifiedAddresses: string[]
}): FarcasterUser {
  return {
    fid: profile.fid,
    username: profile.username,
    displayName: profile.displayName,
    pfpUrl: profile.pfpUrl,
    bio: profile.bio,
    followerCount: profile.followerCount,
    followingCount: profile.followingCount,
    verifiedAddresses: profile.verifiedAddresses,
  }
}

/** Get user profile by FID */
export async function getUser(fid: number): Promise<FarcasterUser | null> {
  const profile = await hubService.getProfile(fid)
  return profile ? transformProfile(profile) : null
}

/** Get user profile by username */
export async function getUserByUsername(
  username: string,
): Promise<FarcasterUser | null> {
  const profile = await hubService.getProfileByUsername(username)
  return profile ? transformProfile(profile) : null
}

/** Get user profile by verified address */
export async function getUserByAddress(
  address: Address,
): Promise<FarcasterUser | null> {
  const profile = await hubService.getProfileByAddress(address)
  return profile ? transformProfile(profile) : null
}

/**
 * Link wallet address to FID (store locally after verification)
 */
export async function linkAddressToFid(
  address: Address,
  fid: number,
): Promise<FidLinkRow> {
  // Verify the address is actually verified for this FID
  const profile = await hubService.getProfile(fid)
  if (!profile) {
    throw new Error(`FID ${fid} not found`)
  }

  const isVerified = profile.verifiedAddresses.some(
    (a) => a.toLowerCase() === address.toLowerCase(),
  )

  if (!isVerified) {
    throw new Error(`Address ${address} is not verified for FID ${fid}`)
  }

  return createFidLink({
    address,
    fid,
    username: profile.username,
    displayName: profile.displayName,
    pfpUrl: profile.pfpUrl,
    bio: profile.bio,
  })
}

/**
 * Get linked FID for an address
 */
export function getLinkedFid(address: Address): FidLinkRow | null {
  return getFidLink(address)
}

/**
 * Check if user has Farcaster connected
 */
export function isFarcasterConnected(address: Address): boolean {
  return hasActiveSigner(address) && getFidLink(address) !== null
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Get viewer reactions for a list of casts
 */
export function getViewerReactions(
  address: Address,
  castHashes: string[],
): Map<string, { liked: boolean; recasted: boolean }> {
  const reactions = getUserReactionsForCasts(address, castHashes)
  const result = new Map<string, { liked: boolean; recasted: boolean }>()

  // Initialize all casts
  for (const hash of castHashes) {
    result.set(hash, { liked: false, recasted: false })
  }

  // Set actual reactions
  for (const reaction of reactions) {
    const current = result.get(reaction.cast_hash)
    if (current) {
      if (reaction.reaction_type === 'like') {
        current.liked = true
      } else if (reaction.reaction_type === 'recast') {
        current.recasted = true
      }
    }
  }

  return result
}

/**
 * Check if Neynar API is configured
 */
export function isNeynarConfigured(): boolean {
  return !!NEYNAR_API_KEY
}

/**
 * Get Factory channel ID
 */
export function getFactoryChannelId(): string {
  return FACTORY_CHANNEL_ID
}
