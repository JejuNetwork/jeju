/**
 * Access Control Helpers for Factory API
 *
 * Provides authorization checks for state-changing operations.
 * Uses wallet signature verification to ensure caller identity.
 */

import { type Address, isAddress, verifyMessage } from 'viem'

// Maximum age for authentication signatures (5 minutes)
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000

export interface AuthContext {
  address: Address
  timestamp: number
  signature: string
}

interface AuthHeaders {
  'x-jeju-address'?: string
  'x-jeju-timestamp'?: string
  'x-jeju-signature'?: string
  'x-jeju-nonce'?: string
}

/**
 * Extract authentication headers from request
 */
function extractAuthHeaders(headers: AuthHeaders): AuthContext | null {
  const address = headers['x-jeju-address']
  const timestampStr = headers['x-jeju-timestamp']
  const signature = headers['x-jeju-signature']

  if (!address || !timestampStr || !signature) {
    return null
  }

  if (!isAddress(address)) {
    return null
  }

  const timestamp = parseInt(timestampStr, 10)
  if (Number.isNaN(timestamp)) {
    return null
  }

  return {
    address: address as Address,
    timestamp,
    signature,
  }
}

/**
 * Verify that a request is properly authenticated
 */
async function verifyAuthentication(
  auth: AuthContext,
  expectedMessage: string,
): Promise<boolean> {
  // Check timestamp freshness to prevent replay attacks
  const now = Date.now()
  const age = now - auth.timestamp

  if (age < 0 || age > MAX_SIGNATURE_AGE_MS) {
    return false
  }

  // Verify the signature matches the expected message
  return verifyMessage({
    address: auth.address,
    message: expectedMessage,
    signature: auth.signature as `0x${string}`,
  })
}

type RequireAuthResult =
  | { success: true; address: Address }
  | { success: false; error: string }

/**
 * Require authentication for a request
 */
export async function requireAuth(
  headers: Record<string, string | undefined>,
): Promise<RequireAuthResult> {
  const auth = extractAuthHeaders(headers as AuthHeaders)

  if (!auth) {
    return { success: false, error: 'Authentication required' }
  }

  // Build expected message for verification
  const nonce = headers['x-jeju-nonce'] || ''
  const expectedMessage = `Factory Auth\nTimestamp: ${auth.timestamp}\nNonce: ${nonce}`

  const isValid = await verifyAuthentication(auth, expectedMessage)
  if (!isValid) {
    return { success: false, error: 'Invalid or expired signature' }
  }

  return { success: true, address: auth.address }
}

/**
 * Check if an address is the owner of a resource
 */
export function isOwner(userAddress: Address, ownerAddress: Address): boolean {
  return userAddress.toLowerCase() === ownerAddress.toLowerCase()
}

/**
 * Generate a standardized authentication message for signing
 */
export function generateAuthMessage(timestamp: number, nonce: string): string {
  return `Factory Auth\nTimestamp: ${timestamp}\nNonce: ${nonce}`
}
