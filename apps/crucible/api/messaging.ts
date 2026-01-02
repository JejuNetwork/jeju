import { getCacheClient, safeParseCached } from '@jejunetwork/cache'
import {
  type FarcasterCast,
  FarcasterClient,
  type FarcasterProfile,
  FarcasterProfileSchema,
} from '@jejunetwork/messaging'
import type { Address } from 'viem'

import { config } from './config'

const HUB_URL = config.farcasterHubUrl
const CRUCIBLE_CHANNEL_ID = 'crucible'
const CRUCIBLE_CHANNEL_URL = `https://warpcast.com/~/channel/${CRUCIBLE_CHANNEL_ID}`

// DWS cache for Farcaster profiles (5 minute TTL)
const PROFILE_CACHE_TTL = 300 // 5 minutes in seconds

function getProfileCache() {
  return getCacheClient('crucible-profiles')
}

export interface CrucibleFeedCast {
  hash: string
  author: {
    fid: number
    username: string
    displayName: string
    pfpUrl: string
  }
  text: string
  timestamp: number
  embeds: Array<{ url: string }>
  parentHash?: string
}

export interface AgentNotification {
  type:
    | 'agent_created'
    | 'agent_joined'
    | 'agent_message'
    | 'room_activity'
    | 'autonomous_action'
  title: string
  body: string
  data?: Record<string, unknown>
}

class CrucibleMessagingService {
  private hubClient: FarcasterClient

  constructor() {
    this.hubClient = new FarcasterClient({ hubUrl: HUB_URL })
  }

  /**
   * Get the Crucible channel feed
   */
  async getChannelFeed(options?: {
    limit?: number
    cursor?: string
  }): Promise<{ casts: CrucibleFeedCast[]; cursor?: string }> {
    const response = await this.hubClient.getCastsByChannel(
      CRUCIBLE_CHANNEL_URL,
      {
        pageSize: options?.limit ?? 20,
        pageToken: options?.cursor,
      },
    )

    const casts = await this.enrichCasts(response.messages)

    return {
      casts,
      cursor: response.nextPageToken,
    }
  }

  /**
   * Get a user's profile
   * Note: Returns null if profile fetch fails (Hub API limitations)
   */
  async getProfile(fid: number): Promise<FarcasterProfile | null> {
    const cache = getProfileCache()
    const cacheKey = `profile:${fid}`

    // Check DWS cache first
    const cached = await cache.get(cacheKey).catch((err) => {
      console.warn('[Crucible] Cache read failed:', err)
      return null
    })
    const cachedProfile = safeParseCached(cached, FarcasterProfileSchema)
    if (cachedProfile) {
      console.debug('[Crucible] Cache hit for profile:', fid)
      return cachedProfile
    }

    // Profile fetch may fail due to Hub API limitations (e.g. getLinksByTargetFid returns 400)
    // In that case, log the error and return null
    const profile = await this.hubClient.getProfile(fid).catch((err) => {
      // This is expected for some FIDs due to Hub API limitations
      // Only log at debug level to avoid noise
      console.debug(`[Messaging] Profile fetch failed for FID ${fid}: ${err}`)
      return null
    })
    if (profile) {
      console.debug('[Crucible] Cache miss, caching profile:', fid)
      cache
        .set(cacheKey, JSON.stringify(profile), PROFILE_CACHE_TTL)
        .catch((err) => console.warn('[Crucible] Cache write failed:', err))
    }
    return profile
  }

  /**
   * Lookup FID by verified address
   */
  async getFidByAddress(address: Address): Promise<number | null> {
    const profile = await this.hubClient.getProfileByVerifiedAddress(address)
    return profile?.fid ?? null
  }

  /**
   * Enrich casts with profile data
   */
  private async enrichCasts(
    casts: FarcasterCast[],
  ): Promise<CrucibleFeedCast[]> {
    const fids = [...new Set(casts.map((c) => c.fid))]
    const profiles = await Promise.all(fids.map((fid) => this.getProfile(fid)))
    const profileMap = new Map<number, FarcasterProfile>()
    for (let i = 0; i < fids.length; i++) {
      const profile = profiles[i]
      if (profile) {
        profileMap.set(fids[i], profile)
      }
    }

    return casts.map((cast) => {
      const profile = profileMap.get(cast.fid)
      return {
        hash: cast.hash,
        author: {
          fid: cast.fid,
          username: profile?.username ?? '',
          displayName: profile?.displayName ?? '',
          pfpUrl: profile?.pfpUrl ?? '',
        },
        text: cast.text,
        timestamp: cast.timestamp,
        embeds: cast.embeds
          .filter((e) => e.url)
          .map((e) => ({ url: e.url as string })),
        parentHash: cast.parentHash ?? undefined,
      }
    })
  }

  /**
   * Create agent notification
   */
  createNotification(payload: AgentNotification): {
    type: string
    title: string
    body: string
    data: Record<string, unknown>
    channel: string
  } {
    return {
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      channel: CRUCIBLE_CHANNEL_ID,
    }
  }

  /**
   * Generate agent created notification
   */
  agentCreatedNotification(params: {
    agentName: string
    characterName: string
    createdBy: string
  }): AgentNotification {
    return {
      type: 'agent_created',
      title: 'New Agent Created',
      body: `${params.createdBy} created agent "${params.agentName}" using ${params.characterName}`,
      data: {
        agentName: params.agentName,
        characterName: params.characterName,
        createdBy: params.createdBy,
      },
    }
  }

  /**
   * Generate agent joined room notification
   */
  agentJoinedNotification(params: {
    agentName: string
    roomName: string
  }): AgentNotification {
    return {
      type: 'agent_joined',
      title: 'Agent Joined Room',
      body: `${params.agentName} joined ${params.roomName}`,
      data: {
        agentName: params.agentName,
        roomName: params.roomName,
      },
    }
  }

  /**
   * Generate autonomous action notification
   */
  autonomousActionNotification(params: {
    agentName: string
    action: string
    result: string
  }): AgentNotification {
    return {
      type: 'autonomous_action',
      title: 'Autonomous Action',
      body: `${params.agentName}: ${params.action}`,
      data: {
        agentName: params.agentName,
        action: params.action,
        result: params.result,
      },
    }
  }
}

export const crucibleMessaging = new CrucibleMessagingService()
export { CrucibleMessagingService }
