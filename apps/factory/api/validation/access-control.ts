/** Access Control */

import { isHexString, isValidAddress } from '@jejunetwork/types'
import { type Address, verifyMessage } from 'viem'
import { extractRawAuthHeaders, type RawAuthHeaders } from '../lib/type-guards'

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000

export interface AuthContext {
  address: Address
  timestamp: number
  signature: `0x${string}`
}

function extractAuthHeaders(headers: RawAuthHeaders): AuthContext | null {
  const address = headers['x-jeju-address']
  const timestampStr = headers['x-jeju-timestamp']
  const signature = headers['x-jeju-signature']

  if (!address || !timestampStr || !signature) {
    return null
  }

  if (!isValidAddress(address)) {
    return null
  }

  if (!isHexString(signature)) {
    return null
  }

  const timestamp = parseInt(timestampStr, 10)
  if (Number.isNaN(timestamp)) {
    return null
  }

  return {
    address,
    timestamp,
    signature,
  }
}

async function verifyAuthentication(
  auth: AuthContext,
  expectedMessage: string,
): Promise<boolean> {
  const now = Date.now()
  const age = now - auth.timestamp

  if (age < 0 || age > MAX_SIGNATURE_AGE_MS) {
    return false
  }

  return verifyMessage({
    address: auth.address,
    message: expectedMessage,
    signature: auth.signature,
  })
}

type RequireAuthResult =
  | { success: true; address: Address }
  | { success: false; error: string }

export async function requireAuth(
  headers: Record<string, string | undefined>,
): Promise<RequireAuthResult> {
  const rawHeaders = extractRawAuthHeaders(headers)
  const auth = extractAuthHeaders(rawHeaders)

  if (!auth) {
    return { success: false, error: 'Authentication required' }
  }

  const nonce = headers['x-jeju-nonce'] || ''
  const expectedMessage = `Factory Auth\nTimestamp: ${auth.timestamp}\nNonce: ${nonce}`

  const isValid = await verifyAuthentication(auth, expectedMessage)
  if (!isValid) {
    return { success: false, error: 'Invalid or expired signature' }
  }

  return { success: true, address: auth.address }
}

export function isOwner(userAddress: Address, ownerAddress: Address): boolean {
  return userAddress.toLowerCase() === ownerAddress.toLowerCase()
}

export function generateAuthMessage(timestamp: number, nonce: string): string {
  return `Factory Auth\nTimestamp: ${timestamp}\nNonce: ${nonce}`
}
