/**
 * Access Control Helpers for Factory API
 *
 * Provides authorization checks for state-changing operations.
 * Uses wallet signature verification to ensure caller identity.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { type Address, isAddress, verifyMessage } from 'viem'

// Maximum age for authentication signatures (5 minutes)
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000

export interface AuthContext {
  address: Address
  timestamp: number
  signature: string
}

/**
 * Extract authentication headers from request
 * Returns null if headers are missing or invalid
 */
export function extractAuthHeaders(request: NextRequest): AuthContext | null {
  const address = request.headers.get('x-jeju-address')
  const timestampStr = request.headers.get('x-jeju-timestamp')
  const signature = request.headers.get('x-jeju-signature')

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
 * Checks signature validity and timestamp freshness
 */
export async function verifyAuthentication(
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
  const isValid = await verifyMessage({
    address: auth.address,
    message: expectedMessage,
    signature: auth.signature as `0x${string}`,
  }).catch(() => false)

  return isValid
}

/**
 * Require authentication for a request
 * Returns error response if authentication fails, null if successful
 */
export async function requireAuth(
  request: NextRequest,
): Promise<{ auth: AuthContext } | { error: NextResponse }> {
  const auth = extractAuthHeaders(request)

  if (!auth) {
    return {
      error: NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      ),
    }
  }

  // Build expected message for verification
  const nonce = request.headers.get('x-jeju-nonce') || ''
  const expectedMessage = `Factory Auth\nTimestamp: ${auth.timestamp}\nNonce: ${nonce}`

  const isValid = await verifyAuthentication(auth, expectedMessage)
  if (!isValid) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired signature',
          },
        },
        { status: 401 },
      ),
    }
  }

  return { auth }
}

/**
 * Check if an address is the owner of a resource
 * This is a helper for authorization checks
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
