import { type Address, type Hex, verifyMessage } from 'viem'
import { FarcasterClient } from '../hub/client'

export interface LinkVerificationResult {
  valid: boolean
  fid?: number
  linkedAddress?: Address
  error?: string
}

export async function verifyAddressCanLink(
  fid: number,
  address: Address,
  client: FarcasterClient = new FarcasterClient(),
): Promise<LinkVerificationResult> {
  const profile = await client.getProfile(fid)

  // Check if address is custody address
  if (profile.custodyAddress.toLowerCase() === address.toLowerCase()) {
    return {
      valid: true,
      fid,
      linkedAddress: profile.custodyAddress,
    }
  }

  // Check if address is a verified address
  const isVerified = profile.verifiedAddresses.some(
    (v) => v.toLowerCase() === address.toLowerCase(),
  )

  if (isVerified) {
    return {
      valid: true,
      fid,
      linkedAddress: address,
    }
  }

  return {
    valid: false,
    error: 'Address not associated with this FID',
  }
}

export async function lookupFidByAddress(
  address: Address,
  client: FarcasterClient = new FarcasterClient(),
): Promise<number | null> {
  const profile = await client.getProfileByVerifiedAddress(address)
  if (profile === null) {
    return null
  }
  return profile.fid
}

export function generateLinkProofMessage(params: {
  fid: number
  jejuAddress: Address
  timestamp: number
  domain: string
}): string {
  return [
    `${params.domain} wants to link your Farcaster account to Jeju Network.`,
    '',
    `Farcaster ID: ${params.fid}`,
    `Jeju Address: ${params.jejuAddress}`,
    `Timestamp: ${params.timestamp}`,
    '',
    'Signing this message proves you control both accounts.',
    'This does not grant any permissions or transfer any assets.',
  ].join('\n')
}

export interface ParsedLinkProof {
  fid: number
  jejuAddress: Address
  timestamp: number
  domain: string
}

export function parseLinkProofMessage(message: string): ParsedLinkProof | null {
  const lines = message.split('\n')

  const domainMatch = lines[0]?.match(/^(.+) wants to link/)
  if (!domainMatch) {
    return null
  }
  const domain = domainMatch[1]

  let fid: number | undefined
  let jejuAddress: Address | undefined
  let timestamp: number | undefined

  for (const line of lines) {
    if (line.startsWith('Farcaster ID: ')) {
      fid = parseInt(line.slice(14), 10)
    } else if (line.startsWith('Jeju Address: ')) {
      jejuAddress = line.slice(14) as Address
    } else if (line.startsWith('Timestamp: ')) {
      timestamp = parseInt(line.slice(11), 10)
    }
  }

  if (
    fid === undefined ||
    jejuAddress === undefined ||
    timestamp === undefined
  ) {
    return null
  }

  return { fid, jejuAddress, timestamp, domain }
}

/**
 * Constant-time number comparison to prevent timing attacks
 */
function constantTimeCompareNumbers(a: number, b: number): boolean {
  // XOR the numbers and check if result is 0
  // This ensures comparison time doesn't depend on values
  return (a ^ b) === 0
}

/**
 * Check if timestamp is within allowed window
 * Uses subtraction instead of abs() to be more predictable
 */
function isTimestampValid(
  timestamp: number,
  now: number,
  maxAge: number,
): boolean {
  const diff = now - timestamp
  // Must be positive (not in future) and within maxAge
  // Allow small future drift (60 seconds) for clock skew
  const maxFutureDrift = 60
  return diff >= -maxFutureDrift && diff <= maxAge
}

export async function verifyLinkProof(
  message: string,
  signature: Hex,
  expectedFid: number,
  client: FarcasterClient = new FarcasterClient(),
): Promise<LinkVerificationResult> {
  const parsed = parseLinkProofMessage(message)

  if (!parsed) {
    return { valid: false, error: 'Invalid proof message format' }
  }

  // Use constant-time comparison for FID to prevent timing attacks
  if (!constantTimeCompareNumbers(parsed.fid, expectedFid)) {
    return { valid: false, error: 'FID mismatch' }
  }

  // Check timestamp (within 24 hours, small future drift allowed)
  const now = Math.floor(Date.now() / 1000)
  const maxAge = 86400 // 24 hours

  if (!isTimestampValid(parsed.timestamp, now, maxAge)) {
    return { valid: false, error: 'Proof expired' }
  }

  // Recover signer and verify ownership
  const profile = await client.getProfile(expectedFid)

  // Try custody address first
  const isValidCustody = await verifyMessage({
    address: profile.custodyAddress,
    message,
    signature,
  })

  if (isValidCustody) {
    return {
      valid: true,
      fid: expectedFid,
      linkedAddress: parsed.jejuAddress,
    }
  }

  // Try verified addresses
  for (const verifiedAddr of profile.verifiedAddresses) {
    const isValid = await verifyMessage({
      address: verifiedAddr,
      message,
      signature,
    })

    if (isValid) {
      return {
        valid: true,
        fid: expectedFid,
        linkedAddress: parsed.jejuAddress,
      }
    }
  }

  return { valid: false, error: 'Signature verification failed' }
}
