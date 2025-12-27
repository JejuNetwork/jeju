/**
 * Farcaster Hub Service
 *
 * Direct hub client for reading Farcaster data.
 * Provides type-safe access to casts, profiles, reactions, and links.
 */

import { getFarcasterHubUrl } from '@jejunetwork/config'
import {
  type CastFilter,
  type FarcasterCast,
  FarcasterClient,
  type FarcasterLink,
  type FarcasterProfile,
  type FarcasterReaction,
  HubError,
  type PaginatedResponse,
} from '@jejunetwork/messaging'
import { createLogger } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'

const log = createLogger('hub-service')

import { getFactoryConfig } from '../config'

// Use Pinata hub as default - more reliable than nemes
const HUB_URL = getFarcasterHubUrl()
const config = getFactoryConfig()
const FACTORY_CHANNEL_URL = `https://warpcast.com/~/channel/${config.factoryChannelId}`

/** Hub client singleton */
let hubClient: FarcasterClient | null = null

function getHubClient(): FarcasterClient {
  if (!hubClient) {
    hubClient = new FarcasterClient({ hubUrl: HUB_URL })
    log.info('Hub client initialized', { hubUrl: HUB_URL })
  }
  return hubClient
}

/** Cast with enriched author data */
export interface EnrichedCast {
  hash: Hex
  fid: number
  text: string
  timestamp: number
  parentHash?: Hex
  parentFid?: number
  parentUrl?: string
  embeds: Array<{
    url?: string
    castId?: { fid: number; hash: Hex }
  }>
  mentions: number[]
  mentionsPositions: number[]
  author: {
    fid: number
    username: string
    displayName: string
    pfpUrl: string
    bio: string
  }
  reactions: {
    likes: number
    recasts: number
  }
  replies: number
}

/** Profile cache to avoid repeated lookups */
const profileCache = new Map<
  number,
  { profile: FarcasterProfile; cachedAt: number }
>()
const PROFILE_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getCachedProfile(fid: number): Promise<FarcasterProfile | null> {
  const cached = profileCache.get(fid)
  if (cached && Date.now() - cached.cachedAt < PROFILE_CACHE_TTL) {
    return cached.profile
  }

  const hub = getHubClient()

  try {
    const profile = await hub.getProfile(fid)
    profileCache.set(fid, { profile, cachedAt: Date.now() })
    return profile
  } catch (error) {
    // Only swallow NOT_FOUND errors (profile doesn't exist)
    if (error instanceof HubError && error.code === 'NOT_FOUND') {
      return null
    }
    // Log and re-throw other errors
    log.error('Failed to fetch profile', { fid, error: String(error) })
    throw error
  }
}

/**
 * Get a user's Farcaster profile by FID
 */
export async function getProfile(
  fid: number,
): Promise<FarcasterProfile | null> {
  return getCachedProfile(fid)
}

/**
 * Get a user's Farcaster profile by username
 */
export async function getProfileByUsername(
  username: string,
): Promise<FarcasterProfile | null> {
  const hub = getHubClient()
  return hub.getProfileByUsername(username)
}

/**
 * Get a user's Farcaster profile by verified Ethereum address
 */
export async function getProfileByAddress(
  address: Address,
): Promise<FarcasterProfile | null> {
  const hub = getHubClient()
  return hub.getProfileByVerifiedAddress(address)
}

/**
 * Get casts from a user
 */
export async function getCastsByFid(
  fid: number,
  options?: CastFilter,
): Promise<PaginatedResponse<FarcasterCast>> {
  const hub = getHubClient()
  return hub.getCastsByFid(fid, options)
}

/**
 * Get a specific cast by FID and hash
 */
export async function getCast(
  fid: number,
  hash: Hex,
): Promise<FarcasterCast | null> {
  const hub = getHubClient()
  return hub.getCast(fid, hash)
}

/**
 * Get casts from the Factory channel
 */
export async function getFactoryFeed(
  options?: CastFilter,
): Promise<PaginatedResponse<FarcasterCast>> {
  const hub = getHubClient()
  return hub.getCastsByChannel(FACTORY_CHANNEL_URL, options)
}

/**
 * Get casts from a specific channel
 */
export async function getChannelFeed(
  channelUrl: string,
  options?: CastFilter,
): Promise<PaginatedResponse<FarcasterCast>> {
  const hub = getHubClient()
  return hub.getCastsByChannel(channelUrl, options)
}

/**
 * Get reactions by a user
 */
export async function getReactionsByFid(
  fid: number,
): Promise<PaginatedResponse<FarcasterReaction>> {
  const hub = getHubClient()
  return hub.getReactionsByFid(fid)
}

/**
 * Get users that a user is following
 */
export async function getFollowingByFid(
  fid: number,
): Promise<PaginatedResponse<FarcasterLink>> {
  const hub = getHubClient()
  return hub.getLinksByFid(fid)
}

/**
 * Get followers of a user
 */
export async function getFollowersByFid(
  fid: number,
): Promise<PaginatedResponse<FarcasterLink>> {
  const hub = getHubClient()
  return hub.getLinksByTargetFid(fid)
}

/**
 * Enrich casts with author profile data
 */
export async function enrichCasts(
  casts: FarcasterCast[],
): Promise<EnrichedCast[]> {
  // Get unique FIDs
  const fids = [...new Set(casts.map((c) => c.fid))]

  // Fetch profiles in parallel
  const profiles = await Promise.all(fids.map((fid) => getCachedProfile(fid)))

  // Create FID -> profile map
  const profileMap = new Map<number, FarcasterProfile>()
  for (let i = 0; i < fids.length; i++) {
    const profile = profiles[i]
    if (profile) {
      profileMap.set(fids[i], profile)
    }
  }

  // Enrich casts
  return casts.map((cast): EnrichedCast => {
    const profile = profileMap.get(cast.fid)
    return {
      hash: cast.hash,
      fid: cast.fid,
      text: cast.text,
      timestamp: cast.timestamp,
      parentHash: cast.parentHash,
      parentFid: cast.parentFid,
      parentUrl: cast.parentUrl,
      embeds: cast.embeds,
      mentions: cast.mentions,
      mentionsPositions: cast.mentionsPositions,
      author: {
        fid: cast.fid,
        username: profile?.username ?? `fid:${cast.fid}`,
        displayName: profile?.displayName ?? '',
        pfpUrl: profile?.pfpUrl ?? '',
        bio: profile?.bio ?? '',
      },
      reactions: {
        likes: 0, // Will be enriched from Neynar or indexer
        recasts: 0,
      },
      replies: 0,
    }
  })
}

/**
 * Check if the hub is syncing
 */
export async function isHubSyncing(): Promise<boolean> {
  const hub = getHubClient()
  return hub.isSyncing()
}

/**
 * Get hub info
 */
export async function getHubInfo() {
  const hub = getHubClient()
  return hub.getHubInfo()
}

/**
 * Clear profile cache
 */
export function clearProfileCache(): void {
  profileCache.clear()
}

/**
 * Export error type for consumers
 */
export { HubError }
