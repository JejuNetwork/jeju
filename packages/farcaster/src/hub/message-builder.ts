/**
 * Farcaster Message Builder
 *
 * Builds and signs messages per Farcaster protocol spec.
 * Uses Ed25519 for signatures and BLAKE3 for hashing.
 */

import { ed25519 } from '@noble/curves/ed25519'
import { blake3 } from '@noble/hashes/blake3'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'

// Farcaster epoch: Jan 1, 2021 00:00:00 UTC
const FARCASTER_EPOCH = 1609459200

// ============ Enums ============

export const MessageType = {
  CAST_ADD: 1,
  CAST_REMOVE: 2,
  REACTION_ADD: 3,
  REACTION_REMOVE: 4,
  LINK_ADD: 5,
  LINK_REMOVE: 6,
  VERIFICATION_ADD_ETH_ADDRESS: 7,
  VERIFICATION_REMOVE: 8,
  USER_DATA_ADD: 11,
  FRAME_ACTION: 13,
} as const
export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export const ReactionType = {
  LIKE: 1,
  RECAST: 2,
} as const
export type ReactionType = (typeof ReactionType)[keyof typeof ReactionType]

export const UserDataType = {
  PFP: 1,
  DISPLAY: 2,
  BIO: 3,
  URL: 5,
  USERNAME: 6,
} as const
export type UserDataType = (typeof UserDataType)[keyof typeof UserDataType]

export const HashScheme = {
  BLAKE3: 1,
} as const
export type HashScheme = (typeof HashScheme)[keyof typeof HashScheme]

export const SignatureScheme = {
  ED25519: 1,
} as const
export type SignatureScheme =
  (typeof SignatureScheme)[keyof typeof SignatureScheme]

export const FarcasterNetwork = {
  MAINNET: 1,
  TESTNET: 2,
  DEVNET: 3,
} as const
export type FarcasterNetwork =
  (typeof FarcasterNetwork)[keyof typeof FarcasterNetwork]

// ============ Types ============

export interface CastId {
  fid: number
  hash: Uint8Array
}

export interface Embed {
  url?: string
  castId?: CastId
}

export interface CastAddBody {
  text: string
  embeds?: Embed[]
  mentions?: number[]
  mentionsPositions?: number[]
  parentCastId?: CastId
  parentUrl?: string
}

export interface CastRemoveBody {
  targetHash: Uint8Array
}

export interface ReactionBody {
  type: ReactionType
  targetCastId?: CastId
  targetUrl?: string
}

export interface LinkBody {
  type: string
  targetFid: number
}

export interface UserDataBody {
  type: UserDataType
  value: string
}

export interface VerificationAddBody {
  address: Uint8Array
  claimSignature: Uint8Array
  blockHash: Uint8Array
  verificationType: number
  chainId: number
  protocol: number
}

export interface MessageData {
  type: MessageType
  fid: number
  timestamp: number
  network: FarcasterNetwork
  castAddBody?: CastAddBody
  castRemoveBody?: CastRemoveBody
  reactionBody?: ReactionBody
  linkBody?: LinkBody
  userDataBody?: UserDataBody
  verificationAddBody?: VerificationAddBody
}

export interface Message {
  data: MessageData
  hash: Uint8Array
  hashScheme: HashScheme
  signature: Uint8Array
  signatureScheme: SignatureScheme
  signer: Uint8Array
}

// ============ Timestamp Functions ============

/**
 * Get current Farcaster timestamp (seconds since Farcaster epoch)
 */
export function getFarcasterTimestamp(): number {
  return Math.floor(Date.now() / 1000) - FARCASTER_EPOCH
}

/**
 * Convert Unix timestamp to Farcaster timestamp
 */
export function toFarcasterTimestamp(unixTimestamp: number): number {
  return unixTimestamp - FARCASTER_EPOCH
}

/**
 * Convert Farcaster timestamp to Unix timestamp
 */
export function fromFarcasterTimestamp(farcasterTimestamp: number): number {
  return farcasterTimestamp + FARCASTER_EPOCH
}

// ============ Message Encoding ============

/**
 * Encode CastId for protobuf-like format
 */
function encodeCastId(castId: CastId): Uint8Array {
  // Field 1: fid (varint)
  // Field 2: hash (bytes)
  const fidBytes = encodeVarint(castId.fid)
  const hashBytes = castId.hash

  const result = new Uint8Array(2 + fidBytes.length + 2 + hashBytes.length)
  let offset = 0

  // Field 1: fid
  result[offset++] = 0x08 // field 1, wire type 0 (varint)
  result.set(fidBytes, offset)
  offset += fidBytes.length

  // Field 2: hash
  result[offset++] = 0x12 // field 2, wire type 2 (length-delimited)
  result[offset++] = hashBytes.length
  result.set(hashBytes, offset)

  return result
}

/**
 * Encode varint (protobuf style)
 */
function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = []
  while (value > 127) {
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  bytes.push(value)
  return new Uint8Array(bytes)
}

/**
 * Encode CastAddBody
 */
function encodeCastAddBody(body: CastAddBody): Uint8Array {
  const parts: Uint8Array[] = []

  // Field 1: text
  if (body.text) {
    const textBytes = new TextEncoder().encode(body.text)
    parts.push(new Uint8Array([0x0a, textBytes.length, ...textBytes]))
  }

  // Field 2: embeds
  if (body.embeds) {
    for (const embed of body.embeds) {
      if (embed.url) {
        const urlBytes = new TextEncoder().encode(embed.url)
        // Nested message: embed with url field
        const embedContent = new Uint8Array([
          0x0a,
          urlBytes.length,
          ...urlBytes,
        ])
        parts.push(new Uint8Array([0x12, embedContent.length, ...embedContent]))
      } else if (embed.castId) {
        const castIdBytes = encodeCastId(embed.castId)
        const embedContent = new Uint8Array([
          0x12,
          castIdBytes.length,
          ...castIdBytes,
        ])
        parts.push(new Uint8Array([0x12, embedContent.length, ...embedContent]))
      }
    }
  }

  // Field 3: mentions
  if (body.mentions && body.mentions.length > 0) {
    for (const mention of body.mentions) {
      const mentionBytes = encodeVarint(mention)
      parts.push(new Uint8Array([0x18, ...mentionBytes]))
    }
  }

  // Field 4: mentionsPositions
  if (body.mentionsPositions && body.mentionsPositions.length > 0) {
    for (const pos of body.mentionsPositions) {
      const posBytes = encodeVarint(pos)
      parts.push(new Uint8Array([0x20, ...posBytes]))
    }
  }

  // Field 5: parentCastId
  if (body.parentCastId) {
    const parentBytes = encodeCastId(body.parentCastId)
    parts.push(new Uint8Array([0x2a, parentBytes.length, ...parentBytes]))
  }

  // Field 6: parentUrl
  if (body.parentUrl) {
    const urlBytes = new TextEncoder().encode(body.parentUrl)
    parts.push(new Uint8Array([0x32, urlBytes.length, ...urlBytes]))
  }

  // Combine all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

/**
 * Encode MessageData to bytes for hashing
 */
export function encodeMessageData(data: MessageData): Uint8Array {
  const parts: Uint8Array[] = []

  // Field 1: type (enum, varint)
  parts.push(new Uint8Array([0x08, ...encodeVarint(data.type)]))

  // Field 2: fid
  parts.push(new Uint8Array([0x10, ...encodeVarint(data.fid)]))

  // Field 3: timestamp
  parts.push(new Uint8Array([0x18, ...encodeVarint(data.timestamp)]))

  // Field 4: network
  parts.push(new Uint8Array([0x20, ...encodeVarint(data.network)]))

  // Body fields based on type
  if (data.castAddBody) {
    const bodyBytes = encodeCastAddBody(data.castAddBody)
    parts.push(new Uint8Array([0x2a, bodyBytes.length, ...bodyBytes]))
  }

  if (data.castRemoveBody) {
    const hashBytes = data.castRemoveBody.targetHash
    const bodyBytes = new Uint8Array([0x0a, hashBytes.length, ...hashBytes])
    parts.push(new Uint8Array([0x32, bodyBytes.length, ...bodyBytes]))
  }

  if (data.reactionBody) {
    const body = data.reactionBody
    const bodyParts: Uint8Array[] = []

    // type
    bodyParts.push(new Uint8Array([0x08, body.type]))

    // targetCastId
    if (body.targetCastId) {
      const castIdBytes = encodeCastId(body.targetCastId)
      bodyParts.push(new Uint8Array([0x12, castIdBytes.length, ...castIdBytes]))
    }

    // targetUrl
    if (body.targetUrl) {
      const urlBytes = new TextEncoder().encode(body.targetUrl)
      bodyParts.push(new Uint8Array([0x1a, urlBytes.length, ...urlBytes]))
    }

    const bodyLength = bodyParts.reduce((sum, p) => sum + p.length, 0)
    const bodyBytes = new Uint8Array(bodyLength)
    let offset = 0
    for (const part of bodyParts) {
      bodyBytes.set(part, offset)
      offset += part.length
    }

    parts.push(new Uint8Array([0x3a, bodyBytes.length, ...bodyBytes]))
  }

  if (data.linkBody) {
    const body = data.linkBody
    const typeBytes = new TextEncoder().encode(body.type)
    const bodyBytes = new Uint8Array([
      0x0a,
      typeBytes.length,
      ...typeBytes,
      0x10,
      ...encodeVarint(body.targetFid),
    ])
    parts.push(new Uint8Array([0x42, bodyBytes.length, ...bodyBytes]))
  }

  if (data.userDataBody) {
    const body = data.userDataBody
    const valueBytes = new TextEncoder().encode(body.value)
    const bodyBytes = new Uint8Array([
      0x08,
      body.type,
      0x12,
      valueBytes.length,
      ...valueBytes,
    ])
    parts.push(new Uint8Array([0x4a, bodyBytes.length, ...bodyBytes]))
  }

  // Combine all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

// ============ Hashing & Signing ============

/**
 * Hash message data with BLAKE3 (truncated to 20 bytes per spec)
 */
export function hashMessageData(data: MessageData): Uint8Array {
  const encoded = encodeMessageData(data)
  const fullHash = blake3(encoded)
  // Truncate to 20 bytes per Farcaster spec
  return fullHash.slice(0, 20)
}

/**
 * Sign message hash with Ed25519
 */
export async function signMessageHash(
  hash: Uint8Array,
  signerPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  return ed25519.sign(hash, signerPrivateKey)
}

/**
 * Build a complete signed message
 */
export async function buildMessage(
  data: MessageData,
  signerPrivateKey: Uint8Array,
): Promise<Message> {
  const hash = hashMessageData(data)
  const signature = await signMessageHash(hash, signerPrivateKey)
  const signerPublicKey = ed25519.getPublicKey(signerPrivateKey)

  return {
    data,
    hash,
    hashScheme: HashScheme.BLAKE3,
    signature,
    signatureScheme: SignatureScheme.ED25519,
    signer: signerPublicKey,
  }
}

/**
 * Verify message signature
 *
 * IMPORTANT: This verifies that:
 * 1. The hash matches the message data (prevents hash substitution attacks)
 * 2. The signature is valid for the hash and signer
 */
export function verifyMessage(message: Message): boolean {
  // First, recompute the hash from the message data to prevent hash substitution
  const computedHash = hashMessageData(message.data)

  // Verify the provided hash matches the computed hash
  // Use constant-time comparison to prevent timing attacks
  if (!constantTimeEqual(message.hash, computedHash)) {
    return false
  }

  // Verify hash scheme is BLAKE3
  if (message.hashScheme !== HashScheme.BLAKE3) {
    return false
  }

  // Verify signature scheme is ED25519
  if (message.signatureScheme !== SignatureScheme.ED25519) {
    return false
  }

  // Verify the signature
  return ed25519.verify(message.signature, message.hash, message.signer)
}

/**
 * Constant-time comparison of two byte arrays
 * Prevents timing attacks by always comparing all bytes
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }

  return result === 0
}

// ============ Serialization ============

/**
 * Serialize message to bytes for hub submission
 */
export function serializeMessage(message: Message): Uint8Array {
  const parts: Uint8Array[] = []

  // Field 1: data (encoded)
  const dataBytes = encodeMessageData(message.data)
  parts.push(new Uint8Array([0x0a, dataBytes.length, ...dataBytes]))

  // Field 2: hash
  parts.push(new Uint8Array([0x12, message.hash.length, ...message.hash]))

  // Field 3: hashScheme
  parts.push(new Uint8Array([0x18, message.hashScheme]))

  // Field 4: signature
  parts.push(
    new Uint8Array([0x22, message.signature.length, ...message.signature]),
  )

  // Field 5: signatureScheme
  parts.push(new Uint8Array([0x28, message.signatureScheme]))

  // Field 6: signer
  parts.push(new Uint8Array([0x32, message.signer.length, ...message.signer]))

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

/**
 * Serialize message to hex string
 */
export function messageToHex(message: Message): Hex {
  return `0x${bytesToHex(serializeMessage(message))}` as Hex
}

/**
 * Get message hash as hex string
 */
export function getMessageHashHex(message: Message): Hex {
  return `0x${bytesToHex(message.hash)}` as Hex
}

// ============ Utilities ============

/**
 * Convert hex string to bytes
 */
export function hexToMessageBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  return hexToBytes(cleanHex)
}

/**
 * Convert bytes to hex string
 */
export function messageBytesToHex(bytes: Uint8Array): Hex {
  return `0x${bytesToHex(bytes)}` as Hex
}

/**
 * Create CastId from fid and hash
 */
export function createCastId(fid: number, hash: Hex | Uint8Array): CastId {
  const hashBytes = typeof hash === 'string' ? hexToMessageBytes(hash) : hash
  return { fid, hash: hashBytes }
}
