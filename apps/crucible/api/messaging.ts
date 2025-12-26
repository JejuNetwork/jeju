/**
 * Crucible Messaging Service
 *
 * Provides Farcaster feed integration for the Crucible agent platform.
 * Uses the /crucible channel for agent updates, community discussions, etc.
 */

import {
  type FarcasterCast,
  FarcasterClient,
  type FarcasterProfile,
} from '@jejunetwork/messaging'
import type { Address } from 'viem'

const HUB_URL = process.env.FARCASTER_HUB_URL ?? 'https://hub.pinata.cloud'
const CRUCIBLE_CHANNEL_ID = 'crucible'
const CRUCIBLE_CHANNEL_URL = `https://warpcast.com/~/channel/${CRUCIBLE_CHANNEL_ID}`

// Cache for profiles
const profileCache = new Map<
  number,
  { profile: FarcasterProfile; cachedAt: number }
>()
const CACHE_TTL = 5 * 60 * 1000

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
    const cached = profileCache.get(fid)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return cached.profile
    }

    // Profile fetch may fail due to Hub API limitations (e.g. getLinksByTargetFid returns 400)
    // In that case, return null and let the caller handle it gracefully
    const profile = await this.hubClient.getProfile(fid).catch(() => null)
    if (profile) {
      profileCache.set(fid, { profile, cachedAt: Date.now() })
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
