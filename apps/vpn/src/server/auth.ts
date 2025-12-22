/**
 * Authentication helpers for VPN server
 *
 * Uses fail-fast validation patterns
 */

import { type Address, getAddress, verifyMessage } from 'viem'
import { AuthHeadersSchema, expect, expectValid } from './schemas'

export interface AuthResult {
  valid: boolean
  address?: Address
  error?: string
}

/**
 * Verify authentication from request headers
 */
export async function verifyAuth(request: Request): Promise<AuthResult> {
  const address = request.headers.get('x-jeju-address')
  const timestamp = request.headers.get('x-jeju-timestamp')
  const signature = request.headers.get('x-jeju-signature')

  if (!address || !timestamp || !signature) {
    return { valid: false, error: 'Missing authentication headers' }
  }

  const headers = {
    'x-jeju-address': address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  }
  const validatedHeaders = expectValid(
    AuthHeadersSchema,
    headers,
    'auth headers',
  )

  const ts = parseInt(validatedHeaders['x-jeju-timestamp'], 10)
  expect(!Number.isNaN(ts), 'Timestamp must be a valid number')

  const now = Date.now()
  const timeDiff = Math.abs(now - ts)
  const maxAge = 5 * 60 * 1000 // 5 minutes
  expect(
    timeDiff <= maxAge,
    `Timestamp expired or invalid. Time difference: ${timeDiff}ms, max: ${maxAge}ms`,
  )

  const message = `jeju-vpn:${timestamp}`
  const validAddress = getAddress(validatedHeaders['x-jeju-address'])

  const isValid = await verifyMessage({
    address: validAddress,
    message,
    signature: validatedHeaders['x-jeju-signature'],
  })

  if (!isValid) {
    throw new Error('Invalid signature')
  }

  return { valid: true, address: validAddress }
}
