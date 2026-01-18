/**
 * Farcaster Authentication Provider
 *
 * Best-in-class Farcaster integration with:
 * - Custody address verification
 * - Signer key delegation
 * - Frame authentication
 * - Verified address linking
 * - Profile data fetching
 * - Direct hub posting (permissionless)
 * - Sign In With Farcaster (SIWF)
 *
 * Config-first: Uses services.json for hub URL.
 * Falls back to public hub if config not available.
 *
 * SECURITY: Uses MPC signing via SecureSigningService.
 * Private keys are NEVER reconstructed in memory.
 */

import {
  getFarcasterApiUrl,
  getFarcasterHubUrl,
  getNeynarApiKey,
} from '@jejunetwork/config'
import {
  getSecureSigningService,
  type SecureSigningService,
} from '@jejunetwork/kms'
import { type Address, type Hex, keccak256, toBytes, toHex } from 'viem'
import { z } from 'zod'
import type {
  AuthProvider,
  FarcasterIdentity,
  FarcasterSignerRequest,
  LinkedProvider,
} from '../types.js'
import {
  CastSubmitResponseSchema,
  FrameValidationResponseSchema,
  HubUserDataResponseSchema,
  HubUsernameProofSchema,
  HubVerificationsResponseSchema,
  type NeynarCast,
  NeynarCastSchema,
  type NeynarUser,
  NeynarUserSchema,
  SIWFResultSchema,
  validateResponse,
} from '../validation.js'

// Config-first URLs with fallbacks
const FARCASTER_HUB_URL = getFarcasterHubUrl()
const FARCASTER_API_URL = getFarcasterApiUrl()
const NEYNAR_API_KEY = getNeynarApiKey()

/**
 * Farcaster session
 *
 * SECURITY: Uses keyId to reference MPC-managed keys instead of raw private keys.
 * The signerKeyId references a key managed by SecureSigningService.
 */
export interface FarcasterSession {
  fid: number
  profile: FarcasterProfile
  /**
   * Key ID for the signer key (managed by SecureSigningService)
   * SECURITY: References an MPC key - private key is NEVER reconstructed
   */
  signerKeyId?: string
  /**
   * Public key of the signer (derived from MPC key)
   */
  signerPublicKey?: Hex
  /**
   * Address of the signer (derived from MPC key)
   */
  signerAddress?: Address
  expiresAt?: number
}

/**
 * Signing callback for external signing (wallet/frame)
 */
export type FarcasterSignCallback = (message: Uint8Array) => Promise<Uint8Array>

export interface AuthChannelResult {
  channelToken: string
  url: string
  connectUri: string
  expiresAt: number
}

export interface PostedCast {
  hash: Hex
  fid: number
  text: string
  timestamp: number
  embeds?: string[]
  parentHash?: Hex
  parentUrl?: string
}

export interface CastOptions {
  replyTo?: { fid: number; hash: Hex }
  channelUrl?: string
  embeds?: string[]
  mentions?: number[]
  mentionPositions?: number[]
}

export interface FarcasterProfile {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  bio: string
  followerCount: number
  followingCount: number
  verifiedAddresses: Address[]
  custodyAddress: Address
  activeStatus: 'active' | 'inactive'
}

export interface FarcasterSigner {
  signerUuid: string
  publicKey: Hex
  status: 'pending_approval' | 'approved' | 'revoked'
  fid: number
  permissions: string[]
}

export interface FarcasterCast {
  hash: Hex
  author: FarcasterProfile
  text: string
  timestamp: number
  parentHash?: Hex
  parentUrl?: string
  embeds: Array<{ url: string }>
  reactions: { likes: number; recasts: number }
}

export interface FarcasterFrameContext {
  fid: number
  url: string
  messageHash: Hex
  timestamp: number
  network: number
  buttonIndex: number
  castId?: { fid: number; hash: Hex }
  inputText?: string
  state?: string
  transactionId?: Hex
  address?: Address
}

export interface FarcasterAuthMessage {
  domain: string
  address: Address
  uri: string
  version: string
  nonce: string
  issuedAt: string
  expirationTime?: string
  notBefore?: string
  resources?: string[]
  fid?: number
  custody?: Address
}

export interface FarcasterProviderConfig {
  apiKey?: string
  hubUrl?: string
  apiUrl?: string
  appName?: string
  appFid?: number
}

/**
 * Farcaster Provider
 *
 * SECURITY: All signing operations use FROST threshold signatures via SecureSigningService.
 * Private keys are NEVER reconstructed in memory.
 */
export class FarcasterProvider {
  private apiKey: string
  private hubUrl: string
  private apiUrl: string
  private useHubDirect: boolean
  private sessions: Map<number, FarcasterSession> = new Map()
  private signCallback?: FarcasterSignCallback
  private readonly signingService: SecureSigningService

  constructor(config?: FarcasterProviderConfig) {
    this.apiKey = config?.apiKey ?? NEYNAR_API_KEY
    this.hubUrl = config?.hubUrl ?? FARCASTER_HUB_URL
    this.apiUrl = config?.apiUrl ?? FARCASTER_API_URL
    this.useHubDirect = !this.apiKey
    this.signingService = getSecureSigningService()
  }

  /**
   * Create SIWF auth channel (for QR code / deep link auth)
   */
  async createAuthChannel(): Promise<AuthChannelResult> {
    const channelToken = crypto.randomUUID()
    const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes

    const params = new URLSearchParams({
      channelToken,
      nonce: crypto.randomUUID(),
      notBefore: new Date().toISOString(),
      expirationTime: new Date(expiresAt).toISOString(),
    })

    const connectUri = `https://warpcast.com/~/siwf?${params.toString()}`

    return {
      channelToken,
      url: connectUri,
      connectUri,
      expiresAt,
    }
  }

  /**
   * Poll auth channel for completion
   */
  async pollAuthChannel(
    channelToken: string,
  ): Promise<FarcasterSession | null> {
    const response = await fetch(
      `https://api.warpcast.com/v2/siwf/result?channelToken=${channelToken}`,
    )

    if (!response.ok) {
      return null
    }

    const result = SIWFResultSchema.safeParse(await response.json())
    if (!result.success || !result.data.result?.fid) {
      return null
    }
    const fid = result.data.result.fid

    const profile = await this.getProfileByFid(fid)

    const session: FarcasterSession = {
      fid,
      profile,
    }

    this.sessions.set(fid, session)

    return session
  }

  /**
   * Get session for FID
   */
  getSession(fid: number): FarcasterSession | null {
    return this.sessions.get(fid) ?? null
  }

  /**
   * Post a cast via hub
   */
  async cast(
    session: FarcasterSession,
    text: string,
    options?: CastOptions,
  ): Promise<PostedCast> {
    // Build cast message per Farcaster protocol
    const timestamp = this.getFarcasterTimestamp()
    const message = this.buildCastMessage(session.fid, text, timestamp, options)

    // Sign message
    const signature = await this.signMessage(session, message)

    // Submit to hub
    const hash = await this.submitToHub(message, signature)

    return {
      hash,
      fid: session.fid,
      text,
      timestamp: Date.now(),
      embeds: options?.embeds,
      parentHash: options?.replyTo?.hash,
      parentUrl: options?.channelUrl,
    }
  }

  /**
   * Reply to a cast
   */
  async reply(
    session: FarcasterSession,
    text: string,
    replyTo: { fid: number; hash: Hex },
    options?: Omit<CastOptions, 'replyTo'>,
  ): Promise<PostedCast> {
    return this.cast(session, text, { ...options, replyTo })
  }

  /**
   * Delete a cast
   */
  async deleteCast(session: FarcasterSession, castHash: Hex): Promise<void> {
    const timestamp = this.getFarcasterTimestamp()
    const message = {
      type: 'MESSAGE_TYPE_CAST_REMOVE',
      fid: session.fid,
      timestamp,
      castRemoveBody: {
        targetHash: castHash,
      },
    }

    const signature = await this.signMessage(session, message)
    await this.submitToHub(message, signature)
  }

  /**
   * Like a cast
   */
  async like(
    session: FarcasterSession,
    cast: { fid: number; hash: Hex },
  ): Promise<void> {
    const timestamp = this.getFarcasterTimestamp()
    const message = {
      type: 'MESSAGE_TYPE_REACTION_ADD',
      fid: session.fid,
      timestamp,
      reactionBody: {
        type: 'REACTION_TYPE_LIKE',
        targetCastId: { fid: cast.fid, hash: cast.hash },
      },
    }

    const signature = await this.signMessage(session, message)
    await this.submitToHub(message, signature)
  }

  /**
   * Unlike a cast
   */
  async unlike(
    session: FarcasterSession,
    cast: { fid: number; hash: Hex },
  ): Promise<void> {
    const timestamp = this.getFarcasterTimestamp()
    const message = {
      type: 'MESSAGE_TYPE_REACTION_REMOVE',
      fid: session.fid,
      timestamp,
      reactionBody: {
        type: 'REACTION_TYPE_LIKE',
        targetCastId: { fid: cast.fid, hash: cast.hash },
      },
    }

    const signature = await this.signMessage(session, message)
    await this.submitToHub(message, signature)
  }

  /**
   * Recast
   */
  async recast(
    session: FarcasterSession,
    cast: { fid: number; hash: Hex },
  ): Promise<void> {
    const timestamp = this.getFarcasterTimestamp()
    const message = {
      type: 'MESSAGE_TYPE_REACTION_ADD',
      fid: session.fid,
      timestamp,
      reactionBody: {
        type: 'REACTION_TYPE_RECAST',
        targetCastId: { fid: cast.fid, hash: cast.hash },
      },
    }

    const signature = await this.signMessage(session, message)
    await this.submitToHub(message, signature)
  }

  /**
   * Follow a user
   */
  async follow(session: FarcasterSession, targetFid: number): Promise<void> {
    const timestamp = this.getFarcasterTimestamp()
    const message = {
      type: 'MESSAGE_TYPE_LINK_ADD',
      fid: session.fid,
      timestamp,
      linkBody: {
        type: 'follow',
        targetFid,
      },
    }

    const signature = await this.signMessage(session, message)
    await this.submitToHub(message, signature)
  }

  /**
   * Unfollow a user
   */
  async unfollow(session: FarcasterSession, targetFid: number): Promise<void> {
    const timestamp = this.getFarcasterTimestamp()
    const message = {
      type: 'MESSAGE_TYPE_LINK_REMOVE',
      fid: session.fid,
      timestamp,
      linkBody: {
        type: 'follow',
        targetFid,
      },
    }

    const signature = await this.signMessage(session, message)
    await this.submitToHub(message, signature)
  }

  private getFarcasterTimestamp(): number {
    const FARCASTER_EPOCH = 1609459200 // Jan 1, 2021 00:00:00 UTC
    return Math.floor(Date.now() / 1000) - FARCASTER_EPOCH
  }

  private buildCastMessage(
    fid: number,
    text: string,
    timestamp: number,
    options?: CastOptions,
  ): Record<string, unknown> {
    const castAddBody: Record<string, unknown> = {
      text,
      embeds: (options?.embeds ?? []).map((url) => ({ url })),
      mentions: options?.mentions ?? [],
      mentionsPositions: options?.mentionPositions ?? [],
    }

    if (options?.replyTo) {
      castAddBody.parentCastId = {
        fid: options.replyTo.fid,
        hash: options.replyTo.hash,
      }
    } else if (options?.channelUrl) {
      castAddBody.parentUrl = options.channelUrl
    }

    return {
      type: 'MESSAGE_TYPE_CAST_ADD',
      fid,
      timestamp,
      castAddBody,
    }
  }

  /**
   * Sign a Farcaster message
   *
   * SECURITY: Uses FROST threshold signing via SecureSigningService.
   * Private keys are NEVER reconstructed in memory.
   */
  private async signMessage(
    session: FarcasterSession,
    message: Record<string, unknown>,
  ): Promise<Uint8Array> {
    // Hash the message using Farcaster's message encoding
    const messageBytes = new TextEncoder().encode(JSON.stringify(message))
    const messageHash = keccak256(messageBytes)

    // If session has a delegated signer key ID, use MPC signing
    if (session.signerKeyId) {
      if (!this.signingService.hasKey(session.signerKeyId)) {
        throw new Error(
          `Signer key ${session.signerKeyId} not found in SecureSigningService. ` +
            'Generate it first using getSecureSigningService().generateKey()',
        )
      }

      const result = await this.signingService.sign({
        keyId: session.signerKeyId,
        message: '',
        messageHash,
      })
      return toBytes(result.signature)
    }

    // If we have an external sign callback configured, use it
    if (this.signCallback) {
      return this.signCallback(toBytes(messageHash))
    }

    // Otherwise, throw - signing requires either a delegated key or callback
    throw new Error(
      'Cannot sign Farcaster message: no signer key or sign callback configured. ' +
        'Either set session.signerKeyId for delegated signing, or provide a signCallback.',
    )
  }

  /**
   * Set an external signing callback for wallet/frame integration
   */
  setSignCallback(callback: FarcasterSignCallback): void {
    this.signCallback = callback
  }

  /**
   * Clear the external signing callback
   */
  clearSignCallback(): void {
    this.signCallback = undefined
  }

  private async submitToHub(
    message: Record<string, unknown>,
    signature: Uint8Array,
  ): Promise<Hex> {
    const response = await fetch(`${this.hubUrl}/v1/submitMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...message,
        signature: toHex(signature),
      }),
    })

    if (!response.ok) {
      throw new Error(`Hub submission failed: ${response.status}`)
    }

    const result = validateResponse(
      CastSubmitResponseSchema,
      await response.json(),
      'hub submission response',
    )
    return result.hash as Hex
  }

  async getProfileByFid(fid: number): Promise<FarcasterProfile> {
    if (this.useHubDirect) {
      return this.getProfileFromHub(fid)
    }

    const response = await fetch(
      `${this.apiUrl}/farcaster/user/bulk?fids=${fid}`,
      {
        headers: this.getHeaders(),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch Farcaster profile: ${response.status}`)
    }

    const rawData = await response.json()
    const data = validateResponse(
      z.object({ users: z.array(NeynarUserSchema) }),
      rawData,
      'Neynar user bulk response',
    )
    const user = data.users[0]

    if (!user) {
      throw new Error(`Farcaster user not found: ${fid}`)
    }

    return this.mapNeynarUser(user)
  }

  private async getProfileFromHub(fid: number): Promise<FarcasterProfile> {
    const userDataResponse = await fetch(
      `${this.hubUrl}/v1/userDataByFid?fid=${fid}`,
    )
    if (!userDataResponse.ok) {
      throw new Error(
        `Failed to fetch user data from hub: ${userDataResponse.status}`,
      )
    }

    const rawUserData = await userDataResponse.json()
    const userData = validateResponse(
      HubUserDataResponseSchema,
      rawUserData,
      'Hub user data response',
    )

    const verificationsResponse = await fetch(
      `${this.hubUrl}/v1/verificationsByFid?fid=${fid}`,
    )
    const verifications = verificationsResponse.ok
      ? validateResponse(
          HubVerificationsResponseSchema,
          await verificationsResponse.json(),
          'Hub verifications response',
        )
      : { messages: [] }

    const profile: FarcasterProfile = {
      fid,
      username: '',
      displayName: '',
      pfpUrl: '',
      bio: '',
      followerCount: 0,
      followingCount: 0,
      verifiedAddresses: [],
      custodyAddress: '0x0' as Address,
      activeStatus: 'active',
    }

    for (const msg of userData.messages) {
      const type = msg.data.userDataBody.type
      const value = msg.data.userDataBody.value

      if (type === 'USER_DATA_TYPE_USERNAME') profile.username = value
      else if (type === 'USER_DATA_TYPE_DISPLAY') profile.displayName = value
      else if (type === 'USER_DATA_TYPE_PFP') profile.pfpUrl = value
      else if (type === 'USER_DATA_TYPE_BIO') profile.bio = value
    }

    profile.verifiedAddresses = verifications.messages
      .filter(
        (
          m,
        ): m is typeof m & {
          data: {
            verificationAddAddressBody: NonNullable<
              typeof m.data.verificationAddAddressBody
            >
          }
        } =>
          m.data.verificationAddAddressBody != null &&
          m.data.verificationAddAddressBody.protocol !== 'PROTOCOL_SOLANA' &&
          m.data.verificationAddAddressBody.address != null,
      )
      .map((m) => m.data.verificationAddAddressBody.address as Address)

    return profile
  }

  async getProfileByUsername(username: string): Promise<FarcasterProfile> {
    if (this.useHubDirect) {
      return this.getProfileByUsernameFromHub(username)
    }

    const response = await fetch(
      `${this.apiUrl}/farcaster/user/by_username?username=${username}`,
      {
        headers: this.getHeaders(),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch Farcaster profile: ${response.status}`)
    }

    const rawData = await response.json()
    const data = validateResponse(
      z.object({ user: NeynarUserSchema }),
      rawData,
      'Neynar user by username response',
    )
    return this.mapNeynarUser(data.user)
  }

  private async getProfileByUsernameFromHub(
    username: string,
  ): Promise<FarcasterProfile> {
    const proofResponse = await fetch(
      `${this.hubUrl}/v1/userNameProofByName?name=${username}`,
    )
    if (!proofResponse.ok) {
      throw new Error(`Username not found: ${username}`)
    }

    const rawProof = await proofResponse.json()
    const proof = validateResponse(
      HubUsernameProofSchema,
      rawProof,
      'Hub username proof',
    )
    return this.getProfileFromHub(proof.fid)
  }

  async getProfileByVerifiedAddress(
    address: Address,
  ): Promise<FarcasterProfile | null> {
    if (this.useHubDirect) {
      return this.getProfileByVerifiedAddressFromHub(address)
    }

    const response = await fetch(
      `${this.apiUrl}/farcaster/user/bulk-by-address?addresses=${address.toLowerCase()}`,
      { headers: this.getHeaders() },
    )

    if (!response.ok) {
      return null
    }

    const rawData = await response.json()
    const schema = z.record(z.string(), z.array(NeynarUserSchema))
    const result = schema.safeParse(rawData)
    if (!result.success) {
      return null
    }

    const users = result.data[address.toLowerCase()]
    if (!users || users.length === 0) {
      return null
    }

    const firstUser = users[0]
    if (!firstUser) return null
    return this.mapNeynarUser(firstUser)
  }

  private async getProfileByVerifiedAddressFromHub(
    address: Address,
  ): Promise<FarcasterProfile | null> {
    const response = await fetch(
      `${this.hubUrl}/v1/verificationsByFid?address=${address.toLowerCase()}`,
    )
    if (!response.ok) {
      return null
    }

    const rawData = await response.json()
    const result = HubVerificationsResponseSchema.safeParse(rawData)
    if (!result.success || result.data.messages.length === 0) {
      return null
    }

    const firstMessage = result.data.messages[0]
    if (!firstMessage) return null
    const fid = firstMessage.data.fid
    if (fid === undefined) {
      return null
    }

    return this.getProfileFromHub(fid)
  }

  async verifySignInMessage(
    message: string,
    signature: Hex,
    expectedFid?: number,
  ): Promise<{ valid: boolean; fid: number; custodyAddress: Address }> {
    const parsedMessage = this.parseSignInMessage(message)

    if (!parsedMessage.fid) {
      throw new Error('FID not found in message')
    }

    const profile = await this.getProfileByFid(parsedMessage.fid)

    if (expectedFid && parsedMessage.fid !== expectedFid) {
      return {
        valid: false,
        fid: parsedMessage.fid,
        custodyAddress: parsedMessage.custody ?? profile.custodyAddress,
      }
    }
    const messageHash = keccak256(toBytes(message))

    const response = await fetch(`${this.apiUrl}/farcaster/user/verify`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        fid: parsedMessage.fid,
        message_hash: messageHash,
        signature,
      }),
    })

    if (!response.ok) {
      return {
        valid: false,
        fid: parsedMessage.fid,
        custodyAddress: profile.custodyAddress,
      }
    }

    const rawData = await response.json()
    const data = validateResponse(
      z.object({ valid: z.boolean() }),
      rawData,
      'Verify response',
    )

    return {
      valid: data.valid,
      fid: parsedMessage.fid,
      custodyAddress: profile.custodyAddress,
    }
  }

  /**
   * Create a signer request for delegated signing
   *
   * SECURITY: Generates an MPC key for signing - private key is NEVER reconstructed
   */
  async createSignerRequest(
    fid: number,
    appName: string,
    appFid: number,
  ): Promise<FarcasterSignerRequest & { signerKeyId: string }> {
    // Generate a new MPC key for this signer
    const signerKeyId = `farcaster-signer-${fid}-${Date.now()}`
    const keyResult = await this.signingService.generateKey(signerKeyId)

    const deadline = Math.floor(Date.now() / 1000) + 86400

    const messageText = `Add signer ${keyResult.address} for FID ${fid} by app ${appName} (FID ${appFid}) before ${deadline}`
    const messageHash = keccak256(toBytes(messageText))

    // Sign using MPC - private key is NEVER reconstructed
    const signResult = await this.signingService.sign({
      keyId: signerKeyId,
      message: '',
      messageHash,
    })

    return {
      fid,
      signerPublicKey: keyResult.publicKey,
      signature: signResult.signature,
      deadline,
      signerKeyId, // Return the key ID so it can be stored in the session
    }
  }

  async registerSigner(
    request: FarcasterSignerRequest,
  ): Promise<FarcasterSigner> {
    const response = await fetch(`${this.apiUrl}/farcaster/signer/signed_key`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        signer_uuid: crypto.randomUUID(),
        public_key: request.signerPublicKey,
        fid: request.fid,
        deadline: request.deadline,
        signature: request.signature,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to register signer: ${response.status}`)
    }

    const rawData = await response.json()
    const schema = z.object({
      signerUuid: z.string(),
      publicKey: z.string(),
      status: z.enum(['pending_approval', 'approved', 'revoked']),
      fid: z.number().int(),
      permissions: z.array(z.string()),
    })

    const data = validateResponse(
      schema,
      rawData,
      'Signer registration response',
    )
    return {
      signerUuid: data.signerUuid,
      publicKey: data.publicKey as Hex,
      status: data.status,
      fid: data.fid,
      permissions: data.permissions,
    }
  }

  async validateFrameMessage(
    frameMessageBytes: Uint8Array,
  ): Promise<{ valid: boolean; context: FarcasterFrameContext }> {
    const response = await fetch(`${this.apiUrl}/farcaster/frame/validate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message_bytes_in_hex: toHex(frameMessageBytes),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to validate frame message: ${response.status}`)
    }

    const rawData = await response.json()
    const data = validateResponse(
      FrameValidationResponseSchema,
      rawData,
      'Frame validation response',
    )

    return {
      valid: data.valid,
      context: {
        fid: data.action.interactor.fid,
        url: data.action.url,
        messageHash: data.action.message_hash as Hex,
        timestamp: data.action.timestamp,
        network: data.action.network,
        buttonIndex: data.action.button_index,
        castId: data.action.cast_id
          ? {
              fid: data.action.cast_id.fid,
              hash: data.action.cast_id.hash as Hex,
            }
          : undefined,
        inputText: data.action.input_text,
        state: data.action.state,
        transactionId: data.action.transaction_id as Hex | undefined,
        address: data.action.address as Address | undefined,
      },
    }
  }

  async getCastsByFid(fid: number, limit = 25): Promise<FarcasterCast[]> {
    const response = await fetch(
      `${this.apiUrl}/farcaster/feed/user/casts?fid=${fid}&limit=${limit}`,
      { headers: this.getHeaders() },
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch casts: ${response.status}`)
    }

    const rawData = await response.json()
    const data = validateResponse(
      z.object({ casts: z.array(NeynarCastSchema) }),
      rawData,
      'Neynar casts response',
    )
    return data.casts.map(this.mapNeynarCast)
  }

  generateSignInMessage(params: {
    domain: string
    address: Address
    fid: number
    custody: Address
    nonce?: string
    expirationMinutes?: number
    resources?: string[]
  }): string {
    const now = new Date()
    const nonce = params.nonce ?? crypto.randomUUID()
    const expirationTime = new Date(
      now.getTime() + (params.expirationMinutes ?? 60) * 60 * 1000,
    )

    const message: FarcasterAuthMessage = {
      domain: params.domain,
      address: params.address,
      uri: `https://${params.domain}`,
      version: '1',
      nonce,
      issuedAt: now.toISOString(),
      expirationTime: expirationTime.toISOString(),
      fid: params.fid,
      custody: params.custody,
      resources: params.resources,
    }

    return this.formatSignInMessage(message)
  }

  private formatSignInMessage(msg: FarcasterAuthMessage): string {
    let message = `${msg.domain} wants you to sign in with your Ethereum account:\n`
    message += `${msg.address}\n\n`
    message += `Sign in with Farcaster\n\n`
    message += `URI: ${msg.uri}\n`
    message += `Version: ${msg.version}\n`
    message += `Chain ID: 1\n`
    message += `Nonce: ${msg.nonce}\n`
    message += `Issued At: ${msg.issuedAt}\n`

    if (msg.expirationTime) {
      message += `Expiration Time: ${msg.expirationTime}\n`
    }

    if (msg.fid) {
      message += `FID: ${msg.fid}\n`
    }

    if (msg.custody) {
      message += `Custody: ${msg.custody}\n`
    }

    if (msg.resources && msg.resources.length > 0) {
      message += `Resources:\n`
      for (const resource of msg.resources) {
        message += `- ${resource}\n`
      }
    }

    return message
  }

  private parseSignInMessage(message: string): FarcasterAuthMessage {
    const lines = message.split('\n')
    const result: Partial<FarcasterAuthMessage> = {}

    for (const line of lines) {
      if (line.startsWith('URI: ')) result.uri = line.slice(5)
      else if (line.startsWith('Version: ')) result.version = line.slice(9)
      else if (line.startsWith('Nonce: ')) result.nonce = line.slice(7)
      else if (line.startsWith('Issued At: ')) result.issuedAt = line.slice(11)
      else if (line.startsWith('Expiration Time: '))
        result.expirationTime = line.slice(17)
      else if (line.startsWith('FID: '))
        result.fid = parseInt(line.slice(5), 10)
      else if (line.startsWith('Custody: '))
        result.custody = line.slice(9) as Address
      else if (line.match(/^0x[a-fA-F0-9]{40}$/))
        result.address = line as Address
      else if (line.includes(' wants you to sign in')) {
        result.domain = line.split(' wants you to sign in')[0]
      }
    }

    return result as FarcasterAuthMessage
  }

  async toLinkedProvider(fid: number): Promise<LinkedProvider> {
    const profile = await this.getProfileByFid(fid)

    return {
      provider: 'farcaster' as AuthProvider,
      providerId: String(fid),
      providerHandle: profile.username,
      linkedAt: Date.now(),
      verified: true,
    }
  }

  async toFarcasterIdentity(fid: number): Promise<FarcasterIdentity> {
    const profile = await this.getProfileByFid(fid)

    return {
      fid: profile.fid,
      username: profile.username,
      displayName: profile.displayName,
      pfpUrl: profile.pfpUrl,
      bio: profile.bio,
      custodyAddress: profile.custodyAddress,
      verifiedAddresses: profile.verifiedAddresses,
      signerPublicKey: '0x' as Hex,
    }
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(this.apiKey && { api_key: this.apiKey }),
    }
  }

  private mapNeynarUser(user: NeynarUser): FarcasterProfile {
    return {
      fid: user.fid,
      username: user.username,
      displayName: user.display_name,
      pfpUrl: user.pfp_url,
      bio: user.profile?.bio?.text ?? '',
      followerCount: user.follower_count,
      followingCount: user.following_count,
      verifiedAddresses: (user.verified_addresses?.eth_addresses ??
        []) as Address[],
      custodyAddress: user.custody_address as Address,
      activeStatus: user.active_status as 'active' | 'inactive',
    }
  }

  private mapNeynarCast(cast: NeynarCast): FarcasterCast {
    return {
      hash: cast.hash as Hex,
      author: this.mapNeynarUser(cast.author),
      text: cast.text,
      timestamp: new Date(cast.timestamp).getTime(),
      parentHash: cast.parent_hash as Hex | undefined,
      parentUrl: cast.parent_url,
      embeds: cast.embeds ?? [],
      reactions: {
        likes: cast.reactions?.likes_count ?? 0,
        recasts: cast.reactions?.recasts_count ?? 0,
      },
    }
  }
}

export const farcasterProvider = new FarcasterProvider()
