import type { Address, Hex } from 'viem'
import {
  CastsResponseSchema,
  EventsResponseSchema,
  type HubEventBody,
  type HubEventType,
  HubInfoResponseSchema,
  LinksResponseSchema,
  type ParsedCastMessage,
  ReactionsResponseSchema,
  SingleCastResponseSchema,
  USER_DATA_TYPE_MAP,
  UserDataResponseSchema,
  UsernameProofResponseSchema,
  VerificationLookupResponseSchema,
  VerificationsResponseSchema,
} from './schemas'
import type {
  CastFilter,
  FarcasterCast,
  FarcasterLink,
  FarcasterProfile,
  FarcasterReaction,
  FarcasterVerification,
  HubConfig,
  HubInfoResponse,
  PaginatedResponse,
  UserData,
  UserDataTypeName,
} from './types'

const DEFAULT_TIMEOUT = 10000
const DEFAULT_HUB_URL = 'https://nemes.farcaster.xyz:2281'

export class HubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code:
      | 'NOT_FOUND'
      | 'RATE_LIMITED'
      | 'UNAUTHORIZED'
      | 'NETWORK'
      | 'UNKNOWN',
  ) {
    super(message)
    this.name = 'HubError'
  }

  static fromResponse(status: number, statusText: string): HubError {
    if (status === 404)
      return new HubError(`Not found: ${statusText}`, status, 'NOT_FOUND')
    if (status === 429)
      return new HubError(`Rate limited: ${statusText}`, status, 'RATE_LIMITED')
    if (status === 401 || status === 403)
      return new HubError(`Unauthorized: ${statusText}`, status, 'UNAUTHORIZED')
    return new HubError(`Hub error: ${status} ${statusText}`, status, 'UNKNOWN')
  }
}

function parseCastMessage(msg: ParsedCastMessage): FarcasterCast {
  return {
    hash: msg.hash as Hex,
    fid: msg.data.fid,
    text: msg.data.castAddBody.text,
    timestamp: msg.data.timestamp,
    parentHash: msg.data.castAddBody.parentCastId?.hash as Hex | undefined,
    parentFid: msg.data.castAddBody.parentCastId?.fid,
    parentUrl: msg.data.castAddBody.parentUrl,
    embeds: msg.data.castAddBody.embeds.map((e) => ({
      url: e.url,
      castId: e.castId
        ? { fid: e.castId.fid, hash: e.castId.hash as Hex }
        : undefined,
    })),
    mentions: msg.data.castAddBody.mentions,
    mentionsPositions: msg.data.castAddBody.mentionsPositions,
  }
}

function parseLinkMessage(msg: {
  data: { fid: number; timestamp: number; linkBody: { targetFid: number } }
}): FarcasterLink {
  return {
    fid: msg.data.fid,
    targetFid: msg.data.linkBody.targetFid,
    type: 'follow' as const,
    timestamp: msg.data.timestamp,
  }
}

export class FarcasterClient {
  private readonly httpUrl: string
  private readonly timeoutMs: number

  constructor(config: Partial<HubConfig> = {}) {
    const hubUrl = config.hubUrl ?? DEFAULT_HUB_URL
    this.httpUrl = config.httpUrl ?? this.deriveHttpUrl(hubUrl)
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT
  }

  private deriveHttpUrl(hubUrl: string): string {
    // If URL already has protocol, validate and return as-is
    if (hubUrl.startsWith('http://') || hubUrl.startsWith('https://')) {
      return hubUrl
    }

    // Strip any protocol prefix if present
    const cleanUrl = hubUrl.replace(/^https?:\/\//, '')
    const parts = cleanUrl.split(':')
    const host = parts[0]
    const hasPort = parts.length > 1

    // Use HTTPS for production, HTTP only for localhost
    const isLocalhost = host === 'localhost' || host === '127.0.0.1'
    const protocol = isLocalhost ? 'http' : 'https'

    // For localhost without explicit port, use 2281
    // For production without port, use HTTPS on 443 (no port in URL)
    if (hasPort) {
      return `${protocol}://${cleanUrl}`
    } else if (isLocalhost) {
      return `${protocol}://${host}:2281`
    } else {
      return `${protocol}://${host}`
    }
  }

  private async fetch(
    path: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(path, this.httpUrl)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value)
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    }).finally(() => clearTimeout(timeout))

    if (!response.ok) {
      throw HubError.fromResponse(response.status, response.statusText)
    }

    return response.json()
  }

  async getHubInfo(): Promise<HubInfoResponse> {
    const data = await this.fetch('/v1/info')
    return HubInfoResponseSchema.parse(data)
  }

  async isSyncing(): Promise<boolean> {
    return (await this.getHubInfo()).isSyncing
  }

  async getProfile(fid: number): Promise<FarcasterProfile> {
    const [userData, verifications, followers, following] = await Promise.all([
      this.getUserDataByFid(fid),
      this.getVerificationsByFid(fid),
      this.getLinksByTargetFid(fid),
      this.getLinksByFid(fid),
    ])

    const profile: FarcasterProfile = {
      fid,
      username: '',
      displayName: '',
      bio: '',
      pfpUrl: '',
      custodyAddress: '0x0' as Address,
      verifiedAddresses: verifications
        .filter((v) => v.protocol === 'ethereum')
        .map((v) => v.address),
      followerCount: followers.messages.length,
      followingCount: following.messages.length,
      registeredAt: 0,
    }

    for (const data of userData) {
      if (data.type === 'username') profile.username = data.value
      else if (data.type === 'display') profile.displayName = data.value
      else if (data.type === 'bio') profile.bio = data.value
      else if (data.type === 'pfp') profile.pfpUrl = data.value

      if (!profile.registeredAt || data.timestamp < profile.registeredAt) {
        profile.registeredAt = data.timestamp
      }
    }

    return profile
  }

  async getProfileByUsername(
    username: string,
  ): Promise<FarcasterProfile | null> {
    let data: unknown
    try {
      data = await this.fetch('/v1/userNameProofByName', { name: username })
    } catch (e) {
      if (e instanceof HubError && e.code === 'NOT_FOUND') return null
      throw e
    }
    const response = UsernameProofResponseSchema.parse(data)
    const firstProof = response.proofs[0]
    if (firstProof) {
      return this.getProfile(firstProof.fid)
    }
    return null
  }

  async getProfileByVerifiedAddress(
    address: Address,
  ): Promise<FarcasterProfile | null> {
    let data: unknown
    try {
      data = await this.fetch('/v1/verificationsByFid', {
        address: address.toLowerCase(),
      })
    } catch (e) {
      if (e instanceof HubError && e.code === 'NOT_FOUND') return null
      throw e
    }
    const response = VerificationLookupResponseSchema.parse(data)
    const firstMessage = response.messages[0]
    if (firstMessage) {
      return this.getProfile(firstMessage.data.fid)
    }
    return null
  }

  async getUserDataByFid(fid: number): Promise<UserData[]> {
    const data = await this.fetch('/v1/userDataByFid', { fid: fid.toString() })
    const response = UserDataResponseSchema.parse(data)

    return response.messages.map((msg) => {
      const mappedType = USER_DATA_TYPE_MAP[msg.data.userDataBody.type]
      return {
        fid: msg.data.fid,
        type: mappedType as UserDataTypeName,
        value: msg.data.userDataBody.value,
        timestamp: msg.data.timestamp,
      }
    })
  }

  async getCastsByFid(
    fid: number,
    options: CastFilter = {},
  ): Promise<PaginatedResponse<FarcasterCast>> {
    const params: Record<string, string> = { fid: fid.toString() }
    if (options.pageSize) params.pageSize = options.pageSize.toString()
    if (options.pageToken) params.pageToken = options.pageToken
    if (options.reverse) params.reverse = 'true'

    const data = await this.fetch('/v1/castsByFid', params)
    const response = CastsResponseSchema.parse(data)

    return {
      messages: response.messages.map(parseCastMessage),
      nextPageToken: response.nextPageToken,
    }
  }

  async getCastsByChannel(
    channelUrl: string,
    options: CastFilter = {},
  ): Promise<PaginatedResponse<FarcasterCast>> {
    const params: Record<string, string> = { url: channelUrl }
    if (options.pageSize) params.pageSize = options.pageSize.toString()
    if (options.pageToken) params.pageToken = options.pageToken

    const data = await this.fetch('/v1/castsByParent', params)
    const response = CastsResponseSchema.parse(data)

    return {
      messages: response.messages.map(parseCastMessage),
      nextPageToken: response.nextPageToken,
    }
  }

  async getCast(fid: number, hash: Hex): Promise<FarcasterCast | null> {
    let data: unknown
    try {
      data = await this.fetch('/v1/castById', { fid: fid.toString(), hash })
    } catch (e) {
      if (e instanceof HubError && e.code === 'NOT_FOUND') return null
      throw e
    }
    const response = SingleCastResponseSchema.parse(data)
    return parseCastMessage(response)
  }

  async getReactionsByFid(
    fid: number,
  ): Promise<PaginatedResponse<FarcasterReaction>> {
    const data = await this.fetch('/v1/reactionsByFid', { fid: fid.toString() })
    const response = ReactionsResponseSchema.parse(data)

    return {
      messages: response.messages.map((msg) => ({
        fid: msg.data.fid,
        targetFid: msg.data.reactionBody.targetCastId.fid,
        targetHash: msg.data.reactionBody.targetCastId.hash as Hex,
        type:
          msg.data.reactionBody.type === 'REACTION_TYPE_LIKE'
            ? 'like'
            : 'recast',
        timestamp: msg.data.timestamp,
      })),
      nextPageToken: response.nextPageToken,
    }
  }

  async getLinksByFid(fid: number): Promise<PaginatedResponse<FarcasterLink>> {
    const data = await this.fetch('/v1/linksByFid', { fid: fid.toString() })
    const response = LinksResponseSchema.parse(data)

    return {
      messages: response.messages.map(parseLinkMessage),
      nextPageToken: response.nextPageToken,
    }
  }

  async getLinksByTargetFid(
    targetFid: number,
  ): Promise<PaginatedResponse<FarcasterLink>> {
    const data = await this.fetch('/v1/linksByTargetFid', {
      target_fid: targetFid.toString(),
    })
    const response = LinksResponseSchema.parse(data)

    return {
      messages: response.messages.map(parseLinkMessage),
      nextPageToken: response.nextPageToken,
    }
  }

  async getVerificationsByFid(fid: number): Promise<FarcasterVerification[]> {
    const data = await this.fetch('/v1/verificationsByFid', {
      fid: fid.toString(),
    })
    const response = VerificationsResponseSchema.parse(data)

    return response.messages.map((msg) => ({
      fid: msg.data.fid,
      address: msg.data.verificationAddAddressBody.address as Address,
      protocol:
        msg.data.verificationAddAddressBody.protocol === 'PROTOCOL_SOLANA'
          ? 'solana'
          : 'ethereum',
      timestamp: msg.data.timestamp,
      chainId: msg.data.verificationAddAddressBody.chainId,
    }))
  }

  async *subscribeToEvents(fromEventId?: number): AsyncGenerator<HubEvent> {
    let currentEventId = fromEventId ?? 0

    while (true) {
      const data = await this.fetch('/v1/events', {
        from_event_id: currentEventId.toString(),
      })
      const response = EventsResponseSchema.parse(data)

      for (const event of response.events) {
        currentEventId = event.id
        yield {
          id: event.id,
          type: event.type,
          body: event.body,
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

export interface HubEvent {
  id: number
  type: HubEventType
  body: HubEventBody
}
