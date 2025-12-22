/**
 * Authentication helpers for VPN server
 *
 * Uses fail-fast validation patterns
 */

import type { Context } from 'hono'
import { type Address, getAddress, type Hex, verifyMessage } from 'viem'
import { AuthHeadersSchema, expect, expectValid } from './schemas'

export interface AuthResult {
  valid: boolean
  address?: Address
  error?: string
}

/**
 * Verify authentication from request headers
 */
export async function verifyAuth(c: Context): Promise<AuthResult> {
  const address = c.req.header('x-jeju-address')
  const timestamp = c.req.header('x-jeju-timestamp')
  const signature = c.req.header('x-jeju-signature')

  // Check if headers are present
  if (!address || !timestamp || !signature) {
    return { valid: false, error: 'Missing authentication headers' }
  }

  // Validate headers structure
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

  // Validate timestamp (within 5 minutes)
  const ts = parseInt(validatedHeaders['x-jeju-timestamp'], 10)
  expect(!Number.isNaN(ts), 'Timestamp must be a valid number')

  const now = Date.now()
  const timeDiff = Math.abs(now - ts)
  const maxAge = 5 * 60 * 1000 // 5 minutes
  expect(
    timeDiff <= maxAge,
    `Timestamp expired or invalid. Time difference: ${timeDiff}ms, max: ${maxAge}ms`,
  )

  // Verify signature
  const message = `jeju-vpn:${timestamp}`
  const validAddress = getAddress(validatedHeaders['x-jeju-address'])
  const validSignature = validatedHeaders['x-jeju-signature'] as Hex

  const isValid = await verifyMessage({
    address: validAddress,
    message,
    signature: validSignature,
  })

  if (!isValid) {
    throw new Error('Invalid signature')
  }

  return { valid: true, address: validAddress }
}
