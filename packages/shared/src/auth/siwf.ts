/**
 * SIWF - Sign In With Farcaster
 *
 * Farcaster-based authentication using Farcaster Auth (AuthKit).
 * Supports both custody address signing and delegated signers.
 */

import { expectValid } from '@jejunetwork/types'
import { type Address, type Hex, verifyMessage } from 'viem'
import {
  FarcasterChannelResponseSchema,
  FarcasterChannelStatusResponseSchema,
  FarcasterUserDataResponseSchema,
} from '../schemas'
import { generateNonce } from './siwe'
import type { SIWFMessage } from './types'

export interface FarcasterUser {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  bio: string
  custodyAddress: Address
  verifiedAddresses: Address[]
}

export interface FarcasterAuthResult {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
  custodyAddress: Address
  signature: Hex
  message: string
  nonce: string
}

/**
 * Create a SIWF message object
 */
export function createSIWFMessage(params: {
  domain: string
  fid: number
  custody: Address
  nonce?: string
  expirationMinutes?: number
}): SIWFMessage {
  const now = new Date()
  const nonce = params.nonce || generateNonce()

  const expirationTime = params.expirationMinutes
    ? new Date(
        now.getTime() + params.expirationMinutes * 60 * 1000,
      ).toISOString()
    : undefined

  return {
    domain: params.domain,
    fid: params.fid,
    custody: params.custody,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime,
  }
}

/**
 * Format SIWF message for signing
 */
export function formatSIWFMessage(message: SIWFMessage): string {
  return [
    `${message.domain} wants you to sign in with your Farcaster account:`,
    `FID: ${message.fid}`,
    `Custody Address: ${message.custody}`,
    '',
    `Nonce: ${message.nonce}`,
    `Issued At: ${message.issuedAt}`,
    message.expirationTime ? `Expiration Time: ${message.expirationTime}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Parse a SIWF message string back to object
 */
export function parseSIWFMessage(messageString: string): SIWFMessage {
  const lines = messageString.split('\n')

  const domainMatch = lines[0].match(
    /^(.+) wants you to sign in with your Farcaster account:$/,
  )
  const domain = domainMatch?.[1] || ''

  const message: Partial<SIWFMessage> = { domain }

  for (const line of lines) {
    if (line.startsWith('FID: ')) {
      message.fid = parseInt(line.slice(5), 10)
    } else if (line.startsWith('Custody Address: ')) {
      message.custody = line.slice(17) as Address
    } else if (line.startsWith('Nonce: ')) {
      message.nonce = line.slice(7)
    } else if (line.startsWith('Issued At: ')) {
      message.issuedAt = line.slice(11)
    } else if (line.startsWith('Expiration Time: ')) {
      message.expirationTime = line.slice(17)
    }
  }

  return message as SIWFMessage
}

// Maximum age for message issuedAt timestamp (5 minutes)
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000
// Maximum future tolerance for clock skew (30 seconds)
const MAX_FUTURE_TOLERANCE_MS = 30 * 1000

/**
 * Verify a SIWF signature
 *
 * SECURITY: Validates both expiration and issuedAt timestamps to prevent
 * replay attacks with old or pre-dated messages.
 */
export async function verifySIWFSignature(params: {
  message: SIWFMessage | string
  signature: Hex
  /** Maximum age of message in milliseconds (default: 5 minutes) */
  maxMessageAgeMs?: number
}): Promise<{ valid: boolean; fid: number; custody: Address; error?: string }> {
  const messageString =
    typeof params.message === 'string'
      ? params.message
      : formatSIWFMessage(params.message)

  const parsedMessage =
    typeof params.message === 'string'
      ? parseSIWFMessage(params.message)
      : params.message

  const now = new Date()
  const maxAge = params.maxMessageAgeMs ?? MAX_MESSAGE_AGE_MS

  // SECURITY: Validate issuedAt is not in the future (with small tolerance for clock skew)
  if (parsedMessage.issuedAt) {
    const issuedAtDate = new Date(parsedMessage.issuedAt)
    const futureThreshold = new Date(now.getTime() + MAX_FUTURE_TOLERANCE_MS)

    if (issuedAtDate > futureThreshold) {
      return {
        valid: false,
        fid: parsedMessage.fid,
        custody: parsedMessage.custody,
        error: 'Message issuedAt is in the future',
      }
    }

    // SECURITY: Validate issuedAt is not too old (replay attack prevention)
    const oldestAllowed = new Date(now.getTime() - maxAge)
    if (issuedAtDate < oldestAllowed) {
      return {
        valid: false,
        fid: parsedMessage.fid,
        custody: parsedMessage.custody,
        error: `Message is too old (issued more than ${Math.round(maxAge / 60000)} minutes ago)`,
      }
    }
  }

  // Check expiration
  if (parsedMessage.expirationTime) {
    const expirationDate = new Date(parsedMessage.expirationTime)
    if (expirationDate < now) {
      return {
        valid: false,
        fid: parsedMessage.fid,
        custody: parsedMessage.custody,
        error: 'Message expired',
      }
    }
  }

  // Verify signature against custody address
  const valid = await verifyMessage({
    address: parsedMessage.custody,
    message: messageString,
    signature: params.signature,
  })

  return { valid, fid: parsedMessage.fid, custody: parsedMessage.custody }
}

/**
 * Farcaster AuthKit configuration
 */
export interface AuthKitConfig {
  domain: string
  siweUri: string
  rpcUrl: string
  relay?: string
  version?: string
}

/**
 * Generate AuthKit channel URL for QR code
 */
export function generateAuthKitUrl(params: {
  channelToken: string
  nonce: string
  domain: string
}): string {
  const baseUrl = 'https://warpcast.com/~/sign-in-with-farcaster'
  const searchParams = new URLSearchParams({
    channelToken: params.channelToken,
    nonce: params.nonce,
    domain: params.domain,
  })
  return `${baseUrl}?${searchParams.toString()}`
}

/**
 * Create a Farcaster auth channel (server-side)
 */
export async function createAuthChannel(params: {
  domain: string
  siweUri: string
  nonce: string
  relay?: string
}): Promise<{ channelToken: string; url: string }> {
  const relay = params.relay || 'https://relay.farcaster.xyz'

  const response = await fetch(`${relay}/v1/channel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siweUri: params.siweUri,
      domain: params.domain,
      nonce: params.nonce,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to create auth channel: ${response.status}`)
  }

  const data = expectValid(
    FarcasterChannelResponseSchema,
    await response.json(),
    'Farcaster auth channel response',
  )

  return {
    channelToken: data.channelToken,
    url: generateAuthKitUrl({
      channelToken: data.channelToken,
      nonce: params.nonce,
      domain: params.domain,
    }),
  }
}

/**
 * Poll for auth completion (server-side)
 */
export async function pollAuthChannel(params: {
  channelToken: string
  relay?: string
  timeoutMs?: number
  pollIntervalMs?: number
}): Promise<FarcasterAuthResult | null> {
  const relay = params.relay || 'https://relay.farcaster.xyz'
  const timeoutMs = params.timeoutMs || 300000 // 5 minutes
  const pollIntervalMs = params.pollIntervalMs || 1500

  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const response = await fetch(
      `${relay}/v1/channel/status?channelToken=${params.channelToken}`,
    )

    if (!response.ok) {
      throw new Error(`Failed to poll auth channel: ${response.status}`)
    }

    // Use safeParse for external Farcaster relay API - may return unexpected formats during polling
    const parseResult = FarcasterChannelStatusResponseSchema.safeParse(
      await response.json(),
    )
    if (!parseResult.success) {
      console.warn(
        '[SIWF] Invalid channel status response:',
        parseResult.error.message,
      )
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      continue
    }

    const data = parseResult.data

    if (
      data.state === 'completed' &&
      data.fid &&
      data.custodyAddress &&
      data.signature &&
      data.message &&
      data.nonce
    ) {
      return {
        fid: data.fid,
        username: data.username || '',
        displayName: data.displayName || '',
        pfpUrl: data.pfpUrl || '',
        custodyAddress: data.custodyAddress,
        signature: data.signature,
        message: data.message,
        nonce: data.nonce,
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  return null
}

/**
 * Fetch Farcaster user profile by FID
 */
export async function getFarcasterUser(params: {
  fid: number
  hubUrl?: string
}): Promise<FarcasterUser | null> {
  const hubUrl = params.hubUrl || 'https://hub.pinata.cloud'

  const response = await fetch(
    `${hubUrl}/v1/userDataByFid?fid=${params.fid}`,
  ).catch(() => null)
  if (!response?.ok) return null

  // Use safeParse for external Farcaster Hub API - may return unexpected formats
  const parseResult = FarcasterUserDataResponseSchema.safeParse(
    await response.json(),
  )
  if (!parseResult.success) {
    console.warn(
      '[SIWF] Invalid Farcaster user data response:',
      parseResult.error.message,
    )
    return null
  }
  const data = parseResult.data

  if (!data.messages?.length) return null

  const user: Partial<FarcasterUser> = {
    fid: params.fid,
    verifiedAddresses: [],
  }

  for (const msg of data.messages) {
    const body = msg.data.userDataBody
    if (body) {
      switch (body.type) {
        case 'USER_DATA_TYPE_PFP':
          user.pfpUrl = body.value
          break
        case 'USER_DATA_TYPE_DISPLAY':
          user.displayName = body.value
          break
        case 'USER_DATA_TYPE_BIO':
          user.bio = body.value
          break
        case 'USER_DATA_TYPE_USERNAME':
          user.username = body.value
          break
      }
    }
    const verification = msg.data.verificationAddEthAddressBody
    if (verification) {
      user.verifiedAddresses?.push(verification.address as Address)
    }
  }

  return user as FarcasterUser
}
