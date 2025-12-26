import { getFarcasterHubUrl } from '@jejunetwork/config'
import {
  type FarcasterCast,
  FarcasterClient,
  type FarcasterProfile,
} from '@jejunetwork/messaging'
import type { Address } from 'viem'

const HUB_URL = getFarcasterHubUrl()
const GATEWAY_CHANNEL = 'gateway'
const GATEWAY_CHANNEL_URL = `https://warpcast.com/~/channel/${GATEWAY_CHANNEL}`

const profileCache = new Map<number, { profile: FarcasterProfile; cachedAt: number }>()
const CACHE_TTL = 5 * 60 * 1000

export interface GatewayFeedCast {
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

export interface NotificationPayload {
  type: 'bridge_complete' | 'intent_filled' | 'node_reward' | 'liquidity_update'
  title: string
  body: string
  data?: Record<string, unknown>
}

class GatewayMessagingService {
  private hubClient = new FarcasterClient({ hubUrl: HUB_URL })

  async getChannelFeed(options?: { limit?: number; cursor?: string }) {
    const response = await this.hubClient.getCastsByChannel(GATEWAY_CHANNEL_URL, {
      pageSize: options?.limit ?? 20,
      pageToken: options?.cursor,
    })
    const casts = await this.enrichCasts(response.messages)
    return { casts, cursor: response.nextPageToken }
  }

  async getProfile(fid: number): Promise<FarcasterProfile | null> {
    const cached = profileCache.get(fid)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached.profile

    const profile = await this.hubClient.getProfile(fid).catch(() => null)
    if (profile) profileCache.set(fid, { profile, cachedAt: Date.now() })
    return profile
  }

  async getFidByAddress(address: Address): Promise<number | null> {
    const profile = await this.hubClient.getProfileByVerifiedAddress(address)
    return profile?.fid ?? null
  }

  private async enrichCasts(casts: FarcasterCast[]): Promise<GatewayFeedCast[]> {
    const fids = [...new Set(casts.map((c) => c.fid))]
    const profiles = await Promise.all(fids.map((fid) => this.getProfile(fid)))
    const profileMap = new Map<number, FarcasterProfile>()
    for (let i = 0; i < fids.length; i++) {
      const profile = profiles[i]
      if (profile) profileMap.set(fids[i], profile)
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
        embeds: cast.embeds.filter((e) => e.url).map((e) => ({ url: e.url as string })),
        parentHash: cast.parentHash ?? undefined,
      }
    })
  }

  createNotification(payload: NotificationPayload) {
    return { ...payload, data: payload.data ?? {}, channel: GATEWAY_CHANNEL }
  }

  bridgeCompleteNotification(params: {
    fromChain: string
    toChain: string
    amount: string
    token: string
    txHash: string
  }): NotificationPayload {
    return {
      type: 'bridge_complete',
      title: 'Bridge Complete',
      body: `Bridged ${params.amount} ${params.token} from ${params.fromChain} to ${params.toChain}`,
      data: params,
    }
  }

  intentFilledNotification(params: {
    intentId: string
    solver: string
    fillAmount: string
  }): NotificationPayload {
    return {
      type: 'intent_filled',
      title: 'Intent Filled',
      body: `Intent filled by ${params.solver} for ${params.fillAmount}`,
      data: params,
    }
  }

  nodeRewardNotification(params: { nodeId: string; amount: string; epoch: number }): NotificationPayload {
    return {
      type: 'node_reward',
      title: 'Node Reward Earned',
      body: `Node earned ${params.amount} JEJU in epoch ${params.epoch}`,
      data: params,
    }
  }

  liquidityUpdateNotification(params: {
    poolId: string
    action: 'add' | 'remove'
    amount: string
    feesEarned?: string
  }): NotificationPayload {
    const isAdd = params.action === 'add'
    return {
      type: 'liquidity_update',
      title: isAdd ? 'Liquidity Added' : 'Liquidity Removed',
      body: isAdd
        ? `Added ${params.amount} liquidity`
        : `Removed ${params.amount} liquidity${params.feesEarned ? `, earned ${params.feesEarned}` : ''}`,
      data: params,
    }
  }
}

export const gatewayMessaging = new GatewayMessagingService()
export { GatewayMessagingService }
