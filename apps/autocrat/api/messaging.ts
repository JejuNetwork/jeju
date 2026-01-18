import {
  type FarcasterCast,
  FarcasterClient,
  type FarcasterProfile,
} from '@jejunetwork/messaging'
import type { Address } from 'viem'

import { config } from './config'

const HUB_URL = config.farcasterHubUrl
const AUTOCRAT_CHANNEL_ID = 'autocrat'
const AUTOCRAT_CHANNEL_URL = `https://warpcast.com/~/channel/${AUTOCRAT_CHANNEL_ID}`

// Cache for profiles
const profileCache = new Map<
  number,
  { profile: FarcasterProfile; cachedAt: number }
>()
const CACHE_TTL = 5 * 60 * 1000

export interface AutocratFeedCast {
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

export interface GovernanceNotification {
  type:
    | 'proposal_created'
    | 'proposal_passed'
    | 'proposal_failed'
    | 'vote_cast'
    | 'execution_complete'
  title: string
  body: string
  data?: Record<string, unknown>
}

class AutocratMessagingService {
  private hubClient: FarcasterClient

  constructor() {
    this.hubClient = new FarcasterClient({ hubUrl: HUB_URL })
  }

  /**
   * Get the Autocrat channel feed
   */
  async getChannelFeed(options?: {
    limit?: number
    cursor?: string
  }): Promise<{ casts: AutocratFeedCast[]; cursor?: string }> {
    const response = await this.hubClient.getCastsByChannel(
      AUTOCRAT_CHANNEL_URL,
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
   * Get a user's profile. Returns null if profile fetch fails.
   */
  async getProfile(fid: number): Promise<FarcasterProfile | null> {
    const cached = profileCache.get(fid)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return cached.profile
    }

    // Profile fetch may fail due to Hub API limitations
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
  ): Promise<AutocratFeedCast[]> {
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
   * Create governance notification
   */
  createNotification(payload: GovernanceNotification): {
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
      channel: AUTOCRAT_CHANNEL_ID,
    }
  }

  /**
   * Generate proposal created notification
   */
  proposalCreatedNotification(params: {
    proposalId: string
    title: string
    proposer: string
  }): GovernanceNotification {
    return {
      type: 'proposal_created',
      title: 'New Proposal',
      body: `${params.proposer} submitted: "${params.title}"`,
      data: {
        proposalId: params.proposalId,
        title: params.title,
        proposer: params.proposer,
      },
    }
  }

  /**
   * Generate proposal passed notification
   */
  proposalPassedNotification(params: {
    proposalId: string
    title: string
    votesFor: string
    votesAgainst: string
  }): GovernanceNotification {
    return {
      type: 'proposal_passed',
      title: 'Proposal Passed',
      body: `"${params.title}" passed with ${params.votesFor} for / ${params.votesAgainst} against`,
      data: {
        proposalId: params.proposalId,
        title: params.title,
        votesFor: params.votesFor,
        votesAgainst: params.votesAgainst,
      },
    }
  }

  /**
   * Generate vote cast notification
   */
  voteCastNotification(params: {
    proposalId: string
    proposalTitle: string
    voter: string
    support: boolean
    weight: string
  }): GovernanceNotification {
    return {
      type: 'vote_cast',
      title: 'Vote Cast',
      body: `${params.voter} voted ${params.support ? 'for' : 'against'} "${params.proposalTitle}"`,
      data: {
        proposalId: params.proposalId,
        proposalTitle: params.proposalTitle,
        voter: params.voter,
        support: params.support,
        weight: params.weight,
      },
    }
  }

  /**
   * Generate execution complete notification
   */
  executionCompleteNotification(params: {
    proposalId: string
    title: string
    txHash: string
  }): GovernanceNotification {
    return {
      type: 'execution_complete',
      title: 'Proposal Executed',
      body: `"${params.title}" has been executed on-chain`,
      data: {
        proposalId: params.proposalId,
        title: params.title,
        txHash: params.txHash,
      },
    }
  }
}

export const autocratMessaging = new AutocratMessagingService()
export { AutocratMessagingService }
